'use client';

export type DatePreset = 'all-time' | 'this-month' | 'last-30' | 'last-7' | 'custom';

interface ClientOption {
  id: string;
  name: string;
}

interface Props {
  clients: ClientOption[];
  selectedClientId: string;
  onClientChange: (id: string) => void;
  clientName: string;
  clientSubtitle: string;
  activePreset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  minDate: string;
  maxDate: string;
  allTimeLabel: string;
  allTimeCount: number;
  onDownload: () => void;
}

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'All Time', value: 'all-time' },
  { label: 'This Month', value: 'this-month' },
  { label: 'Last 30 Days', value: 'last-30' },
  { label: 'Last 7 Days', value: 'last-7' },
  { label: 'Custom Range', value: 'custom' },
];

export default function ChatbotHeader({
  clients, selectedClientId, onClientChange,
  clientName, clientSubtitle,
  activePreset, onPresetChange,
  customFrom, customTo, onCustomFromChange, onCustomToChange,
  minDate, maxDate, allTimeLabel, allTimeCount,
  onDownload,
}: Props) {
  return (
    <div style={{ background: '#0d1b2e', padding: '24px 32px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Row 1: Title + client selector */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
              {clientName} — Chatbot Impact Report
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '13px' }}>{clientSubtitle}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>Client</label>
              <select
                value={selectedClientId}
                onChange={(e) => onClientChange(e.target.value)}
                style={{ background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', minWidth: '200px', outline: 'none' }}
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: '#0d1b2e', color: '#fff' }}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', cursor: 'pointer' }}
              onClick={() => window.location.reload()}
            >
              ↺ Refresh
            </button>
            <button
              style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '6px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              onClick={onDownload}
            >
              ↓ Download Report
            </button>
          </div>
        </div>

        {/* Row 2: Date presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPresetChange(p.value)}
              style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', border: 'none',
                background: activePreset === p.value ? '#fff' : 'rgba(255,255,255,.1)',
                color: activePreset === p.value ? '#0d1b2e' : '#cbd5e1',
              }}
            >
              {p.label}
            </button>
          ))}
          {activePreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: '8px', padding: '6px 12px' }}>
              <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>From</span>
              <input type="date" value={customFrom} min={minDate} max={customTo || maxDate} onChange={(e) => onCustomFromChange(e.target.value)} style={{ background: 'transparent', color: '#fff', fontSize: '13px', border: 'none', outline: 'none', cursor: 'pointer' }} />
              <span style={{ color: '#94a3b8' }}>→</span>
              <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>To</span>
              <input type="date" value={customTo} min={customFrom || minDate} max={maxDate} onChange={(e) => onCustomToChange(e.target.value)} style={{ background: 'transparent', color: '#fff', fontSize: '13px', border: 'none', outline: 'none', cursor: 'pointer' }} />
            </div>
          )}
        </div>

        {/* Row 3: Summary pill */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,.1)', color: '#e2e8f0', fontSize: '13px', padding: '6px 12px', borderRadius: '999px' }}>
            📅 Report: {allTimeLabel} · {allTimeCount.toLocaleString()} conversations
          </span>
        </div>
      </div>
    </div>
  );
}
