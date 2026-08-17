interface Props {
  botResolved: number;
  hoursSaved: number;
  botRateTrend: { from: number; to: number; fromMonth: string; toMonth: string };
}

export default function ImpactBoxes({ botResolved, hoursSaved, botRateTrend }: Props) {
  const boxes = [
    {
      icon: '⏱',
      title: 'Team focused on real problems',
      body: `With AI handling ${botResolved.toLocaleString()} repetitive queries automatically, the team only gets involved for complex issues — payment problems, escalations, and cases requiring human judgment. No more answering the same questions repeatedly.`,
      stat: `${botResolved.toLocaleString()} queries handled without team`,
    },
    {
      icon: '⚡',
      title: 'Customers get instant answers',
      body: "AI replies in seconds — 24 hours a day, 7 days a week. Customers don't wait for a reply. This improves customer experience significantly, especially for queries outside business hours.",
      stat: 'Instant reply vs hours of wait',
    },
    {
      icon: '📈',
      title: 'AI keeps getting smarter',
      body: `The AI bot rate went from ${botRateTrend.from}% in ${botRateTrend.fromMonth} to ${botRateTrend.to}% in ${botRateTrend.toMonth} — improving as the knowledge base grows. Each escalation that gets resolved becomes a learning opportunity.`,
      stat: `${botRateTrend.from}% → ${botRateTrend.to}% improvement`,
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
      {boxes.map((b) => (
        <div key={b.title} style={{
          background: '#fff', borderRadius: '12px', padding: '24px',
          border: '1px solid #e5e9f0', borderLeft: '4px solid #1e3a5f',
          display: 'flex', flexDirection: 'column',
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: '#1a2332' }}>
            {b.icon} {b.title}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.7, flex: 1 }}>
            {b.body}
          </p>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a', marginTop: '16px' }}>
            {b.stat}
          </div>
        </div>
      ))}
    </div>
  );
}
