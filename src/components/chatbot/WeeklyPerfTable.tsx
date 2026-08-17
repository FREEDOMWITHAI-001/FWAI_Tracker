import type { WeekGroup } from '@/lib/chatbot/metrics';

interface Props {
  weekGroups: WeekGroup[];
  avgHandlingTimeMinutes: number;
}

export default function WeeklyPerfTable({ weekGroups, avgHandlingTimeMinutes }: Props) {
  if (!weekGroups.length) return null;
  const maxRate = Math.max(...weekGroups.map((w) => w.botRate));

  const totTotal = weekGroups.reduce((s, w) => s + w.total, 0);
  const totBot = weekGroups.reduce((s, w) => s + w.bot, 0);
  const totHuman = weekGroups.reduce((s, w) => s + w.human, 0);
  const totRate = totTotal > 0 ? Math.round((totBot / totTotal) * 1000) / 10 : 0;
  const totHrs = ((totBot * avgHandlingTimeMinutes) / 60).toFixed(1);

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', marginBottom: '12px', fontSize: '12px', color: '#475569', lineHeight: 1.7 }}>
        <strong style={{ color: '#1e3a5f' }}>How performance is measured:</strong> Each week the AI handled a subset of queries autonomously. Human team hours are saved for every query the bot resolved. The vs-prev column shows week-on-week change in AI success rate.
      </div>
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e9f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
          <thead style={{ background: '#1e3a5f' }}>
            <tr>
              {['Week', 'Total Queries', '🤖 AI Handled', '👥 Human', 'AI Rate', 'vs Prev Week', 'Team Hrs Saved'].map((h) => (
                <th key={h} style={{
                  color: 'rgba(255,255,255,.78)', fontSize: '10px', textTransform: 'uppercase',
                  letterSpacing: '.5px', padding: '13px 16px',
                  textAlign: h === 'Week' ? 'left' : 'right',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekGroups.map((w, i) => {
              const isBest = w.botRate === maxRate && maxRate > 0 && w.total > 0;
              const prev = i > 0 ? weekGroups[i - 1].botRate : null;
              const delta = prev !== null ? w.botRate - prev : null;
              const hrs = ((w.bot * avgHandlingTimeMinutes) / 60).toFixed(1);
              const rateColor = w.botRate >= 75 ? '#15803d' : w.botRate >= 50 ? '#d97706' : w.botRate > 0 ? '#dc2626' : '#94a3b8';
              const deltaColor = delta === null ? '#94a3b8' : delta > 0 ? '#15803d' : delta < 0 ? '#dc2626' : '#94a3b8';

              return (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: isBest ? '#f0fdf4' : undefined }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e3a5f' }}>
                    {w.label}
                    {isBest && (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '1px 7px', borderRadius: '10px', marginLeft: '6px' }}>
                        ★ Best
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{w.total.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: '#15803d' }}>{w.bot.toLocaleString()}</span>
                    {w.total > 0 && <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '3px' }}>({Math.round((w.bot / w.total) * 100)}%)</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 600, color: '#475569' }}>{w.human.toLocaleString()}</span>
                    {w.total > 0 && <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '3px' }}>({Math.round((w.human / w.total) * 100)}%)</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <strong style={{ color: rateColor, fontSize: '14px' }}>{w.botRate}%</strong>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: deltaColor }}>
                    {delta === null ? '—' : delta > 0 ? `+${delta.toFixed(1)}%` : delta < 0 ? `${delta.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <strong style={{ color: '#1e3a5f' }}>{hrs} hrs</strong>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>{w.bot} × {avgHandlingTimeMinutes} min</div>
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: '#f0fdf4', borderTop: '2px solid #e5e9f0' }}>
              <td style={{ padding: '12px 16px', fontWeight: 800, color: '#1e3a5f' }}>Total</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800 }}>{totTotal.toLocaleString()}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', color: '#15803d', fontWeight: 800 }}>
                {totBot.toLocaleString()} ({Math.round((totBot / totTotal) * 100)}%)
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700 }}>
                {totHuman.toLocaleString()} ({Math.round((totHuman / totTotal) * 100)}%)
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <strong style={{ color: '#15803d', fontSize: '14px' }}>{totRate}%</strong>
              </td>
              <td style={{ padding: '12px 16px', textAlign: 'right', color: '#94a3b8' }}>—</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <strong style={{ color: '#1e3a5f', fontSize: '14px' }}>{totHrs} hrs</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
        * Team hours saved = AI-answered queries × {avgHandlingTimeMinutes} min avg per query, converted to hours.
      </div>
    </div>
  );
}
