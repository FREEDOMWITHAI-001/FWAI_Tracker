interface Props {
  hoursSaved: number;
  workingDaysSaved: number;
  botResolved: number;
  avgHandlingTimeMinutes: number;
  totalDays: number;
}

export default function TimeSavedCard({ hoursSaved, workingDaysSaved, botResolved, avgHandlingTimeMinutes, totalDays }: Props) {
  const minutesSaved = botResolved * avgHandlingTimeMinutes;
  const dailyAvg = totalDays > 0 ? Math.round(botResolved / totalDays) : 0;

  return (
    <div style={{ background: '#fff', borderRadius: '14px', padding: '28px', border: '1px solid #e5e9f0' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a2332', marginBottom: '6px' }}>
        Time saved — what AI handled = what team didn&apos;t have to
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>
        Estimated at {avgHandlingTimeMinutes} minutes average handling time per query
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '20px 22px', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: '#15803d' }}>
            Total time saved
          </div>
          <div style={{ fontSize: '44px', fontWeight: 900, color: '#16a34a', lineHeight: 1, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>
            {hoursSaved} hrs
          </div>
          <div style={{ fontSize: '13px', color: '#15803d', marginTop: '6px' }}>
            {botResolved.toLocaleString()} queries &times; {avgHandlingTimeMinutes} min = {minutesSaved.toLocaleString()} min &asymp; {hoursSaved} hours
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', border: '1px solid #e5e9f0', textAlign: 'center' }}>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#1e3a5f', fontVariantNumeric: 'tabular-nums' }}>
              {workingDaysSaved}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>
              Working days saved<br />(8 hrs/day)
            </div>
          </div>
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', border: '1px solid #e5e9f0', textAlign: 'center' }}>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#1e3a5f', fontVariantNumeric: 'tabular-nums' }}>
              {dailyAvg}/day
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>
              Avg queries AI<br />handled daily
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
