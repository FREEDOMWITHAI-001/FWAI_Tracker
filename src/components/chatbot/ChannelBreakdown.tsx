import type { DailyData } from '@/lib/chatbot/types';
import { filterByDateRange, computeAllTimeMetrics } from '@/lib/chatbot/metrics';

interface ChannelData {
  name: string;
  icon: string;
  inboxId: number;
  dailyData: DailyData[];
}

interface Props {
  channels: ChannelData[];
  from: string;
  to: string;
  avgHandlingTimeMinutes: number;
}

const COLORS = [
  { bg: '#f0fdf4', border: '#bbf7d0', accent: '#15803d', pill: '#dcfce7', pillText: '#166534' },
  { bg: '#eff6ff', border: '#bfdbfe', accent: '#1d4ed8', pill: '#dbeafe', pillText: '#1e40af' },
  { bg: '#fff7ed', border: '#fed7aa', accent: '#c2410c', pill: '#fef3c7', pillText: '#92400e' },
  { bg: '#fdf4ff', border: '#e9d5ff', accent: '#7e22ce', pill: '#f3e8ff', pillText: '#6b21a8' },
];

export default function ChannelBreakdown({ channels, from, to, avgHandlingTimeMinutes }: Props) {
  if (!channels || channels.length === 0) return null;

  const channelMetrics = channels.map((ch) => {
    const filtered = filterByDateRange(ch.dailyData, from, to);
    const metrics = computeAllTimeMetrics(filtered, avgHandlingTimeMinutes);
    return { ...ch, metrics };
  });

  const grandTotal = channelMetrics.reduce((s, c) => s + c.metrics.total, 0);

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(channelMetrics.length, 2)}, 1fr)`,
        gap: '20px',
      }}>
        {channelMetrics.map((ch, i) => {
          const col = COLORS[i % COLORS.length];
          const share = grandTotal > 0 ? Math.round((ch.metrics.total / grandTotal) * 100) : 0;
          const barWidth = grandTotal > 0 ? (ch.metrics.total / grandTotal) * 100 : 0;

          return (
            <div key={ch.inboxId} style={{ background: col.bg, border: `1px solid ${col.border}`, borderRadius: '14px', padding: '22px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: col.accent }}>{ch.icon} {ch.name}</div>
                <span style={{ background: col.pill, color: col.pillText, borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}>
                  {share}% of traffic
                </span>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barWidth}%`, background: col.accent, borderRadius: '3px' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: col.accent }}>{ch.metrics.total.toLocaleString()}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Total conversations</div>
                </div>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: '#15803d' }}>{ch.metrics.botResolved.toLocaleString()}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>AI resolved</div>
                </div>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: '#d97706' }}>{ch.metrics.escalated.toLocaleString()}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Escalated to team</div>
                </div>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: '#1e3a5f' }}>{ch.metrics.botResolvedPct}%</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>AI resolution rate</div>
                </div>
              </div>
              <div style={{ marginTop: '14px', background: col.pill, borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: col.pillText, fontWeight: 600 }}>
                ⏱ {ch.metrics.hoursSaved.toLocaleString()} hours saved on this channel
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
