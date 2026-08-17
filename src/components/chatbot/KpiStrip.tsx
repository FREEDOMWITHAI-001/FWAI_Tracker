interface KpiCard {
  value: string;
  label: string;
  sub: string;
  borderColor: string;
  valueColor: string;
}

interface Props {
  total: number;
  botResolved: number;
  botResolvedPct: number;
  hoursSaved: number;
  workingDaysSaved: number;
  bestWeekRate: number;
  bestWeekLabel: string;
}

export default function KpiStrip({
  total, botResolved, botResolvedPct, hoursSaved, workingDaysSaved, bestWeekRate, bestWeekLabel,
}: Props) {
  const cards: KpiCard[] = [
    {
      value: total.toLocaleString(),
      label: 'Total Conversations',
      sub: 'All inbound queries',
      borderColor: '#1e3a5f',
      valueColor: '#1e3a5f',
    },
    {
      value: botResolved.toLocaleString(),
      label: 'Answered by AI Alone',
      sub: `No team member needed — ${botResolvedPct}%`,
      borderColor: '#16a34a',
      valueColor: '#16a34a',
    },
    {
      value: `${hoursSaved} hrs`,
      label: 'Team Time Saved',
      sub: `\u2248 ${workingDaysSaved} full working days`,
      borderColor: '#d97706',
      valueColor: '#d97706',
    },
    {
      value: `${bestWeekRate}%`,
      label: 'Best Week Bot Rate',
      sub: bestWeekLabel || '\u2014',
      borderColor: '#0e7490',
      valueColor: '#0e7490',
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
      {cards.map((c) => (
        <div key={c.label} style={{
          background: '#fff', borderRadius: '12px', padding: '22px 24px',
          border: '1px solid #e5e9f0', borderTop: `4px solid ${c.borderColor}`,
        }}>
          <div style={{ fontSize: '38px', fontWeight: 900, lineHeight: 1, color: c.valueColor, fontVariantNumeric: 'tabular-nums' }}>
            {c.value}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.4px' }}>
            {c.label}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
