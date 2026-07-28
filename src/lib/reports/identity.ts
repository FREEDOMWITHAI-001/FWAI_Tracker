// Identity resolution — the single highest-leverage piece of the engine.
//
// Indian mobile numbers arrive as 9876543210, +919876543210, 919876543210,
// 09876543210 and ="+919876543210" (Excel's text-guard prefix, which Zoom and
// several CRMs emit). Every one of those is the same person. We normalise to
// the last 10 digits and fall back to email. Roughly 80% of a report's overall
// accuracy is decided here — a 5% phone-match miss silently moves every rate.

export interface Person {
  key: string;
  phone: string | null;
  email: string | null;
  name: string | null;
}

export interface PhoneResult {
  digits: string | null; // normalised last-10
  raw: string;
  valid: boolean; // looks like an Indian mobile (10 digits starting 6-9)
  reason?: string;
}

export function normalisePhone(raw: unknown): PhoneResult {
  const s = String(raw ?? '').trim();
  if (!s) return { digits: null, raw: s, valid: false, reason: 'empty' };

  const all = s.replace(/\D/g, '');
  if (!all) return { digits: null, raw: s, valid: false, reason: 'no digits' };

  // Strip the country code / trunk prefix, then keep the subscriber number.
  let d = all;
  if (d.length > 10) {
    if (d.startsWith('91') && d.length >= 12) d = d.slice(-10);
    else if (d.startsWith('0')) d = d.replace(/^0+/, '');
    if (d.length > 10) d = d.slice(-10);
  }

  if (d.length < 10) return { digits: null, raw: s, valid: false, reason: `only ${d.length} digits` };
  const valid = /^[6-9]\d{9}$/.test(d);
  return { digits: d, raw: s, valid, reason: valid ? undefined : 'not a 10-digit Indian mobile' };
}

export function phone10(raw: unknown): string | null {
  return normalisePhone(raw).digits;
}

export function normaliseEmail(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || !s.includes('@')) return null;
  return s;
}

export function normaliseName(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
}

// Phone first, email second, name last. A name-only key is weak (names are
// inconsistent across exports) so we prefix it — the quality panel counts them.
export function personKey(phone: string | null, email: string | null, name: string | null): string | null {
  if (phone) return `p:${phone}`;
  if (email) return `e:${email}`;
  const n = name ? name.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  return n ? `n:${n}` : null;
}

export function isNameOnlyKey(key: string): boolean {
  return key.startsWith('n:');
}

// --- identity crosswalk ----------------------------------------------------
//
// The join that makes real Zoom data usable.
//
// personKey is phone-first, but the files disagree about which identifiers they
// carry: the dialer log is built on phone numbers, while a Zoom attendee export
// has Name/Email/Join/Leave and NO phone column at all. So the same human
// becomes `p:9876543210` in the call log and `e:asha@example.com` in Zoom, and
// the two never meet — attendance match rate collapses to ~0% and people who
// watched the whole webinar come out as showed_up:false.
//
// The bridge is the leads file, which carries BOTH. Every row that has a phone
// and an email registers email -> phone (and name -> phone, weaker). Any later
// row that resolves to an email-only or name-only key is then rewritten to the
// canonical phone key.
//
// Deliberately one-directional: we only ever collapse a weaker key onto a
// stronger one (name -> email -> phone), never the reverse, so the canonical id
// for a person is stable no matter what order the files are read in.
export class Crosswalk {
  private emailToPhone = new Map<string, string>();
  private nameToPhone = new Map<string, string>();
  private nameToEmail = new Map<string, string>();
  // An email or name seen against two different phones is ambiguous — we refuse
  // to guess and leave those rows on their own key rather than merging two
  // people (shared family email, "Admin", blank-ish names).
  private ambiguousEmail = new Set<string>();
  private ambiguousName = new Set<string>();

  /** Learn the identifiers on one row. Call for every leads row (and any other
   *  file that carries both a phone and an email). */
  learn(phone: string | null, email: string | null, name: string | null): void {
    const nm = name ? name.toLowerCase().replace(/\s+/g, ' ').trim() : null;
    if (phone && email) {
      const seen = this.emailToPhone.get(email);
      if (seen && seen !== phone) this.ambiguousEmail.add(email);
      else this.emailToPhone.set(email, phone);
    }
    if (phone && nm) {
      const seen = this.nameToPhone.get(nm);
      if (seen && seen !== phone) this.ambiguousName.add(nm);
      else this.nameToPhone.set(nm, phone);
    }
    if (!phone && email && nm && !this.nameToEmail.has(nm)) {
      this.nameToEmail.set(nm, email);
    }
  }

  /**
   * Rewrite a resolved key to its canonical form.
   *
   * `useName` is off by default: names collide far more than emails ("Admin",
   * "Test", two real Rahul Sharmas), so name-based merging is opt-in.
   */
  resolve(key: string, opts: { useName?: boolean } = {}): string {
    if (key.startsWith('p:')) return key; // already strongest

    if (key.startsWith('e:')) {
      const email = key.slice(2);
      if (this.ambiguousEmail.has(email)) return key;
      const phone = this.emailToPhone.get(email);
      return phone ? `p:${phone}` : key;
    }

    if (key.startsWith('n:') && opts.useName) {
      const nm = key.slice(2);
      if (this.ambiguousName.has(nm)) return key;
      const phone = this.nameToPhone.get(nm);
      if (phone) return `p:${phone}`;
      const email = this.nameToEmail.get(nm);
      if (email && !this.ambiguousEmail.has(email)) {
        const viaEmail = this.emailToPhone.get(email);
        return viaEmail ? `p:${viaEmail}` : `e:${email}`;
      }
    }
    return key;
  }

  get stats() {
    return {
      email_links: this.emailToPhone.size,
      name_links: this.nameToPhone.size,
      ambiguous_emails: this.ambiguousEmail.size,
      ambiguous_names: this.ambiguousName.size,
    };
  }
}

// --- per-client exclusion list --------------------------------------------

export interface ExclusionRow {
  kind: 'phone' | 'email' | 'email_domain' | 'name';
  value: string;
}

export class Exclusions {
  private phones = new Set<string>();
  private emails = new Set<string>();
  private domains = new Set<string>();
  private names = new Set<string>();

  constructor(rows: ExclusionRow[] = []) {
    for (const r of rows) {
      const v = String(r.value ?? '').trim();
      if (!v) continue;
      if (r.kind === 'phone') {
        const p = phone10(v);
        if (p) this.phones.add(p);
      } else if (r.kind === 'email') {
        const e = normaliseEmail(v);
        if (e) this.emails.add(e);
      } else if (r.kind === 'email_domain') {
        this.domains.add(v.toLowerCase().replace(/^@/, ''));
      } else {
        this.names.add(v.toLowerCase().trim());
      }
    }
  }

  get size(): number {
    return this.phones.size + this.emails.size + this.domains.size + this.names.size;
  }

  excludes(p: { phone?: string | null; email?: string | null; name?: string | null }): boolean {
    if (p.phone && this.phones.has(p.phone)) return true;
    if (p.email) {
      if (this.emails.has(p.email)) return true;
      const dom = p.email.split('@')[1] ?? '';
      if (dom && this.domains.has(dom)) return true;
    }
    if (p.name && this.names.has(p.name.toLowerCase().trim())) return true;
    return false;
  }
}
