interface Props {
  clientName: string;
  subtitle: string;
  startDate: string;
  endDate: string;
  total: number;
  botRate: number;
}

export default function ReportHero({ clientName, subtitle, startDate, endDate, total, botRate }: Props) {
  return (
    <div style={{
      background: '#1e3a5f', borderRadius: '14px', padding: '36px 40px',
      marginTop: '24px', color: '#fff',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1.3 }}>
            {clientName} — AI Chatbot Performance Report
          </h2>
          <p style={{ fontSize: '13px', opacity: 0.6, marginTop: '6px' }}>
            {subtitle}
          </p>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '18px' }}>
            {[`${startDate} – ${endDate}`, `${total.toLocaleString()} conversations`].map((m) => (
              <div key={m} style={{
                fontSize: '12px', opacity: 0.55,
                borderLeft: '2px solid rgba(255,255,255,.25)', paddingLeft: '12px',
              }}>
                {m}
              </div>
            ))}
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
          borderRadius: '10px', padding: '16px 22px', textAlign: 'center', flexShrink: 0,
        }}>
          <div style={{ fontSize: '32px', fontWeight: 900, color: '#34d399', lineHeight: 1 }}>{botRate}%</div>
          <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '6px', lineHeight: 1.5 }}>
            Queries handled<br />by AI instantly
          </div>
        </div>
      </div>
    </div>
  );
}
