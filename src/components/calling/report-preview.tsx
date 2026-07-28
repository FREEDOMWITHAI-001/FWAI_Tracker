'use client';

import { useState } from 'react';
import { istClock } from '@/lib/reports/dates';
import type { LensResult, ReportResult } from '@/lib/reports/types';

// On-page HTML preview of exactly what the workbook will contain.
//
// The credibility badge is the load-bearing piece of this screen. A lens that
// compares groups the world selected for us (who answered, who we chose to
// dial) is labelled DIRECTIONAL ONLY everywhere it appears, and the headline
// says so too. Flute Gandharvas is why: L1 looked excellent while the unbiased
// L3 showed +0.6% lift and 1.4x ROI.

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
const delta = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const money = (v: number) => `₹${Math.round(v).toLocaleString()}`;

export function CredibilityBadge({ lens }: { lens: LensResult }) {
  const causal = lens.credibility === 'causal';
  return (
    <span
      className={`pill ${causal ? 'healthy' : 'warning'}`}
      title={lens.credibility_note}
      style={{ letterSpacing: 0.3 }}
    >
      {causal ? 'causally credible' : 'directional only'}
    </span>
  );
}

export function ReportPreview({ result }: { result: ReportResult }) {
  const blocks = new Set(result.blocks);
  return (
    <>
      <Scorecard result={result} />
      {blocks.has('funnel') && <Funnel result={result} />}
      <Lenses result={result} />
      {blocks.has('per_webinar') && <PerWebinar result={result} />}
      {blocks.has('roi') && result.roi.available && <Roi result={result} />}
      {result.ai_vs_manual.available && <AiVsManual result={result} />}
      {result.registered_vs_retargeted.available && <RegisteredRetargeted result={result} />}
      {blocks.has('who_bought') && <WhoBought result={result} />}
    </>
  );
}

