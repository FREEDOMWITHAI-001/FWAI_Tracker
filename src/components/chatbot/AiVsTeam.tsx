interface Props {
  botResolved: number;
  human: number;
  humanResolved: number;
  open: number;
}

const AI_HANDLES = [
  'Batch dates, schedule & how to join',
  "Course levels, membership & what's included",
  'Fees, pricing & payment links',
  'App access, portal login & lesson links',
  'General FAQ — trial class, eligibility, etc.',
];

export default function AiVsTeam({ botResolved, human, humanResolved, open }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px', alignItems: 'start' }}>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '24px 26px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#15803d', marginBottom: '16px' }}>
          ✅ What AI handles on its own — {botResolved.toLocaleString()} queries
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {AI_HANDLES.map((item) => (
            <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
              <span style={{ color: '#374151' }}>{item}</span>
              <span style={{ fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>
                Instant ✓
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '16px', fontSize: '11.5px', color: '#166534', background: '#dcfce7', padding: '10px 14px', borderRadius: '8px', lineHeight: 1.6 }}>
          These queries were answered in seconds, 24×7 — with zero team involvement.
        </div>
      </div>

      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '14px', padding: '24px 26px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#c2410c', marginBottom: '16px' }}>
          👥 When team stepped in — {human.toLocaleString()} queries
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '12.5px', color: '#374151', background: '#fff', borderRadius: '8px', padding: '12px 14px', border: '1px solid #fed7aa' }}>
            <strong style={{ color: '#c2410c' }}>💳 Refund & billing disputes</strong><br />
            <span style={{ color: '#6b7280', fontSize: '11.5px', lineHeight: 1.6 }}>
              Payment reversal requests need human authorization. AI identifies and routes these to the team — by design.
            </span>
          </div>
          <div style={{ fontSize: '12.5px', color: '#374151', background: '#fff', borderRadius: '8px', padding: '12px 14px', border: '1px solid #fed7aa' }}>
            <strong style={{ color: '#c2410c' }}>🎓 Complex or sensitive queries</strong><br />
            <span style={{ color: '#6b7280', fontSize: '11.5px', lineHeight: 1.6 }}>
              Queries requiring personal judgment, account-level access, or sensitive decisions that need a human touch.
            </span>
          </div>
          <div style={{ fontSize: '12.5px', color: '#374151', background: '#fff', borderRadius: '8px', padding: '12px 14px', border: '1px solid #fed7aa' }}>
            <strong style={{ color: '#c2410c' }}>📦 Fulfilled by team — {humanResolved.toLocaleString()} resolved · {open} still open</strong><br />
            <span style={{ color: '#6b7280', fontSize: '11.5px', lineHeight: 1.6 }}>
              Every escalation was intentional — AI knew when it couldn&apos;t help and handed off correctly.
            </span>
          </div>
        </div>
        <div style={{ marginTop: '16px', fontSize: '11.5px', color: '#92400e', background: '#fef3c7', padding: '10px 14px', borderRadius: '8px', lineHeight: 1.6 }}>
          Every escalation was intentional — AI knew when it couldn&apos;t help and handed off correctly.
        </div>
      </div>
    </div>
  );
}
