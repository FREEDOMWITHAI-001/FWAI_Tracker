'use client';

import type { QualityPanel as Panel } from '@/lib/reports/types';

// The mandatory pre-export panel. The export route refuses to serve a workbook
// until this has been acknowledged, and re-running clears the acknowledgement —
// so nobody signs off on numbers they did not actually see.

const TONE: Record<string, string> = { ok: 'healthy', warn: 'warning', bad: 'down' };

export function QualityPanelView({
  quality,
  acknowledged,
  onAcknowledge,
  busy,
}: {
  quality: Panel;
  acknowledged: boolean;
  onAcknowledge: () => void;
  busy?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <h3>Data quality — review before export</h3>
        <span className="updated">signature {quality.hash}</span>
      </div>

      {quality.blockers.length > 0 && (
        <div style={{ padding: '14px 20px 0' }}>
          {quality.blockers.map((b, i) => (
            <div key={i} className="form-err" style={{ marginBottom: 8 }}>
              <b>Blocking: </b>
              {b}
            </div>
          ))}
        </div>
      )}

      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Check</th>
              <th>Value</th>
              <th>What it means</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quality.metrics.map((m) => (
              <tr key={m.key}>
                <td className="client">{m.label}</td>
                <td className="resp">{m.display}</td>
                <td className="sub" style={{ maxWidth: 520 }}>
                  {m.detail}
                </td>
                <td>
                  <span className={`pill ${TONE[m.severity]}`}>{m.severity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {quality.warnings.length > 0 && (
        <div className="card-b" style={{ borderTop: '1px solid var(--border-2)' }}>
          <div className="section-label" style={{ fontSize: 13 }}>
            Warnings
          </div>
          <ul style={{ margin: '0 0 0 18px', color: 'var(--muted)', fontSize: 13 }}>
            {quality.warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="modal-f" style={{ position: 'static', justifyContent: 'space-between' }}>
        <span className="sub" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          {acknowledged
            ? 'Reviewed — export is unlocked for exactly these numbers.'
            : 'Export stays locked until this panel is confirmed. Re-running the report locks it again.'}
        </span>
        <button className="btn btn-primary" onClick={onAcknowledge} disabled={acknowledged || busy}>
          {acknowledged ? 'Reviewed' : busy ? 'Saving…' : 'I have reviewed this'}
        </button>
      </div>
    </div>
  );
}