function Scorecard({ result }: { result: ReportResult }) {
  const s = result.scorecard;
  const causal = s.primary_credibility === 'causal';
  return (
    <>
      <div
        className="tip"
        style={{
          display: 'block',
          background: causal ? 'var(--green-50)' : 'var(--amber-50)',
          borderColor: causal ? 'var(--green)' : 'var(--amber)',
          color: causal ? 'var(--green)' : 'var(--amber)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.headline}</div>
        <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{s.bottom_line}</div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        {s.tiles.map((t) => (
          <div className="stat" key={t.label}>
            <div className="top">
              <span className="lbl">{t.label}</span>
            </div>
            <div className="val">{t.value}</div>
            <div className="delta">{t.detail}</div>
          </div>
        ))}
      </div>

      <div className="meta-row" style={{ marginBottom: 16 }}>
        <span>
          Counting mode: <b>{s.dedup_mode === 'unique_member' ? 'per unique member' : 'per raw row'}</b>
        </span>
        <span>
          Locked denominator: <b>{s.denominator.toLocaleString()}</b> ({s.denominator_label})
        </span>
        <span>
          Sessions: <b>{result.sessions.filter((x) => !x.excluded).length}</b>
        </span>
        <span>
          Fact rows: <b>{result.fact_count.toLocaleString()}</b>
        </span>
      </div>
    </>
  );
}

function Funnel({ result }: { result: ReportResult }) {
  const max = Math.max(...result.funnel.map((f) => f.count), 1);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Funnel</h3>
        <span className="updated">every stage divides by the same locked denominator</span>
      </div>
      <div className="card-b">
        {result.funnel.map((f) => (
          <div className="meter" key={f.stage}>
            <div className="mh">
              <span className="nm">{f.stage}</span>
              <span className="pc">
                {f.count.toLocaleString()} · {pct(f.pct_of_denominator)}
                {f.pct_of_previous != null && ` · ${pct(f.pct_of_previous)} of ${f.pct_of_previous_label}`}
              </span>
            </div>
            <div className="track">
              <i style={{ width: `${(f.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lenses({ result }: { result: ReportResult }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Comparisons</h3>
        <span className="updated">credible lenses first · Δ is relative lift vs the baseline row</span>
      </div>
      <div className="card-b" style={{ paddingTop: 12 }}>
        {result.lenses.map((l) => (
          <LensCard key={l.id} lens={l} />
        ))}
      </div>
    </div>
  );
}

function LensCard({ lens }: { lens: LensResult }) {
  const [open, setOpen] = useState(lens.credibility === 'causal');
  const causal = lens.credibility === 'causal';
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${causal ? 'var(--green)' : 'var(--amber)'}`,
        borderRadius: 10,
        marginBottom: 12,
        opacity: lens.available ? 1 : 0.65,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="resp" style={{ fontWeight: 700 }}>
          {lens.id}
        </span>
        <b style={{ fontSize: 14 }}>{lens.label}</b>
        <CredibilityBadge lens={lens} />
        {!lens.available && <span className="pill neutral">not available</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{open ? '−' : '+'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            {lens.question}
          </div>

          {!lens.available ? (
            <div className="form-err" style={{ background: 'var(--soft-2)', color: 'var(--muted)' }}>
              {lens.unavailable_reason}
            </div>
          ) : (
            <>
              <table className="smatrix">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Group</th>
                    <th style={{ textAlign: 'right' }}>People</th>
                    <th style={{ textAlign: 'right' }}>Showed</th>
                    <th style={{ textAlign: 'right' }}>Show-up %</th>
                    <th style={{ textAlign: 'right' }}>Δ</th>
                    <th style={{ textAlign: 'right' }}>Bought</th>
                    <th style={{ textAlign: 'right' }}>Buyer %</th>
                    <th style={{ textAlign: 'right' }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {lens.rows.map((r) => (
                    <tr key={r.label} style={r.baseline ? { background: 'var(--soft)' } : undefined}>
                      <td style={{ fontWeight: r.baseline ? 600 : 500 }}>{r.label}</td>
                      <td className="num">{r.n.toLocaleString()}</td>
                      <td className="num">{r.showed.toLocaleString()}</td>
                      <td className="num">{pct(r.show_rate)}</td>
                      <td className="num" style={{ color: liftColor(r.show_lift) }}>
                        {r.baseline ? '—' : delta(r.show_lift)}
                      </td>
                      <td className="num">{r.bought.toLocaleString()}</td>
                      <td className="num">{pct(r.buy_rate)}</td>
                      <td className="num" style={{ color: liftColor(r.buy_lift) }}>
                        {r.baseline ? '—' : delta(r.buy_lift)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 10 }}>
                {lens.outcomes.map((o) => (
                  <div key={o.metric} style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 }}>
                    <b style={{ color: 'var(--ink)' }}>{o.label}:</b> {pct(o.a.rate)} ({o.a.k}/{o.a.n}) vs {pct(o.b.rate)} ({o.b.k}/
                    {o.b.n}) — {o.abs_lift >= 0 ? '+' : ''}
                    {(o.abs_lift * 100).toFixed(2)}pp,{' '}
                    <span className={`pill ${o.significance.significant ? 'healthy' : 'neutral'}`}>
                      p = {o.significance.p_value == null ? 'n/a' : o.significance.p_value < 0.001 ? '<0.001' : o.significance.p_value.toFixed(3)}
                      {o.significance.significant ? ' · significant' : ' · not significant'}
                    </span>
                    {o.significance.ci95 && (
                      <>
                        {' '}
                        95% CI {(o.significance.ci95[0] * 100).toFixed(1)}pp to {(o.significance.ci95[1] * 100).toFixed(1)}pp
                      </>
                    )}
                    {o.significance.warnings.map((w, i) => (
                      <div key={i} style={{ color: 'var(--amber)', marginTop: 3 }}>
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <div
            style={{
              marginTop: 10,
              padding: '9px 12px',
              borderRadius: 8,
              background: causal ? 'var(--green-50)' : 'var(--amber-50)',
              color: causal ? 'var(--green)' : 'var(--amber)',
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            {lens.credibility_note}
            {lens.caveats.map((c, i) => (
              <div key={i} style={{ marginTop: 4, color: 'var(--ink)', fontWeight: 400 }}>
                {c}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function liftColor(v: number | null): string {
  if (v == null) return 'var(--faint)';
  return v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)';
}

function PerWebinar({ result }: { result: ReportResult }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Per-webinar breakdown</h3>
        <span className="updated">{result.per_webinar.length} sessions</span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Week</th>
              <th>Topic</th>
              <th>Registered</th>
              <th>Dialled</th>
              <th>Connected</th>
              <th>Showed</th>
              <th>Show-up</th>
              <th>Bought</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {result.per_webinar.length ? (
              result.per_webinar.map((w) => (
                <tr key={w.session_key} style={w.excluded ? { opacity: 0.55 } : undefined}>
                  <td className="sub">{w.date ?? '—'}</td>
                  <td className="sub">
                    {w.week ?? '—'}
                    {w.ai_week && (
                      <span className="pill info" style={{ marginLeft: 6 }}>
                        AI
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="client">{w.topic}</div>
                    {w.excluded && <div className="sub">excluded — below the attendee floor</div>}
                  </td>
                  <td className="resp">{w.registered.toLocaleString()}</td>
                  <td className="resp">{w.dialled.toLocaleString()}</td>
                  <td className="resp">{w.connected.toLocaleString()}</td>
                  <td className="resp">{w.showed.toLocaleString()}</td>
                  <td className="resp">{pct(w.show_rate)}</td>
                  <td className="resp">{w.bought.toLocaleString()}</td>
                  <td className="resp">{money(w.revenue)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} style={{ color: 'var(--faint)', padding: 20 }}>
                  No sessions could be formed — the attendance file has no session id or date column mapped.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Roi({ result }: { result: ReportResult }) {
  const r = result.roi;
  const causal = r.incremental_credibility === 'causal';
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>ROI</h3>
        <span className="updated">{r.talk_minutes.toLocaleString()} talk minutes</span>
      </div>
      <div className="card-b">
        <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 14 }}>
          <Tile label="Total cost" value={money(r.total_cost)} detail={`${money(r.call_cost)} calls + ${money(r.telephony_cost)} telephony`} />
          <Tile label="Attributed revenue" value={money(r.attributed_revenue)} detail="sales from dialled people, in window" />
          <Tile label="Gross ROI" value={r.gross_roi != null ? `${r.gross_roi.toFixed(2)}x` : '—'} detail="flattering — over-credits the dialer" />
          <Tile
            label="Incremental ROI"
            value={r.incremental_roi != null ? `${r.incremental_roi.toFixed(2)}x` : 'n/a'}
            detail={r.incremental_lens ? `via ${r.incremental_lens} · ${causal ? 'credible' : 'directional'}` : 'no credible lens available'}
          />
        </div>
        {r.notes.map((n, i) => (
          <div key={i} className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 4 }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

function RegisteredRetargeted({ result }: { result: ReportResult }) {
  const b = result.registered_vs_retargeted;
  const totalAttended = b.attended_registered + b.attended_retargeted;
  const totalBought = b.bought_registered + b.bought_retargeted;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Registered vs Retargeted</h3>
        <span className="updated">who was on this report&apos;s registration list, and who wasn&apos;t</span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>Registered</th>
              <th>Retargeted*</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="client">Attended the webinar</td>
              <td className="resp">{b.attended_registered.toLocaleString()}</td>
              <td className="resp">{b.attended_retargeted.toLocaleString()}</td>
              <td className="resp">{totalAttended.toLocaleString()}</td>
            </tr>
            <tr>
              <td className="client">Bought</td>
              <td className="resp">{b.bought_registered.toLocaleString()}</td>
              <td className="resp">{b.bought_retargeted.toLocaleString()}</td>
              <td className="resp">{totalBought.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card-b" style={{ borderTop: '1px solid var(--border-2)' }}>
        <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          *Retargeted = attended or bought but never appeared in a leads/registrations file — reached some other way
          (a prior week&apos;s list, a direct link, WhatsApp, etc.), not on this report&apos;s registration list.
        </div>
      </div>
    </div>
  );
}

function AiVsManual({ result }: { result: ReportResult }) {
  const b = result.ai_vs_manual;
  const winnerColor = (w: 'manual' | 'ai' | 'tie') => (w === 'tie' ? 'var(--muted)' : w === 'ai' ? 'var(--green)' : 'var(--amber)');
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>AI calling vs Manual calling</h3>
        <span className="updated">
          calls made — Manual {b.calls_made.manual.toLocaleString()}, AI {b.calls_made.ai.toLocaleString()}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Basis</th>
              <th>Manual</th>
              <th>AI</th>
              <th>AI vs Manual</th>
              <th>Winner</th>
            </tr>
          </thead>
          <tbody>
            {b.relative.map((g) => (
              <tr key={g.label}>
                <td>{g.label}</td>
                <td className="resp">
                  {pct(g.manual.rate, 2)} ({g.manual.k}/{g.manual.n})
                </td>
                <td className="resp">
                  {pct(g.ai.rate, 2)} ({g.ai.k}/{g.ai.n})
                </td>
                <td className="resp">{delta(g.rel_diff)}</td>
                <td className="resp" style={{ color: winnerColor(g.winner), fontWeight: 600 }}>
                  {g.winner === 'tie' ? 'TIE' : g.winner.toUpperCase()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-b">
        <div className="sub" style={{ fontWeight: 600, marginBottom: 8 }}>
          Per-webinar (fair comparison — different webinar counts each side)
        </div>
        <table className="data">
          <thead>
            <tr>
              <th></th>
              <th>Manual</th>
              <th>AI</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Webinars</td>
              <td className="resp">{b.per_webinar.manual.webinars}</td>
              <td className="resp">{b.per_webinar.ai.webinars}</td>
            </tr>
            <tr>
              <td>Calls made (avg)</td>
              <td className="resp">{b.per_webinar.manual.calls_avg.toFixed(1)}</td>
              <td className="resp">{b.per_webinar.ai.calls_avg.toFixed(1)}</td>
            </tr>
            <tr>
              <td>Buyers (avg)</td>
              <td className="resp">{b.per_webinar.manual.buyers_avg.toFixed(1)}</td>
              <td className="resp">{b.per_webinar.ai.buyers_avg.toFixed(1)}</td>
            </tr>
            <tr>
              <td>Buy rate per dialled lead (avg)</td>
              <td className="resp">{pct(b.per_webinar.manual.buy_rate_avg, 2)}</td>
              <td className="resp">{pct(b.per_webinar.ai.buy_rate_avg, 2)}</td>
            </tr>
          </tbody>
        </table>
        {b.notes.map((n, i) => (
          <div key={i} className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 8 }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat">
      <div className="top">
        <span className="lbl">{label}</span>
      </div>
      <div className="val">{value}</div>
      <div className="delta">{detail}</div>
    </div>
  );
}

const BUYER_PAGE = 100;

function WhoBought({ result }: { result: ReportResult }) {
  const [limit, setLimit] = useState(BUYER_PAGE);
  const rows = result.who_bought;
  const attributed = rows.filter((b) => b.within_window).length;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Who bought</h3>
        <span className="updated">
          {attributed} attributed · {rows.length - attributed} unattributed (shown, never hidden)
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Session</th>
              <th>Dialled</th>
              <th>Call mode</th>
              <th>Bot</th>
              <th>Showed</th>
              <th>Value</th>
              <th>Order time</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((b, i) => (
              <tr key={i} style={b.within_window ? undefined : { background: 'var(--red-50)' }}>
                <td className="client">{b.name ?? '—'}</td>
                <td className="resp">{b.phone ?? '—'}</td>
                <td className="sub">{b.email ?? '—'}</td>
                <td className="sub">{b.within_window ? b.session_date ?? b.session_key : 'unattributed'}</td>
                <td className="sub">{b.dialled ? (b.connected ? 'connected' : 'dialled') : 'no'}</td>
                <td className="sub">{b.call_mode ?? '—'}</td>
                <td className="sub">{b.bot_id ?? '—'}</td>
                <td className="sub">{b.showed_up ? 'yes' : 'no'}</td>
                <td className="resp">{money(b.order_value)}</td>
                <td className="sub">{b.order_time ? istClock(b.order_time) : '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} style={{ color: 'var(--faint)', padding: 20 }}>
                  No orders were supplied, or none could be matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="card-b" style={{ borderTop: '1px solid var(--border-2)', textAlign: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setLimit((l) => l + BUYER_PAGE)}>
            Show {Math.min(BUYER_PAGE, rows.length - limit)} more of {rows.length}
          </button>
        </div>
      )}
    </div>
  );
}
