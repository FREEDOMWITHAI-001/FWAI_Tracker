'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, ReferenceArea,
  LabelList,
} from 'recharts';
import type { WeekGroup } from '@/lib/chatbot/metrics';

function shortLabel(label: string): string {
  const parts = label.split(' \u2013 ');
  if (parts.length !== 2) return label;
  const [start, end] = parts;
  const startParts = start.split(' ');
  const endParts = end.split(' ');
  if (startParts[0] === endParts[0]) {
    return `${start}\u2013${endParts[1]}`;
  }
  return `${startParts[1]} ${startParts[0]}\n\u2013${endParts[1]} ${endParts[0]}`;
}

interface Props {
  weekGroups: WeekGroup[];
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e9f0', borderRadius: '8px', padding: '10px 14px', fontSize: '12px' }}>
      <p style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '6px' }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
      <p style={{ color: '#64748b', marginTop: '4px', borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
        Total: <strong>{total}</strong>
      </p>
    </div>
  );
};

const CustomLineTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e9f0', borderRadius: '8px', padding: '10px 14px', fontSize: '12px' }}>
      <p style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '4px' }}>{label}</p>
      <p style={{ color: '#16a34a' }}>AI Rate: <strong>{payload[0]?.value}%</strong></p>
    </div>
  );
};

export default function WeeklyCharts({ weekGroups }: Props) {
  const data = weekGroups.map((w) => ({ ...w, shortLabel: shortLabel(w.label) }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
      <div style={{ background: '#fff', borderRadius: '14px', padding: '28px', border: '1px solid #e5e9f0' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a2332', marginBottom: '6px' }}>
          Number of queries per week — split by outcome
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
          Taller green = more queries resolved by AI that week
        </div>
        <div style={{ display: 'flex', gap: '20px', marginBottom: '14px' }}>
          {[['#16a34a', 'AI Handled'], ['#d97706', 'Human Involved']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: c }} />
              {l}
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: -28, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="shortLabel" tick={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }} tickLine={false} axisLine={false} interval={0} />
            <YAxis hide />
            <Tooltip content={<CustomBarTooltip />} />
            <Bar dataKey="bot" name="AI Handled" stackId="a" fill="#16a34a" />
            <Bar dataKey="human" name="Human Involved" stackId="a" fill="#d97706" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 800, fill: '#334155' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: '#fff', borderRadius: '14px', padding: '28px', border: '1px solid #e5e9f0' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a2332', marginBottom: '6px' }}>
          AI success rate — week by week trend
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
          % of queries fully answered by AI with no human involvement
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 16, right: 16, left: -20, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="shortLabel" tick={{ fontSize: 9, fill: '#94a3b8', fontWeight: 600 }} tickLine={false} axisLine={false} interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <ReferenceArea y1={75} y2={100} fill="#f0fdf4" fillOpacity={0.7} />
            <ReferenceLine
              y={75} stroke="#16a34a" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: 'Target 75%', position: 'insideTopLeft', fontSize: 9, fill: '#16a34a', fontWeight: 700, dx: 4, dy: -2 }}
            />
            <Tooltip content={<CustomLineTooltip />} />
            <Line
              type="monotone" dataKey="botRate" stroke="#16a34a" strokeWidth={2.5}
              dot={{ r: 5, fill: '#16a34a', stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 7 }} name="AI Rate"
            />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
          Target zone: above 75% means AI is handling most queries independently
        </div>
      </div>
    </div>
  );
}
