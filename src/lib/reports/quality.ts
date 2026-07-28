// The data-quality panel. Numbers cannot leave this tool until an operator has
// looked at this. Every re-version of a hand-built report started as something
// on this list that nobody checked: a phone format the script did not strip, a
// duplicate registrant counted twice, a test number in the lead file, a sale
// that landed three weeks after the call.

import type { Assumptions, Fact, QualityMetric, QualityPanel, SessionInfo } from './types';
import type { FactBuild } from './facts';

export function buildQuality(
  build: FactBuild,
  analysis: Fact[],
  a: Assumptions,
  denominator: number,
  denominatorLabel: string
): QualityPanel {
  const m: QualityMetric[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const s = build.stats;

  const rate = (num: number, den: number) => (den > 0 ? num / den : 0);
  const pctDisplay = (v: number) => `${(v * 100).toFixed(1)}%`;

  // --- identity ------------------------------------------------------------
  // Both match-rate checks below compare against the leads file, so they are
  // meaningless (and would misreport a false "0% matched, blocking" state)
  // when no leads/registrations file was uploaded at all — leads is optional.
  const callMatch = rate(s.calls.matched_to_leads, s.calls.unique_people);
  if (build.has_leads && s.calls.unique_people > 0) {
    m.push({
      key: 'phone_match_rate',
      label: 'Phone match rate — call log → leads',
      value: callMatch,
      display: pctDisplay(callMatch),
      severity: sev(callMatch, 0.9, 0.75),
      detail: `${s.calls.matched_to_leads.toLocaleString()} of ${s.calls.unique_people.toLocaleString()} dialled people were found in the leads file.`,
    });
    if (callMatch < 0.75)
      blockers.push(
        `Only ${pctDisplay(callMatch)} of dialled numbers matched a lead. Check the phone column mapping and the number format before trusting any rate on this report.`
      );
  }

  const attMatch = rate(s.attendance.matched_to_leads, s.attendance.unique_people);
  if (build.has_leads && s.attendance.unique_people > 0) {
    m.push({
      key: 'attendance_match_rate',
      label: 'Attendee match rate — attendance → leads',
      value: attMatch,
      display: pctDisplay(attMatch),
      severity: sev(attMatch, 0.85, 0.6),
      detail: `${s.attendance.matched_to_leads.toLocaleString()} of ${s.attendance.unique_people.toLocaleString()} attendees matched a registrant. Zoom logins often carry no phone — email carries the match.`,
    });
    // A Zoom export has no phone column, so without the crosswalk attendance
    // simply cannot join a phone-keyed call log. Say so explicitly rather than
    // leaving a red 0% that looks like a mapping mistake.
    if (attMatch < 0.6 && a.crosswalk_enabled === false) {
      blockers.push(
        `Attendee match is ${pctDisplay(attMatch)} and the identity crosswalk is OFF. A Zoom export carries no phone number, ` +
          'so attendance can only join through email. Turn the crosswalk on in Assumptions and re-run.'
      );
    } else if (attMatch < 0.6) {
      blockers.push(
        `Only ${pctDisplay(attMatch)} of attendees matched a registrant. Show-up rate is meaningless until this is fixed — ` +
          'check that BOTH the leads file and the attendance file have their email column mapped, since email is the only shared identifier.'
      );
    }
  }

  // --- identity crosswalk --------------------------------------------------
  const crosswalked = s.leads.crosswalked + s.calls.crosswalked + s.attendance.crosswalked + s.sales.crosswalked;
  if (a.crosswalk_enabled !== false && (crosswalked > 0 || s.attendance.unique_people > 0)) {
    m.push({
      key: 'identity_crosswalked',
      label: 'Rows joined via the email→phone crosswalk',
      value: crosswalked,
      display: crosswalked.toLocaleString(),
      severity: 'ok',
      detail:
        'Rows that arrived with only an email (typically Zoom attendance) and were resolved onto the registrant’s phone number. ' +
        'Without this they would count as separate people.',
    });
  }

  const salesTotal = build.orders.length;
  const salesMatched = build.orders.filter((o) => o.within_window).length;
  const salesRate = rate(salesMatched, salesTotal);
  if (salesTotal > 0) {
    m.push({
      key: 'sales_match_rate',
      label: 'Sales attributed',
      value: salesRate,
      display: `${pctDisplay(salesRate)} (${salesMatched}/${salesTotal})`,
      severity: sev(salesRate, 0.8, 0.5),
      detail: 'Orders matched to a person AND landing inside the attribution window.',
    });
  }

  const unmatchedRows =
    s.calls.rows - s.calls.identified + (s.attendance.rows - s.attendance.identified) + (s.leads.rows - s.leads.identified);
  m.push({
    key: 'unmatched_rows',
    label: 'Rows with no usable identity',
    value: unmatchedRows,
    display: unmatchedRows.toLocaleString(),
    severity: unmatchedRows === 0 ? 'ok' : unmatchedRows < 25 ? 'warn' : 'bad',
    detail: 'Rows with no phone, email or name — silently dropped from every count.',
  });

  const invalid = s.leads.invalid_phone + s.calls.invalid_phone + s.attendance.invalid_phone + s.sales.invalid_phone;
  if (invalid > 0) {
    m.push({
      key: 'invalid_phones',
      label: 'Phone values that would not normalise',
      value: invalid,
      display: invalid.toLocaleString(),
      severity: invalid < 25 ? 'warn' : 'bad',
      detail: 'Fewer than 10 digits after stripping +91 / 0 / formatting. These rows fall back to email or are dropped.',
    });
  }

  const nameOnly = s.leads.name_only + s.calls.name_only + s.attendance.name_only;
  if (nameOnly > 0) {
    m.push({
      key: 'name_only_keys',
      label: 'People keyed by name only',
      value: nameOnly,
      display: nameOnly.toLocaleString(),
      severity: nameOnly < 25 ? 'warn' : 'bad',
      detail: 'Names are inconsistent across exports — these are the rows most likely to double-count or fail to join.',
    });
  }

  // --- dedup / exclusions --------------------------------------------------
  const collapsed =
    Math.max(0, s.leads.identified - s.leads.unique_people) +
    Math.max(0, s.calls.identified - s.calls.unique_people) +
    Math.max(0, s.attendance.identified - s.attendance.unique_people);
  m.push({
    key: 'duplicates_collapsed',
    label: 'Duplicate rows collapsed',
    value: collapsed,
    display: collapsed.toLocaleString(),
    severity: 'ok',
    detail: `Same person, several rows (a lead registering for many webinars, several call attempts). Active mode: ${a.dedup_mode === 'unique_member' ? 'per unique member' : 'per raw row'}.`,
  });

  const dropped = s.leads.excluded + s.calls.excluded + s.attendance.excluded + s.sales.excluded;
  m.push({
    key: 'test_numbers_dropped',
    label: 'Test / internal rows dropped',
    value: dropped,
    display: dropped.toLocaleString(),
    severity: 'ok',
    detail: 'Matched the client’s exclusion list (phones, emails, domains, names).',
  });

  // --- attribution ---------------------------------------------------------
  const outside = build.unattributed_orders.filter((o) => (o.reason ?? '').includes('within')).length;
  const notFound = build.unattributed_orders.filter((o) => (o.reason ?? '').includes('not found')).length;
  const excludedProduct = build.unattributed_orders.filter((o) => o.reason === 'excluded product').length;
  m.push({
    key: 'sales_outside_window',
    label: `Sales outside the ${a.attribution_days}-day attribution window`,
    value: outside,
    display: outside.toLocaleString(),
    severity: outside === 0 ? 'ok' : 'warn',
    detail: 'Order landed before the call, or more than N days after it. Widen the window in Assumptions and re-run if that is wrong.',
  });
  if (notFound > 0) {
    m.push({
      key: 'buyers_not_in_universe',
      label: 'Buyers not found in leads / calls / attendance',
      value: notFound,
      display: notFound.toLocaleString(),
      severity: notFound < 10 ? 'warn' : 'bad',
      detail: 'They bought under a phone or email that appears nowhere else. The buyer count is a FLOOR, never an exact figure.',
    });
  }
  if (excludedProduct > 0) {
    m.push({
      key: 'excluded_product_orders',
      label: 'Orders for excluded products',
      value: excludedProduct,
      display: excludedProduct.toLocaleString(),
      severity: 'ok',
      detail: `Filtered by exclude_products: ${a.exclude_products.join(', ') || '(none)'}.`,
    });
  }

  // --- ₹0 orders and coupons ----------------------------------------------
  const sm = build.sales_meta;
  if (sm.coupon_zero > 0) {
    m.push({
      key: 'coupon_zero_orders',
      label: '₹0 orders accepted on a coupon code',
      value: sm.coupon_zero,
      display: sm.coupon_zero.toLocaleString(),
      severity: 'ok',
      detail:
        `100%-off orders carrying a coupon code — counted as real sales and valued at the product's list price` +
        (a.coupon_codes.length ? ` (codes matched: ${a.coupon_codes.join(', ')}).` : ' (any coupon code counts).'),
    });
  }
  if (sm.zero_no_coupon > 0) {
    const dropped = a.zero_without_coupon === 'exclude';
    m.push({
      key: 'zero_no_coupon_orders',
      label: dropped ? '₹0 orders DROPPED (no coupon code)' : '₹0 orders with no coupon code',
      value: sm.zero_no_coupon,
      display: sm.zero_no_coupon.toLocaleString(),
      severity: dropped ? 'warn' : 'ok',
      detail: dropped
        ? 'Treated as test/free rows and excluded from buyers, rates and revenue. If this export simply has no coupon column, ' +
          'these were real sales — change "₹0 orders with no coupon" in Assumptions and re-run.'
        : a.zero_without_coupon === 'count_notional'
          ? `Counted as buyers and valued at ₹${a.zero_order_value.toLocaleString()} each (notional).`
          : 'Counted as buyers with ₹0 revenue.',
    });
  }
  // "Ask for the product price" — enforced, not merely suggested. Without a
  // price these orders would silently contribute ₹0 to revenue and ROI.
  if (sm.price_unset) {
    blockers.push(
      sm.missing_amount_col
        ? 'The sales file has no amount column, and no product price is configured. Set a per-product list price (or a flat ' +
          'default order value) in Assumptions — otherwise every order is worth ₹0 and revenue and ROI are wrong.'
        : 'There are ₹0 coupon orders to value, but no product price is configured. Set a per-product list price (or a flat ' +
          'default order value) in Assumptions.'
    );
  }
  if (a.product_prices.length) {
    m.push({
      key: 'product_prices',
      label: 'Product list prices configured',
      value: a.product_prices.length,
      display: a.product_prices.map((p) => `${p.match}: ₹${Number(p.price).toLocaleString()}`).join(' · '),
      severity: 'ok',
      detail: 'Used to value ₹0 coupon orders and any order with no amount column. Longest product-name match wins.',
    });
  }

  // --- bots (auto-detected) -------------------------------------------------
  if (build.bots.length) {
    m.push({
      key: 'bots_detected',
      label: 'Bots found in the call log',
      value: build.bots.length,
      display: build.bots.join(' · '),
      severity: 'ok',
      detail:
        'Taken verbatim from the bot/campaign column — nothing is configured. Two spellings of the same bot become two ' +
        'separate rows in the per-bot table, so check this list for typos.',
    });
  }

  // --- "actually talked" ----------------------------------------------------
  if (a.talk_rule !== 'off' && build.has_duration) {
    const connected = analysis.filter((f) => f.connected).length;
    const talked = analysis.filter((f) => f.talked).length;
    const talkRate = rate(talked, connected);
    m.push({
      key: 'talked_rate',
      label: `Connected calls lasting ≥ ${a.talk_min_seconds}s`,
      value: talkRate,
      display: `${pctDisplay(talkRate)} (${talked.toLocaleString()}/${connected.toLocaleString()})`,
      severity: 'ok',
      detail:
        a.talk_rule === 'tighten_connected'
          ? `The ${a.talk_min_seconds}s floor is TIGHTENING "connected" — the funnel's Connected row already excludes shorter pickups.`
          : `Measured on the longest single connected call. "Connected" is unchanged; this is a separate cohort.`,
    });
  } else if (a.talk_rule !== 'off' && !build.has_duration) {
    warnings.push(
      `A ${a.talk_min_seconds}s talk floor is configured but no call-duration column was mapped, so nobody can clear it. ` +
        'Map the duration column, or set the talk rule to "off".'
    );
  }

  // --- coverage ------------------------------------------------------------
  const dated = build.sessions.filter((x) => x.date && x.key !== '__all__');
  const undated = build.sessions.filter((x) => !x.date && x.key !== '__all__').length;
  const coverage = coverageNote(dated);
  m.push({
    key: 'date_coverage',
    label: 'Session date coverage',
    value: dated.length,
    display: `${dated.length} session${dated.length === 1 ? '' : 's'}`,
    severity: dated.length ? 'ok' : 'warn',
    detail: coverage,
  });
  if (undated > 0)
    warnings.push(`${undated} session(s) have no date — they cannot take part in the week-based (L3) comparison.`);

  const excludedSessions = build.sessions.filter((x) => x.excluded).length;
  if (excludedSessions > 0) {
    m.push({
      key: 'small_sessions_excluded',
      label: 'Sessions below the attendee floor',
      value: excludedSessions,
      display: excludedSessions.toLocaleString(),
      severity: 'ok',
      detail: `Fewer than ${a.min_session_attendees} unique attendees — treated as Zoom practice/test rooms and excluded from per-webinar tables.`,
    });
  }

  // --- denominator lock ----------------------------------------------------
  const registered = analysis.filter((f) => f.registered).length;
  const locked = denominator > 0;
  m.push({
    key: 'denominator',
    label: 'Locked denominator',
    value: denominator,
    display: denominator.toLocaleString(),
    severity: locked ? 'ok' : 'bad',
    detail: `${denominatorLabel}. Every sheet in this report divides by this one number.`,
  });
  if (!locked) blockers.push('The report has no population — nothing joined. Check the column mappings on every input.');
  if (registered > 0 && registered !== denominator && a.dedup_mode === 'unique_member')
    warnings.push(
      `Denominator (${denominator.toLocaleString()}) differs from the registered count (${registered.toLocaleString()}) because people appear in the call or attendance file without a matching registration.`
    );

  for (const n of build.notes) warnings.push(n);

  return {
    metrics: m,
    blockers,
    warnings,
    denominator_locked: locked,
    denominator,
    denominator_label: denominatorLabel,
    hash: hashPanel(m, denominator),
  };
}

function coverageNote(dated: SessionInfo[]): string {
  if (!dated.length) return 'No session dates were found in the attendance data.';
  const days = dated.map((s) => s.date!).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const span = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
  const weeks = new Set(dated.map((s) => s.week).filter(Boolean)).size;
  return `${first} → ${last} (${span} days, ${weeks} ISO week${weeks === 1 ? '' : 's'}). Partial coverage at either end will bias a week-based comparison.`;
}

function sev(v: number, okAt: number, warnAt: number): QualityMetric['severity'] {
  if (v >= okAt) return 'ok';
  if (v >= warnAt) return 'warn';
  return 'bad';
}

// Acknowledging the panel acknowledges THESE numbers. Re-running with different
// assumptions changes the hash and forces a fresh look before the next export.
function hashPanel(metrics: QualityMetric[], denominator: number): string {
  const payload = JSON.stringify([denominator, metrics.map((x) => [x.key, x.value])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
