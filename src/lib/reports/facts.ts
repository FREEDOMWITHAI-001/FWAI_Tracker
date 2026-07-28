// Facts: every mapped input row joins into ONE table — one row per
// (person x webinar session). Nothing downstream reads a raw file again.
//
// Session assignment order (documented because it decides borderline rows):
//   1. an explicit session id / date on the row
//   2. the session(s) the person actually attended
//   3. the session nearest their call / registration time (within MATCH_DAYS)
//   4. the "__all__" bucket, when the report has no session dimension at all

import { parseWhen, istDay, isoWeek, parseDuration, parseMoney, parseCount, inferDateOrder, type DateOrder } from './dates';
import { normalisePhone, normaliseEmail, normaliseName, personKey, isNameOnlyKey, Crosswalk, Exclusions } from './identity';
import { pick } from './mapping';
import type { Assumptions, DatasetShape, Fact, InputRole, SessionInfo } from './types';

const MATCH_DAYS = 2; // how far a call/registration may reach to claim a session

export interface DatasetOptions {
  call_mode?: 'ai' | 'manual';
  duration_unit?: 'minutes' | 'seconds';
  date_order?: DateOrder | 'auto';
}

export interface LoadedDataset {
  id: string;
  role: InputRole;
  source: 'upload' | 'zoom_api';
  filename: string;
  shape: DatasetShape;
  mapping: Record<string, string>;
  options: DatasetOptions;
  rows: Record<string, string>[];
  session_rows: Record<string, string>[];
}

export interface MatchStats {
  rows: number;
  identified: number; // rows we could key to a person
  invalid_phone: number;
  name_only: number;
  excluded: number; // dropped by the test/internal list
  matched_to_leads: number;
  unique_people: number;
  crosswalked: number; // rows rewritten from an email/name key onto a phone key
  zero_dropped: number; // ₹0 orders discarded for having no coupon code
}

export interface FactBuild {
  facts: Fact[]; // one row per (person x session)
  sessions: SessionInfo[];
  stats: Record<InputRole, MatchStats>;
  orders: OrderRecord[];
  unattributed_orders: OrderRecord[];
  cost: { talk_minutes: number; amount: number | null; from_file: boolean };
  ai_weeks: string[];
  has_leads: boolean; // a leads/registrations file was uploaded at all
  has_talk_turns: boolean;
  has_manual_calls: boolean;
  has_comeback_source: boolean;
  has_duration: boolean; // a call-duration column was mapped, so "talked" is meaningful
  // What the ₹0 / coupon rule actually did, so the quality panel can report it
  // instead of the operator discovering it in the revenue total.
  sales_meta: {
    coupon_zero: number; // ₹0 orders accepted because a coupon matched
    zero_no_coupon: number; // ₹0 orders with no coupon (dropped or kept per rule)
    missing_amount_col: boolean;
    price_unset: boolean; // a price was needed but neither list price nor default is set
  };
  bots: string[]; // distinct bot names auto-detected in the call log(s)
  notes: string[];
}

export interface OrderRecord {
  person_key: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  product: string;
  coupon: string | null;
  amount: number;
  raw_amount: number | null;
  order_time: string | null;
  order_id: string | null;
  relevant: boolean;
  attributed_session: string | null;
  within_window: boolean;
  reason?: string;
}

const emptyStats = (): MatchStats => ({
  rows: 0,
  identified: 0,
  invalid_phone: 0,
  name_only: 0,
  excluded: 0,
  matched_to_leads: 0,
  unique_people: 0,
  crosswalked: 0,
  zero_dropped: 0,
});

interface PersonRef {
  key: string;
  phone: string | null;
  email: string | null;
  name: string | null;
}

// Resolve a row's identity, honouring the exclusion list.
//
// `xw` collapses an email-only / name-only key onto the phone key the leads file
// established for the same person. Without it a Zoom attendance row (no phone
// column) can never meet the call log, which is keyed on phone.
function identify(
  row: Record<string, string>,
  mapping: Record<string, string>,
  ex: Exclusions,
  st: MatchStats,
  xw?: { cw: Crosswalk; useName: boolean }
): PersonRef | null {
  st.rows++;
  const rawPhone = pick(row, mapping, 'phone');
  const ph = normalisePhone(rawPhone);
  if (rawPhone && !ph.digits) st.invalid_phone++;
  const email = normaliseEmail(pick(row, mapping, 'email'));
  const name = normaliseName(pick(row, mapping, 'name'));
  let key = personKey(ph.digits, email, name);
  if (!key) return null;
  // Exclusions are checked on the row's own identifiers, before any rewrite, so
  // a test number is dropped whichever file it came from.
  if (ex.excludes({ phone: ph.digits, email, name })) {
    st.excluded++;
    return null;
  }
  if (xw) {
    const resolved = xw.cw.resolve(key, { useName: xw.useName });
    if (resolved !== key) {
      st.crosswalked++;
      key = resolved;
    }
  }
  st.identified++;
  if (isNameOnlyKey(key)) st.name_only++;
  return { key, phone: ph.digits, email, name };
}

