interface Props {
  hoursSaved: number;
  botResolved: number;
  avgHandlingTimeMinutes: number;
  workingDaysSaved: number;
}

export default function HoursSavedBand({ hoursSaved, botResolved, avgHandlingTimeMinutes, workingDaysSaved }: Props) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e3a5f 0%, #164e3b 100%)',
      borderRadius: '14px',
      padding: '28px 36px',
      display: 'flex',
      alignItems: 'center',
      gap: '36px',
      marginBottom: '24px',
      flexWrap: 'wrap',
    }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: '56px', fontWeight: 800, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {hoursSaved}
        </div>
        <div style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,.7)', marginTop: '4px' }}>
          hours saved
        </div>
      </div>
      <div style={{ color: 'rgba(255,255,255,.82)', fontSize: '13.5px', lineHeight: 1.8 }}>
        <strong style={{ color: '#fff' }}>{botResolved.toLocaleString()} conversations were handled completely by the AI</strong> — no human agent needed.<br />
        At an average of {avgHandlingTimeMinutes} minutes per conversation, that&apos;s{' '}
        <strong style={{ color: '#fff' }}>{hoursSaved}+ hours</strong> of agent time saved.<br />
        That&apos;s the equivalent of{' '}
        <strong style={{ color: '#fff' }}>~{workingDaysSaved} working days</strong> of a support agent.
      </div>
    </div>
  );
}
