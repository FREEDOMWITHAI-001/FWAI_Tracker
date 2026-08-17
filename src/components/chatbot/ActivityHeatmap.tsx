'use client';

interface Props {
  heatmap: number[][];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const suffix = i < 12 ? 'am' : 'pm';
  return i === 0 ? '12am' : i === 12 ? '12pm' : `${h}${suffix}`;
});
const HOUR_LABELS = HOURS.map((h, i) => (i % 3 === 0 ? h : ''));

function getColor(value: number, max: number): string {
  if (value === 0) return '#f1f5f9';
  const ratio = value / max;
  if (ratio < 0.2) return '#bfdbfe';
  if (ratio < 0.4) return '#60a5fa';
  if (ratio < 0.6) return '#3b82f6';
  if (ratio < 0.8) return '#1d4ed8';
  return '#1e3a5f';
}

export default function ActivityHeatmap({ heatmap }: Props) {
  const allValues = heatmap.flat();
  const max = Math.max(1, ...allValues);
  const totalConvos = allValues.reduce((s, v) => s + v, 0);

  let peakDay = 0, peakHour = 0, peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (heatmap[d][h] > peakVal) {
        peakVal = heatmap[d][h];
        peakDay = d;
        peakHour = h;
      }
    }
  }

  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    heatmap.reduce((s, row) => s + row[h], 0)
  );
  const peakHourTotal = Math.max(...hourTotals);
  const peakHourIdx = hourTotals.indexOf(peakHourTotal);

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '24px 26px', marginBottom: '24px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e3a5f', marginBottom: '4px' }}>
        Activity Heatmap — When customers reach out (IST)
      </div>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px' }}>
        Darker = more conversations · All-time pattern
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: `Peak day: `, value: DAYS[peakDay] },
          { label: `Busiest hour: `, value: HOURS[peakHourIdx] },
          { label: `Peak slot: `, value: `${DAYS[peakDay]} ${HOURS[peakHour]} (${peakVal.toLocaleString()} convos)` },
        ].map(({ label, value }) => (
          <span key={label} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '20px', padding: '4px 12px', fontSize: '11.5px', color: '#1d4ed8' }}>
            {label}<strong>{value}</strong>
          </span>
        ))}
        <span style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '4px 12px', fontSize: '11.5px', color: '#15803d' }}>
          Total mapped: <strong>{totalConvos.toLocaleString()}</strong>
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '560px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', marginBottom: '4px' }}>
            <div />
            {HOUR_LABELS.map((label, i) => (
              <div key={i} style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {label}
              </div>
            ))}
          </div>
          {heatmap.map((row, d) => (
            <div key={d} style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: '2px', marginBottom: '2px' }}>
              <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                {DAYS[d]}
              </div>
              {row.map((val, h) => (
                <div
                  key={h}
                  title={`${DAYS[d]} ${HOURS[h]}: ${val} conversations`}
                  style={{ background: getColor(val, max), borderRadius: '3px', height: '22px' }}
                />
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Low</span>
            {['#f1f5f9', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8', '#1e3a5f'].map((c) => (
              <div key={c} style={{ width: '16px', height: '16px', borderRadius: '3px', background: c }} />
            ))}
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