// Does this order's coupon field count as a real discount code?
// An empty coupon_codes list means "any non-empty coupon value counts", which is
// the common case — most clients just want ₹0-with-a-code to be a sale. Listing
// codes narrows it to specific campaigns.
function hasCoupon(coupon: string, codes: string[]): boolean {
  const c = coupon.trim().toLowerCase();
  if (!c) return false;
  const wanted = codes.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return true;
  return wanted.some((w) => c === w || c.includes(w));
}

// List price for a product, used to value a 100%-off coupon order.
// Longest match wins so "AI Mastery Pro" beats a generic "AI Mastery" rule.
function priceForProduct(product: string, a: Assumptions): number | null {
  const p = (product ?? '').toLowerCase();
  let best: { len: number; price: number } | null = null;
  for (const pp of a.product_prices ?? []) {
    const m = (pp.match ?? '').trim().toLowerCase();
    if (!m || !p.includes(m)) continue;
    if (!best || m.length > best.len) best = { len: m.length, price: Number(pp.price) || 0 };
  }
  return best ? best.price : null;
}

// Pick the date order once per column rather than guessing per value.
function orderFor(ds: LoadedDataset, field: string): DateOrder {
  const opt = ds.options?.date_order;
  if (opt && opt !== 'auto') return opt;
  const col = ds.mapping[field];
  if (!col) return 'mdy';
  return inferDateOrder(ds.rows.slice(0, 400).map((r) => String(r[col] ?? '')));
}

