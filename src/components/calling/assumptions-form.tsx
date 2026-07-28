'use client';

import { Field, StatusSelect } from '@/components/ui';
import type { Assumptions } from '@/lib/reports/types';

// Every knob that has ever caused a hand-built report to be re-versioned lives
// here. Changing one and re-running is a full regeneration off the stored raw
// rows — nothing is re-uploaded.

export function AssumptionsForm({
  value,
  onChange,
}: {
  value: Assumptions;
  onChange: (next: Assumptions) => void;
}) {
  const set = <K extends keyof Assumptions>(k: K, v: Assumptions[K]) => onChange({ ...value, [k]: v });
  const num = (k: keyof Assumptions, v: string, allowNull = false) => {
    if (allowNull && v.trim() === '') return onChange({ ...value, [k]: null } as Assumptions);
    const n = Number(v);
    onChange({ ...value, [k]: (Number.isFinite(n) ? n : 0) as never });
  };
  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <Section title="Counting">
        <div className="field-row">
          <Field
            label="Counting mode"
            hint="One person who registered for five webinars is either one row or five. This is printed on every output."
          >
            <StatusSelect
              value={value.dedup_mode}
              onChange={(v) => set('dedup_mode', v as Assumptions['dedup_mode'])}
              options={[
                { value: 'unique_member', label: 'Per unique member' },
                { value: 'raw_row', label: 'Per raw row (person × session)' },
              ]}
            />
          </Field>
          <Field label="Minimum cohort size" hint="Below this a comparison is flagged as underpowered.">
            <input className="input" type="number" value={value.min_cohort_n} onChange={(e) => num('min_cohort_n', e.target.value)} />
          </Field>
        </div>
        <Field label="Significance level (α)" hint="Two-sided pooled z-test on each pair of rates.">
          <input
            className="input"
            type="number"
            step="0.01"
            value={value.significance_alpha}
            onChange={(e) => num('significance_alpha', e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Calling">
        <Field label="Statuses that count as connected" hint="Comma separated, matched case-insensitively against the call status column.">
          <input
            className="input"
            value={value.connected_statuses.join(', ')}
            onChange={(e) => set('connected_statuses', list(e.target.value))}
          />
        </Field>
        <div className="field-row-3">
          <Field
            label="Talk turns to count as engaged"
            hint="Also the threshold for the “Buyers who actually talked” sheet."
          >
            <input
              className="input"
              type="number"
              value={value.engaged_min_turns}
              onChange={(e) => num('engaged_min_turns', e.target.value)}
            />
          </Field>
          <Field
            label="“Actually talked” rule"
            hint="A connected status alone counts a 2-second pickup as a conversation. This adds a duration floor."
          >
            <StatusSelect
              value={value.talk_rule}
              onChange={(v) => set('talk_rule', v as Assumptions['talk_rule'])}
              options={[
                { value: 'cohort', label: 'Separate “talked” cohort' },
                { value: 'tighten_connected', label: 'Tighten “connected” itself' },
                { value: 'off', label: 'Off — ignore call duration' },
              ]}
            />
          </Field>
          <Field
            label="Talked if the call lasted ≥ (seconds)"
            hint="Measured on the longest SINGLE connected call, not the sum of attempts."
          >
            <input
              className="input"
              type="number"
              value={value.talk_min_seconds}
              onChange={(e) => num('talk_min_seconds', e.target.value)}
              disabled={value.talk_rule === 'off'}
            />
          </Field>
        </div>
        <div className="tip" style={{ fontSize: 12, marginBottom: 10 }}>
          Bot names are <b>detected automatically</b> from the call log’s bot/campaign column — one row per bot in the
          per-bot table, however many there are. Check the Data quality panel for the list it found.
        </div>
        <Field
          label="AI weeks"
          hint="ISO weeks (2026-W27, 2026-W28) that count as AI weeks for the time-based comparison. Leave blank to infer them from the call log."
        >
          <input className="input" value={value.ai_weeks.join(', ')} onChange={(e) => set('ai_weeks', list(e.target.value))} />
        </Field>
        <Check
          label="AI vs manual assignment was random / alternating"
          hint="Only tick this if which leads went to the AI dialer had nothing to do with lead quality. It upgrades L4 from directional to causally credible."
          checked={value.l4_randomised}
          onChange={(v) => set('l4_randomised', v)}
        />
      </Section>

      <Section title="Attendance">
        <div className="field-row-3">
          <Field label="Minutes to count as showed up">
            <input
              className="input"
              type="number"
              value={value.showed_up_min_minutes}
              onChange={(e) => num('showed_up_min_minutes', e.target.value)}
            />
          </Field>
          <Field label="Left early below (minutes)">
            <input
              className="input"
              type="number"
              value={value.left_early_minutes}
              onChange={(e) => num('left_early_minutes', e.target.value)}
            />
          </Field>
          <Field label="Minimum attendees per session" hint="Below this a session is treated as a Zoom test room.">
            <input
              className="input"
              type="number"
              value={value.min_session_attendees}
              onChange={(e) => num('min_session_attendees', e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="When both an upload and the Zoom API cover a session"
          hint="One source wins outright per session — the two count watch time differently, so mixing them inside one session would be worse than either."
        >
          <StatusSelect
            value={value.attendance_precedence}
            onChange={(v) => set('attendance_precedence', v as Assumptions['attendance_precedence'])}
            options={[
              { value: 'upload', label: 'Uploaded export wins' },
              { value: 'zoom_api', label: 'Zoom API wins' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Identity matching">
        <Check
          label="Bridge email ↔ phone using the leads file (recommended)"
          hint="A Zoom attendance export has no phone column, so without this it can never join a phone-keyed call log — show-up rate collapses to ~0%. The leads file carries both, so it is used as the bridge."
          checked={value.crosswalk_enabled}
          onChange={(v) => set('crosswalk_enabled', v)}
        />
        <Check
          label="Also bridge on name (risky)"
          hint="Names collide far more than emails — two real people called Rahul Sharma, or “Admin”, would be merged into one. Only turn this on when a file has neither phone nor email."
          checked={value.crosswalk_use_name}
          onChange={(v) => set('crosswalk_use_name', v)}
        />
      </Section>

      <Section title="Sales attribution">
        <div className="field-row">
          <Field label="Attribution window (days)" hint="The order must land after the call and within this many days of it.">
            <input
              className="input"
              type="number"
              value={value.attribution_days}
              onChange={(e) => num('attribution_days', e.target.value)}
            />
          </Field>
          <Field label="Notional value of a ₹0 / 100%-off order" hint="Fallback only — a coupon ₹0 order prefers the product price below.">
            <input
              className="input"
              type="number"
              value={value.zero_order_value}
              onChange={(e) => num('zero_order_value', e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Coupon codes that make a ₹0 order real"
          hint="Comma separated. Leave blank to accept ANY non-empty coupon value. A ₹0 order with a matching code is valued at the product price below."
        >
          <input
            className="input"
            value={value.coupon_codes.join(', ')}
            onChange={(e) => set('coupon_codes', list(e.target.value))}
            placeholder="FREE100, LAUNCH, VIPACCESS"
          />
        </Field>
        <Field
          label="₹0 orders with NO coupon code"
          hint="If a client's export simply has no coupon column, “Drop” will silently remove real sales — the Data quality panel reports the count either way."
        >
          <StatusSelect
            value={value.zero_without_coupon}
            onChange={(v) => set('zero_without_coupon', v as Assumptions['zero_without_coupon'])}
            options={[
              { value: 'exclude', label: 'Drop them — treat as test / free rows' },
              { value: 'count_zero', label: 'Count as buyers, ₹0 revenue' },
              { value: 'count_notional', label: 'Count and apply the notional value' },
            ]}
          />
        </Field>
        <ProductPrices value={value} onChange={onChange} />
        <div className="field-row">
          <Field label="Order value when the file has no amount column" hint="Blank = treat as ₹0.">
            <input
              className="input"
              type="number"
              value={value.default_order_value ?? ''}
              onChange={(e) => num('default_order_value', e.target.value, true)}
            />
          </Field>
          <Field label="Products that are NOT the course" hint="Comma separated substrings, e.g. Pot-Painting, Book of Records.">
            <input
              className="input"
              value={value.exclude_products.join(', ')}
              onChange={(e) => set('exclude_products', list(e.target.value))}
            />
          </Field>
        </div>
        <Check
          label="Only attribute sales to people we actually called"
          hint="Off: buyers we never dialled are anchored on the session start instead, so they still appear in the funnel."
          checked={value.attribution_requires_call}
          onChange={(v) => set('attribution_requires_call', v)}
        />
      </Section>

      <Section title="Cost (drives ROI)">
        <div className="field-row-3">
          <Field label="₹ per talk-minute">
            <input
              className="input"
              type="number"
              step="0.01"
              value={value.cost_per_talk_minute}
              onChange={(e) => num('cost_per_talk_minute', e.target.value)}
            />
          </Field>
          <Field label="₹ telephony per minute">
            <input
              className="input"
              type="number"
              step="0.01"
              value={value.telephony_per_minute}
              onChange={(e) => num('telephony_per_minute', e.target.value)}
            />
          </Field>
          <Field label="Fixed cost (₹)">
            <input className="input" type="number" value={value.fixed_cost} onChange={(e) => num('fixed_cost', e.target.value)} />
          </Field>
        </div>
      </Section>
    </>
  );
}

// Per-product list price. Needed in two places: to value a 100%-off coupon
// order, and when the sales export has no amount column at all. Without one of
// these the report quietly reports ₹0 revenue, so the quality panel blocks the
// export until a price exists.
function ProductPrices({
  value,
  onChange,
}: {
  value: Assumptions;
  onChange: (next: Assumptions) => void;
}) {
  const rows = value.product_prices ?? [];
  const write = (next: Assumptions['product_prices']) => onChange({ ...value, product_prices: next });
  const setRow = (i: number, patch: Partial<{ match: string; price: number }>) =>
    write(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-label" style={{ fontSize: 13 }}>
        Product list prices
      </div>
      <div className="sub" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        Matched as a substring of the product name; the longest match wins. Used for ₹0 coupon orders and for files with no
        amount column. Leave empty and set “Order value when the file has no amount column” instead if every product is
        the same price.
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 2 }}
            value={r.match}
            placeholder="product name contains…"
            onChange={(e) => setRow(i, { match: e.target.value })}
          />
          <input
            className="input"
            style={{ flex: 1 }}
            type="number"
            value={r.price}
            placeholder="₹ price"
            onChange={(e) => setRow(i, { price: Number(e.target.value) || 0 })}
          />
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12, color: 'var(--red)' }}
            onClick={() => write(rows.filter((_, idx) => idx !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        style={{ padding: '4px 10px', fontSize: 12 }}
        onClick={() => write([...rows, { match: '', price: 0 }])}
      >
        + Add product price
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="section-label" style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="set-row" style={{ borderTop: 'none', paddingTop: 0 }}>
      <div className="l">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <button className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-label={label}>
        <i />
      </button>
    </div>
  );
}
