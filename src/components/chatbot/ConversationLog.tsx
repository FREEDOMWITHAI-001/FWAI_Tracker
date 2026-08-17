'use client';

import { useState, useEffect } from 'react';

interface Conv {
  id: number;
  date: string;
  status: string;
  labels: string[];
  assignee: string | null;
  inbox: string;
  classification: 'ai' | 'human';
}

interface Summary {
  total: number;
  ai: number;
  human: number;
  aiRate: number;
  days: number;
  escalationLabels: string[];
}

interface Props {
  clientId: string;
}

const CLASS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ai:    { bg: '#dcfce7', text: '#166534', label: 'AI resolved' },
  human: { bg: '#fee2e2', text: '#991b1b', label: 'Human handled' },
};

const STATUS_DOT: Record<string, string> = {
  resolved: '#22c55e',
  open:     '#f59e0b',
  pending:  '#94a3b8',
  snoozed:  '#a78bfa',
};

export default function ConversationLog({ clientId }: Props) {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<'all' | 'ai' | 'human'>('all');
  const [data, setData] = useState<{ conversations: Conv[]; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/chatbot/conversations?clientId=${clientId}&days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clientId, days]);

  const convs = data?.conversations.filter(
    (c) => filter === 'all' || c.classification === filter
  ) ?? [];

  const s = data?.summary;

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: '#64748b' }}>Show last:</span>
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={{
            padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            border: '1px solid #e2e8f0', cursor: 'pointer',
            background: days === d ? '#1e3a5f' : '#fff',
            color: days === d ? '#fff' : '#475569',
          }}>{d} days</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#94a3b8' }}>
          {s && `Showing up to 200 convos per inbox · Based on labels: ${s.escalationLabels.join(', ')}`}
        </span>
      </div>

      {loading && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
          Loading conversations from Chatwoot…
        </div>
      )}
      {error && (
        <div style={{ padding: '16px', background: '#fef2f2', borderRadius: '8px', color: '#dc2626', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
            {[
              { key: 'all', label: 'Total', count: s!.total, bg: '#f1f5f9', text: '#1e3a5f' },
              { key: 'ai', label: 'AI resolved', count: s!.ai, bg: '#dcfce7', text: '#166534' },
              { key: 'human', label: 'Human handled', count: s!.human, bg: '#fee2e2', text: '#991b1b' },
            ].map(({ key, label, count, bg, text }) => (
              <button key={key} onClick={() => setFilter(key as typeof filter)} style={{
                background: filter === key ? text : bg, color: filter === key ? '#fff' : text,
                border: `2px solid ${filter === key ? text : 'transparent'}`,
                borderRadius: '10px', padding: '12px 16px', cursor: 'pointer',
                textAlign: 'left', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: '22px', fontWeight: 900 }}>{count.toLocaleString()}</div>
                <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.85 }}>{label}</div>
              </button>
            ))}
          </div>

          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
            <strong style={{ color: '#1e3a5f' }}>Classification logic:</strong>{' '}
            <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '4px' }}>AI resolved</span> = no assignee &amp; no escalation label.{' '}
            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: '4px' }}>Human handled</span> = assigned to a human agent OR has escalation label.
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', fontSize: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 90px 1fr 140px 100px 110px', background: '#f8fafc', padding: '8px 14px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0', fontSize: '11px' }}>
              <span>ID</span><span>Date</span><span>Status</span><span>Labels</span><span>Assignee</span><span>Inbox</span><span>Classification</span>
            </div>
            {convs.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>No conversations found</div>
            )}
            {convs.slice(0, 200).map((c) => {
              const cls = CLASS_STYLE[c.classification];
              return (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '60px 90px 90px 1fr 140px 100px 110px', padding: '7px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', background: '#fff' }}>
                  <span style={{ color: '#94a3b8' }}>#{c.id}</span>
                  <span>{c.date}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[c.status] ?? '#94a3b8', display: 'inline-block' }} />
                    {c.status}
                  </span>
                  <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {c.labels.length === 0
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : c.labels.map((l) => (
                          <span key={l} style={{ background: '#e2e8f0', color: '#475569', padding: '1px 5px', borderRadius: '4px', fontSize: '10px' }}>{l}</span>
                        ))
                    }
                  </span>
                  <span style={{ color: c.assignee ? '#1e3a5f' : '#cbd5e1' }}>{c.assignee ?? '—'}</span>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>{c.inbox}</span>
                  <span>
                    <span style={{ background: cls.bg, color: cls.text, padding: '2px 7px', borderRadius: '5px', fontWeight: 600, fontSize: '10px' }}>{cls.label}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {convs.length > 200 && (
            <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', textAlign: 'right' }}>
              Showing 200 of {convs.length} conversations
            </p>
          )}
        </>
      )}
    </div>
  );
}