export function buildFacts(
  datasets: LoadedDataset[],
  a: Assumptions,
  exclusions: Exclusions
): FactBuild {
  const notes: string[] = [];
  const stats: Record<InputRole, MatchStats> = {
    leads: emptyStats(),
    calls: emptyStats(),
    attendance: emptyStats(),
    sales: emptyStats(),
    cost: emptyStats(),
    comeback: emptyStats(),
  };

  const by = (role: InputRole) => datasets.filter((d) => d.role === role);

  // ------------------------------------------------------- identity crosswalk
  // Learned BEFORE anything is identified, because every later identify() call
  // consults it. Leads first (the authoritative registration record), then any
  // other file that happens to carry both a phone and an email — sales exports
  // usually do, and a second bridge only helps.
  const crosswalk = new Crosswalk();
  const useName = !!a.crosswalk_use_name;
  if (a.crosswalk_enabled !== false) {
    const learnOrder = [...by('leads'), ...datasets.filter((d) => d.role !== 'leads')];
    for (const ds of learnOrder) {
      if (!ds.mapping['phone']) continue; // nothing to bridge onto
      if (!ds.mapping['email'] && !ds.mapping['name']) continue;
      for (const row of ds.rows) {
        const ph = normalisePhone(pick(row, ds.mapping, 'phone')).digits;
        if (!ph) continue;
        crosswalk.learn(
          ph,
          normaliseEmail(pick(row, ds.mapping, 'email')),
          normaliseName(pick(row, ds.mapping, 'name'))
        );
      }
    }
    const cs = crosswalk.stats;
    if (cs.email_links) {
      notes.push(
        `Identity crosswalk: ${cs.email_links.toLocaleString()} email→phone links learned` +
          (useName ? ` and ${cs.name_links.toLocaleString()} name→phone links` : '') +
          `. Zoom rows (which carry no phone) resolve onto the registrant's phone through this.`
      );
    }
    if (cs.ambiguous_emails) {
      notes.push(
        `${cs.ambiguous_emails} email(s) mapped to more than one phone number and were left unmerged rather than guessed.`
      );
    }
  }
  const xw = a.crosswalk_enabled === false ? undefined : { cw: crosswalk, useName };

  // ---------------------------------------------------------------- sessions
  const sessions = new Map<string, SessionInfo>();
  const touchSession = (
    key: string,
    patch: Partial<SessionInfo> & { source?: SessionInfo['source'] }
  ): SessionInfo => {
    let s = sessions.get(key);
    if (!s) {
      s = {
        key,
        topic: patch.topic || key,
        date: patch.date ?? null,
        week: patch.date ? isoWeek(patch.date) : null,
        start_time: patch.start_time ?? null,
        source: patch.source ?? 'derived',
        attendees: 0,
        registrants: 0,
        excluded: false,
      };
      sessions.set(key, s);
    }
    if (patch.topic && (s.topic === s.key || !s.topic)) s.topic = patch.topic;
    if (patch.date && !s.date) {
      s.date = patch.date;
      s.week = isoWeek(patch.date);
    }
    if (patch.start_time && !s.start_time) s.start_time = patch.start_time;
    if (patch.source && patch.source !== 'derived') s.source = patch.source;
    return s;
  };

  const sessionKeyFrom = (id: string, day: string | null): string | null => {
    if (id) return `s:${id}`;
    if (day) return `d:${day}`;
    return null;
  };

  // ------------------------------------------------------------- attendance
  // personKey -> sessionKey -> attendance aggregate
  interface Att {
    joins: number;
    watch: number | null;
    first_join: string | null;
    last_leave: string | null;
    ref: PersonRef;
  }
  const attendance = new Map<string, Map<string, Att>>();
  const attSets = new Map<string, Set<string>>(); // sessionKey -> personKeys

  // Precedence: when an upload and the Zoom API both cover a session, one wins
  // outright for that session — we never mix two attendance sources inside one
  // session, because their duration semantics differ.
  const attendanceDatasets = by('attendance');
  const sessionOwner = new Map<string, 'upload' | 'zoom_api'>();

  for (const pass of ['claim', 'apply'] as const) {
    for (const ds of attendanceDatasets) {
      const startOrder = orderFor(ds, 'session_start');
      const joinOrder = orderFor(ds, 'join_time');
      const unit = ds.options?.duration_unit ?? 'minutes';
      const st = pass === 'apply' ? stats.attendance : emptyStats();

      // A two-table export carries the session identity in its own block.
      let blockSessionKey: string | null = null;
      if (ds.session_rows.length) {
        const sr = ds.session_rows[0];
        const id = String(sr['Meeting ID'] ?? sr['Webinar ID'] ?? sr['ID'] ?? '').trim();
        const topic = String(sr['Topic'] ?? sr['Meeting Topic'] ?? sr['Webinar Topic'] ?? '').trim();
        const start = parseWhen(sr['Start Time'] ?? sr['Start time'] ?? sr['Actual Start Time'], startOrder);
        const day = istDay(start);
        blockSessionKey = sessionKeyFrom(id, day);
        if (blockSessionKey && pass === 'apply') {
          touchSession(blockSessionKey, { topic: topic || undefined, date: day, start_time: start, source: ds.source });
        }
      }

      for (const row of ds.rows) {
        const ref = identify(row, ds.mapping, exclusions, st, xw);
        if (!ref) continue;
        const id = pick(row, ds.mapping, 'session_id');
        const start = parseWhen(pick(row, ds.mapping, 'session_start'), startOrder);
        const join = parseWhen(pick(row, ds.mapping, 'join_time'), joinOrder);
        const leave = parseWhen(pick(row, ds.mapping, 'leave_time'), joinOrder);
        const day = istDay(start) ?? istDay(join);
        const key = sessionKeyFrom(id, day) ?? blockSessionKey ?? '__all__';

        if (pass === 'claim') {
          const cur = sessionOwner.get(key);
          if (!cur) sessionOwner.set(key, ds.source);
          else if (cur !== ds.source) {
            // Both sources cover this session — the assumption decides.
            sessionOwner.set(key, a.attendance_precedence);
          }
          continue;
        }
        if (sessionOwner.get(key) !== ds.source) continue;

        touchSession(key, {
          topic: pick(row, ds.mapping, 'session_topic') || undefined,
          date: day,
          start_time: start ?? join,
          source: ds.source,
        });

        const mins = parseDuration(pick(row, ds.mapping, 'watch_minutes'), unit);
        const watch = unit === 'seconds' && mins != null ? mins / 60 : mins;

        let perPerson = attendance.get(ref.key);
        if (!perPerson) attendance.set(ref.key, (perPerson = new Map()));
        const cur = perPerson.get(key);
        if (cur) {
          cur.joins++;
          if (watch != null) cur.watch = (cur.watch ?? 0) + watch;
          if (join && (!cur.first_join || join < cur.first_join)) cur.first_join = join;
          if (leave && (!cur.last_leave || leave > cur.last_leave)) cur.last_leave = leave;
        } else {
          perPerson.set(key, { joins: 1, watch, first_join: join, last_leave: leave, ref });
        }
        let set = attSets.get(key);
        if (!set) attSets.set(key, (set = new Set()));
        set.add(ref.key);
      }
    }
  }

  const mixed = [...sessionOwner.entries()].length;
  if (attendanceDatasets.some((d) => d.source === 'upload') && attendanceDatasets.some((d) => d.source === 'zoom_api')) {
    notes.push(
      `Attendance came from both an upload and the Zoom API; "${a.attendance_precedence}" wins per session (${mixed} sessions resolved).`
    );
  }

  for (const [key, set] of attSets) {
    const s = sessions.get(key);
    if (s) s.attendees = set.size;
  }
  // Zoom practice/test rooms: tiny sessions distort per-webinar averages.
  for (const s of sessions.values()) {
    if (s.key !== '__all__' && s.attendees > 0 && s.attendees < a.min_session_attendees) s.excluded = true;
  }

  const orderedSessions = [...sessions.values()].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  const datedSessions = orderedSessions.filter((s) => s.date && !s.excluded);

  // Nearest dated session to a timestamp, within MATCH_DAYS.
  const nearestSession = (iso: string | null): string | null => {
    const day = istDay(iso);
    if (!day || !datedSessions.length) return null;
    let best: SessionInfo | null = null;
    let bestDiff = Infinity;
    for (const s of datedSessions) {
      const diff = Math.abs((Date.parse(s.date + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86_400_000);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    return best && bestDiff <= MATCH_DAYS ? best.key : null;
  };

  // ------------------------------------------------------------------ calls
  interface CallAgg {
    dialled: boolean;
    connected: boolean;
    attempts: number;
    talk_turns: number | null;
    seconds: number; // total connected seconds
    best_seconds: number; // LONGEST single connected call — drives "talked"
    bots: Set<string>;
    reached_bots: Set<string>;
    modes: Set<'ai' | 'manual'>;
    first_call: string | null;
    ref: PersonRef;
  }
  const calls = new Map<string, CallAgg>();
  let hasTalkTurns = false;
  let hasManual = false;
  let hasDuration = false;
  const botsSeen = new Set<string>();
  const connectedSet = new Set(a.connected_statuses.map((s) => s.toLowerCase().trim()));

  for (const ds of by('calls')) {
    const order = orderFor(ds, 'call_time');
    const unit = ds.options?.duration_unit ?? 'seconds';
    const mode: 'ai' | 'manual' = ds.options?.call_mode === 'manual' ? 'manual' : 'ai';
    if (mode === 'manual') hasManual = true;

    for (const row of ds.rows) {
      const ref = identify(row, ds.mapping, exclusions, stats.calls, xw);
      if (!ref) continue;
      const status = pick(row, ds.mapping, 'status').toLowerCase().trim();
      const reached = connectedSet.has(status);
      const bot = pick(row, ds.mapping, 'bot_name').trim();
      const when = parseWhen(pick(row, ds.mapping, 'call_time'), order);
      const turnsRaw = pick(row, ds.mapping, 'talk_turns');
      const turns = turnsRaw ? parseCount(turnsRaw) : null;
      if (turns != null) hasTalkTurns = true;
      const durRaw = parseDuration(pick(row, ds.mapping, 'duration_sec'), unit);
      if (durRaw != null) hasDuration = true;
      const seconds = durRaw == null ? 0 : unit === 'minutes' ? durRaw * 60 : durRaw;
      if (bot) botsSeen.add(bot);

      let c = calls.get(ref.key);
      if (!c) {
        c = {
          dialled: true,
          connected: false,
          attempts: 0,
          talk_turns: null,
          seconds: 0,
          best_seconds: 0,
          bots: new Set(),
          reached_bots: new Set(),
          modes: new Set(),
          first_call: null,
          ref,
        };
        calls.set(ref.key, c);
      }
      c.attempts++;
      c.modes.add(mode);
      if (bot) c.bots.add(bot);
      if (reached) {
        c.connected = true;
        if (bot) c.reached_bots.add(bot);
        c.seconds += seconds;
        // Longest SINGLE call, not the sum: one 20-second conversation is a
        // conversation, ten 2-second pickups are not.
        if (seconds > c.best_seconds) c.best_seconds = seconds;
      }
      if (turns != null) c.talk_turns = Math.max(c.talk_turns ?? 0, turns);
      if (when && (!c.first_call || when < c.first_call)) c.first_call = when;
      if (!c.ref.phone && ref.phone) c.ref = ref;
    }
  }

  // ------------------------------------------------------------------ leads
  interface LeadRec {
    ref: PersonRef;
    session_key: string | null;
    registered_at: string | null;
    rows: number;
  }
  const leads = new Map<string, LeadRec>();
  for (const ds of by('leads')) {
    const dateOrder = orderFor(ds, 'session_date');
    const regOrder = orderFor(ds, 'registered_at');
    for (const row of ds.rows) {
      const ref = identify(row, ds.mapping, exclusions, stats.leads, xw);
      if (!ref) continue;
      const id = pick(row, ds.mapping, 'session_id');
      const day = istDay(parseWhen(pick(row, ds.mapping, 'session_date'), dateOrder));
      const reg = parseWhen(pick(row, ds.mapping, 'registered_at'), regOrder);
      const key = sessionKeyFrom(id, day);
      const cur = leads.get(ref.key);
      if (cur) {
        cur.rows++;
        if (!cur.session_key && key) cur.session_key = key;
        if (reg && (!cur.registered_at || reg < cur.registered_at)) cur.registered_at = reg;
      } else {
        leads.set(ref.key, { ref, session_key: key, registered_at: reg, rows: 1 });
      }
      if (key) touchSession(key, { date: day });
    }
  }
  // No leads/registrations file uploaded at all: there is no registration
  // list to compare against, so the population becomes whoever we actually
  // dialled — "registered" falls back to "was called" instead of being
  // false for everyone.
  const hasLeads = by('leads').length > 0;
  if (!hasLeads) {
    notes.push(
      'No leads/registrations file was uploaded, so the population is everyone the AI called instead of a ' +
        'registration list — the phone/attendee match-rate checks against leads are skipped rather than showing a ' +
        'false 0%.'
    );
  }

  // --------------------------------------------------------------- comeback
  const comeback = new Map<string, string>(); // personKey -> earliest click
  for (const ds of by('comeback')) {
    const order = orderFor(ds, 'click_time');
    for (const row of ds.rows) {
      const ref = identify(row, ds.mapping, exclusions, stats.comeback, xw);
      if (!ref) continue;
      const when = parseWhen(pick(row, ds.mapping, 'click_time'), order);
      if (!when) continue; // no timestamp = never clicked
      const cur = comeback.get(ref.key);
      if (!cur || when < cur) comeback.set(ref.key, when);
    }
  }
  const hasComebackSource = by('comeback').length > 0;

  // ------------------------------------------------------------------ sales
  const orders: OrderRecord[] = [];
  const seenOrderIds = new Set<string>();
  let couponZeroCount = 0;
  let zeroNoCouponCount = 0;
  let missingAmountCol = false;
  for (const ds of by('sales')) {
    const order = orderFor(ds, 'order_time');
    const hasAmountCol = !!ds.mapping['amount'];
    if (!hasAmountCol) missingAmountCol = true;
    for (const row of ds.rows) {
      stats.sales.rows++;
      const oid = pick(row, ds.mapping, 'order_id');
      if (oid && seenOrderIds.has(oid)) continue;
      if (oid) seenOrderIds.add(oid);

      const statusCol = ds.mapping['status'];
      if (statusCol) {
        const st = pick(row, ds.mapping, 'status').toLowerCase().trim();
        // Only drop rows that are explicitly not a completed sale.
        if (st && /(fail|cancel|refund|pending|abandon|expired|declin)/.test(st)) continue;
      }

      const ph = normalisePhone(pick(row, ds.mapping, 'phone'));
      const email = normaliseEmail(pick(row, ds.mapping, 'email'));
      const name = normaliseName(pick(row, ds.mapping, 'name'));
      const rawKey = personKey(ph.digits, email, name);
      if (rawKey) stats.sales.identified++;
      if (rawKey && exclusions.excludes({ phone: ph.digits, email, name })) {
        stats.sales.excluded++;
        continue;
      }
      // An order carrying only an email still has to find the buyer, who is
      // keyed on phone everywhere else.
      let key = rawKey;
      if (key && xw) {
        const resolved = xw.cw.resolve(key, { useName: xw.useName });
        if (resolved !== key) {
          stats.sales.crosswalked++;
          key = resolved;
        }
      }

      const raw = hasAmountCol ? parseMoney(pick(row, ds.mapping, 'amount')) : null;
      const product = pick(row, ds.mapping, 'product');
      const coupon = pick(row, ds.mapping, 'coupon').trim();

      // A ₹0 row is either a 100%-off coupon (a real sale worth the product's
      // list price) or a test/free row. The coupon code is the only thing that
      // tells them apart, so it drives the valuation.
      let amount: number;
      let zeroDrop = false;
      if (raw == null) {
        // No amount column at all — fall back to the list price for the product,
        // else the flat default. The quality panel blocks the run if neither is set.
        amount = priceForProduct(product, a) ?? a.default_order_value ?? 0;
      } else if (raw === 0) {
        if (hasCoupon(coupon, a.coupon_codes)) {
          couponZeroCount++;
          // "Consider the actual product price, not the 0."
          amount = priceForProduct(product, a) ?? a.default_order_value ?? a.zero_order_value;
        } else if (a.zero_without_coupon === 'exclude') {
          zeroDrop = true;
          amount = 0;
        } else if (a.zero_without_coupon === 'count_notional') {
          amount = a.zero_order_value;
        } else {
          amount = 0; // count_zero: a real buyer worth no revenue
        }
      } else {
        amount = raw;
      }

      if (zeroDrop) {
        zeroNoCouponCount++;
        stats.sales.zero_dropped++;
        continue; // not a sale at all under the current rule
      }

      const relevant = !a.exclude_products.some((x) => x && product.toLowerCase().includes(x.toLowerCase()));

      orders.push({
        person_key: key,
        name,
        phone: ph.digits,
        email,
        product,
        coupon: coupon || null,
        amount,
        raw_amount: raw,
        order_time: parseWhen(pick(row, ds.mapping, 'order_time'), order),
        order_id: oid || null,
        relevant,
        attributed_session: null,
        within_window: false,
      });
    }
  }
  stats.sales.unique_people = new Set(orders.map((o) => o.person_key).filter(Boolean)).size;

  // ------------------------------------------------------------------- cost
  let talkMinutes = 0;
  let costAmount: number | null = null;
  let costFromFile = false;
  for (const ds of by('cost')) {
    costFromFile = true;
    for (const row of ds.rows) {
      stats.cost.rows++;
      const m = parseDuration(pick(row, ds.mapping, 'talk_minutes'), 'minutes');
      if (m != null) talkMinutes += m;
      const amt = parseMoney(pick(row, ds.mapping, 'amount'));
      if (amt != null) costAmount = (costAmount ?? 0) + amt;
    }
  }
  // No cost file: derive talk minutes from the connected call durations.
  if (!costFromFile) {
    for (const c of calls.values()) talkMinutes += c.seconds / 60;
  }

  // ------------------------------------------------------ assemble the facts
  const universe = new Set<string>([...leads.keys(), ...calls.keys(), ...attendance.keys()]);
  const factList: Fact[] = [];
  const factIndex = new Map<string, Fact[]>(); // personKey -> facts

  for (const key of universe) {
    const lead = leads.get(key);
    const call = calls.get(key);
    const att = attendance.get(key);

    // Merge contact details across the files rather than picking one source.
    // Once the crosswalk has merged a person, the phone only exists on the
    // leads/call row and the name is often best on the Zoom row — taking the
    // first non-empty of each means "Who bought" carries both.
    const cands: PersonRef[] = [
      lead?.ref,
      call?.ref,
      ...(att ? [...att.values()].map((x) => x.ref) : []),
    ].filter(Boolean) as PersonRef[];
    const ref: PersonRef = {
      key,
      phone: cands.find((r) => r.phone)?.phone ?? null,
      email: cands.find((r) => r.email)?.email ?? null,
      name: cands.find((r) => r.name)?.name ?? null,
    };

    // Which sessions does this person occupy?
    let sessionKeys: string[];
    if (att && att.size) sessionKeys = [...att.keys()];
    else if (lead?.session_key) sessionKeys = [lead.session_key];
    else {
      const guess = nearestSession(call?.first_call ?? lead?.registered_at ?? null);
      sessionKeys = [guess ?? '__all__'];
    }
    if (sessionKeys.includes('__all__') && sessionKeys.length === 1) touchSession('__all__', { topic: '(no session dimension)' });

    for (const sk of sessionKeys) {
      const session = sessions.get(sk);
      const aRec = att?.get(sk);
      const watch = aRec?.watch ?? null;
      const showed = !!aRec && (watch == null || watch >= a.showed_up_min_minutes);
      const turns = call?.talk_turns ?? null;

      // "Actually talked" = connected AND the longest single call cleared the
      // duration floor. `talk_rule` decides whether that floor is merely an
      // extra cohort or also tightens `connected` itself.
      const clearedFloor = !!call?.connected && call.best_seconds >= a.talk_min_seconds;
      const talked = a.talk_rule === 'off' ? !!call?.connected : clearedFloor;
      const connected =
        a.talk_rule === 'tighten_connected' ? clearedFloor : !!call?.connected;

      const registered = hasLeads ? !!lead : !!call;
      const fact: Fact = {
        person_key: key,
        session_key: sk,
        name: ref.name ?? aRec?.ref.name ?? null,
        phone: ref.phone,
        email: ref.email,
        registered,
        dialled: !!call,
        connected,
        talk_turns: turns,
        engaged: turns != null && turns >= a.engaged_min_turns,
        talked,
        bots: call ? [...call.reached_bots].sort() : [],
        bot_id: call ? botLabel(call.reached_bots) : null,
        call_mode: call ? (call.modes.has('manual') && !call.modes.has('ai') ? 'manual' : call.modes.has('manual') ? 'manual' : 'ai') : null,
        call_time: call?.first_call ?? null,
        call_seconds: call ? Math.round(call.seconds) : null,
        showed_up: showed,
        watch_minutes: watch,
        left_early: showed && watch != null && watch < a.left_early_minutes,
        came_back: hasComebackSource ? comeback.has(key) : (aRec?.joins ?? 0) > 1,
        bought: false,
        order_value: null,
        order_time: null,
        holdout: registered && !call,
        week: session?.week ?? null,
        session_date: session?.date ?? null,
        ai_week: false,
      };
      factList.push(fact);
      const arr = factIndex.get(key);
      if (arr) arr.push(fact);
      else factIndex.set(key, [fact]);
    }
  }

  stats.leads.unique_people = leads.size;
  stats.calls.unique_people = calls.size;
  stats.attendance.unique_people = attendance.size;
  stats.comeback.unique_people = comeback.size;
  stats.calls.matched_to_leads = [...calls.keys()].filter((k) => leads.has(k)).length;
  stats.attendance.matched_to_leads = [...attendance.keys()].filter((k) => leads.has(k)).length;

  // ------------------------------------------------------- sale attribution
  const unattributed: OrderRecord[] = [];
  for (const o of orders) {
    if (!o.relevant) {
      o.reason = 'excluded product';
      unattributed.push(o);
      continue;
    }
    const candidates = o.person_key ? factIndex.get(o.person_key) ?? [] : [];
    if (!candidates.length) {
      o.reason = o.person_key ? 'buyer not found in leads / calls / attendance' : 'no usable phone or email';
      unattributed.push(o);
      continue;
    }
    const hit = attribute(o, candidates, sessions, a);
    if (!hit) {
      o.reason = `no call or session within ${a.attribution_days} days before the order`;
      unattributed.push(o);
      continue;
    }
    o.attributed_session = hit.session_key;
    o.within_window = true;
    hit.bought = true;
    hit.order_value = (hit.order_value ?? 0) + o.amount;
    if (!hit.order_time || (o.order_time && o.order_time < hit.order_time)) hit.order_time = o.order_time;
    stats.sales.matched_to_leads++;
  }

  // ----------------------------------------------------------- AI/non-AI weeks
  let aiWeeks: string[];
  if (a.ai_weeks.length) {
    aiWeeks = [...a.ai_weeks];
  } else {
    const inferred = new Set<string>();
    for (const f of factList) if (f.dialled && f.call_mode === 'ai' && f.week) inferred.add(f.week);
    aiWeeks = [...inferred].sort();
    if (aiWeeks.length) notes.push(`AI weeks inferred from the call log: ${aiWeeks.join(', ')}.`);
  }
  const aiWeekSet = new Set(aiWeeks);
  for (const f of factList) f.ai_week = !!f.week && aiWeekSet.has(f.week);

  return {
    facts: factList,
    sessions: [...sessions.values()].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '')),
    stats,
    orders,
    unattributed_orders: unattributed,
    cost: { talk_minutes: Math.round(talkMinutes * 100) / 100, amount: costAmount, from_file: costFromFile },
    ai_weeks: aiWeeks,
    has_leads: hasLeads,
    has_talk_turns: hasTalkTurns,
    has_manual_calls: hasManual,
    has_comeback_source: hasComebackSource,
    has_duration: hasDuration,
    sales_meta: {
      coupon_zero: couponZeroCount,
      zero_no_coupon: zeroNoCouponCount,
      missing_amount_col: missingAmountCol,
      // A price was needed (no amount column, or a coupon ₹0 to value) but
      // neither a per-product list price nor a flat default is configured.
      price_unset:
        (missingAmountCol || couponZeroCount > 0) &&
        !(a.product_prices ?? []).length &&
        a.default_order_value == null,
    },
    bots: [...botsSeen].sort(),
    notes,
  };
}

// Primary bot label for display. `Fact.bots` carries the full set — a lead
// reached by two bots is counted under EACH of them in the per-bot table (plus a
// "2+ bots" row), matching the shipped Coacheasily report.
function botLabel(reached: Set<string>): string | null {
  if (!reached.size) return null;
  if (reached.size > 1) return 'multiple';
  return [...reached][0];
}

// Attach an order to the person's best-matching fact row.
// Rule: the order must come AFTER the anchor (call time, else session start)
// and within attribution_days of it. Latest qualifying anchor wins.
function attribute(
  o: OrderRecord,
  candidates: Fact[],
  sessions: Map<string, SessionInfo>,
  a: Assumptions
): Fact | null {
  if (!o.order_time) {
    // No order timestamp at all: attribute to the person's first fact and let
    // the quality panel report it rather than silently dropping revenue.
    o.reason = 'order has no timestamp — attributed without a window check';
    return candidates[0] ?? null;
  }
  const t = Date.parse(o.order_time);
  let best: Fact | null = null;
  let bestAnchor = -Infinity;

  for (const f of candidates) {
    const requiresCall = a.attribution_requires_call || f.dialled;
    const anchorIso = f.dialled ? f.call_time : sessions.get(f.session_key)?.start_time ?? null;
    if (requiresCall && !f.call_time) continue;
    if (!anchorIso) {
      // No anchor available (no session date, no call): accept, lowest priority.
      if (bestAnchor === -Infinity && !best) best = f;
      continue;
    }
    const anchor = Date.parse(anchorIso);
    if (Number.isNaN(anchor)) continue;
    const days = (t - anchor) / 86_400_000;
    if (days < 0 || days > a.attribution_days) continue;
    if (anchor > bestAnchor) {
      bestAnchor = anchor;
      best = f;
    }
  }
  return bestAnchor === -Infinity ? (best && !best.call_time && !sessions.get(best.session_key)?.start_time ? best : null) : best;
}

// --- analysis view ---------------------------------------------------------

// unique_member: one row per person for the whole report (flags OR'd, values
// summed). raw_row: the per-(person x session) rows as-is. The active mode is
// printed on every output — the two answer different questions and the gap
// between them has caused re-versions before.
export function analysisFacts(facts: Fact[], mode: 'unique_member' | 'raw_row'): Fact[] {
  if (mode === 'raw_row') return facts;
  const byPerson = new Map<string, Fact>();
  for (const f of facts) {
    const cur = byPerson.get(f.person_key);
    if (!cur) {
      byPerson.set(f.person_key, { ...f });
      continue;
    }
    cur.registered ||= f.registered;
    cur.dialled ||= f.dialled;
    cur.connected ||= f.connected;
    cur.engaged ||= f.engaged;
    cur.talked ||= f.talked;
    if (f.bots?.length) cur.bots = [...new Set([...(cur.bots ?? []), ...f.bots])].sort();
    cur.showed_up ||= f.showed_up;
    cur.left_early ||= f.left_early;
    cur.came_back ||= f.came_back;
    cur.holdout = cur.registered && !cur.dialled;
    if (f.talk_turns != null) cur.talk_turns = Math.max(cur.talk_turns ?? 0, f.talk_turns);
    if (f.watch_minutes != null) cur.watch_minutes = (cur.watch_minutes ?? 0) + f.watch_minutes;
    if (f.bought) {
      cur.bought = true;
      cur.order_value = (cur.order_value ?? 0) + (f.order_value ?? 0);
      if (!cur.order_time || (f.order_time && f.order_time < cur.order_time)) cur.order_time = f.order_time;
    }
    // Keep the earliest session as the person's home session.
    if ((f.session_date ?? '9999') < (cur.session_date ?? '9999')) {
      cur.session_key = f.session_key;
      cur.session_date = f.session_date;
      cur.week = f.week;
      cur.ai_week = f.ai_week;
    }
    if (!cur.bot_id && f.bot_id) cur.bot_id = f.bot_id;
    if (!cur.call_time && f.call_time) cur.call_time = f.call_time;
  }
  return [...byPerson.values()];
}
