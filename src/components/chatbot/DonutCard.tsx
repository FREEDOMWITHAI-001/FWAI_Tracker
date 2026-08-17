interface Props {
  bot: number;
  human: number;
  total: number;
  botResolvedPct: number;
}

export default function DonutCard({ bot, human, total, botResolvedPct }: Props) {
  if (total === 0) return null;

  const R = 70;
  const circ = 2 * Math.PI * R;
  const gap = 4;

  const slices = [
    { color: '#16a34a', label: 'AI Handled', count: bot, pct: bot / total },
    { color: '#d97706', label: 'Human Involved', count: human, pct: human / total },
  ];

  let trackingOffset = -circ * 0.25;
  const segments = slices.map((s) => {
    const len = circ * s.pct;
    const dashOffset = -trackingOffset;
    trackingOffset += len;
    return {
      color: s.color,
      dashArray: `${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}`,
      dashOffset,
    };
  });

  return (
    <div style={{ background: '#fff', borderRadius: '14px', padding: '28px', border: '1px solid #e5e9f0' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a2332', marginBottom: '6px' }}>
        Out of every query — how many were handled by AI?
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '24px' }}>
        Based on {total.toLocaleString()} conversations
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: '180px', height: '180px', flexShrink: 0 }}>
          <svg width="180" height="180" viewBox="0 0 180 180">
            <circle cx={90} cy={90} r={R} fill="none" stroke="#f1f5f9" strokeWidth={28} />
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx={90} cy={90} r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={28}
                strokeDasharray={seg.dashArray}
                strokeDashoffset={seg.dashOffset}
                strokeLinecap="butt"
              />
            ))}
          </svg>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', textAlign: 'center',
          }}>
            <div style={{ fontSize: '34px', fontWeight: 900, color: '#16a34a', lineHeight: 1 }}>
              {botResolvedPct}%
            </div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.3px', marginTop: '3px' }}>
              AI handled
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
          {slices.map((s, i) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: s.color, flexShrink: 0, marginTop: '3px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a2332' }}>{s.label}</span>
                    <span style={{ fontSize: '20px', fontWeight: 900, color: s.color, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(s.pct * 100)}%
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                    {s.count.toLocaleString()} queries
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
