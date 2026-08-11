'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/client';
import { AlertItem, Loading, LoadError, Empty } from '@/components/ui';
import { AlertDialog } from '@/components/dialogs/alert-dialog';
import { IconPlus, IconWhatsApp } from '@/lib/icons';
import type { Alert, Client } from '@/lib/types';

type ARow = Alert & { client_name: string | null };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<ARow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'resolved'>('active');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [a, c] = await Promise.all([api.get<ARow[]>('/api/alerts'), api.get<Client[]>('/api/clients')]);
    setAlerts(a);
    setClients(c);
    setLoading(false);
  }, []);

  // "Nothing here." on the Alerts page is the single most dangerous empty state
  // in the app — it reads as "no incidents" when it may mean "cannot reach the
  // incident log at all".
  const reload = useCallback(() => {
    setLoading(true);
    load().catch((e) => {
      setError(e?.message || 'Request failed');
      setLoading(false);
    });
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setStatus = async (id: string, status: 'active' | 'resolved') => {
    await api.patch(`/api/alerts/${id}`, { status });
    reload();
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this alert?')) return;
    await api.del(`/api/alerts/${id}`);
    reload();
  };

  const shown = alerts.filter((a) => a.status === tab);
  // Attempts, not just successes: a message that never went out is the case an
  // operator most needs to see here.
  const waHistory = alerts.filter((a) => a.whatsapp_sent || a.whatsapp_error);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <div className="sub">Active and resolved alerts, with WhatsApp delivery.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <IconPlus />
          Raise alert
        </button>
      </div>

      {error && <LoadError error={error} what="alerts" onRetry={reload} />}

      <div className="tabs">
        <button className={tab === 'active' ? 'on' : ''} onClick={() => setTab('active')}>
          Active
        </button>
        <button className={tab === 'resolved' ? 'on' : ''} onClick={() => setTab('resolved')}>
          Resolved
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <h3>{tab === 'active' ? 'Active alerts' : 'Resolved alerts'}</h3>
          </div>
          <div className="alert-list">
            {loading ? (
              <Loading />
            ) : shown.length ? (
              shown.map((a) => (
                <AlertItem
                  key={a.id}
                  alert={a}
                  actions={
                    <div style={{ display: 'flex', gap: 6 }}>
                      {tab === 'active' ? (
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => setStatus(a.id, 'resolved')}>
                          Resolve
                        </button>
                      ) : (
                        <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => setStatus(a.id, 'active')}>
                          Reopen
                        </button>
                      )}
                      <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11.5, color: 'var(--red)' }} onClick={() => remove(a.id)}>
                        Delete
                      </button>
                    </div>
                  }
                />
              ))
            ) : (
              <Empty>{error ? 'Not loaded — see the error above.' : 'Nothing here.'}</Empty>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h3>WhatsApp alert history</h3>
            <span className="wa-badge">
              <IconWhatsApp /> live
            </span>
          </div>
          <div className="alert-list">
            {waHistory.length ? (
              waHistory.map((a) => (
                <div className="alert" key={a.id}>
                  <div
                    className="sev info"
                    style={
                      a.whatsapp_sent
                        ? { background: 'var(--wa-50)', color: 'var(--wa)' }
                        : { background: 'var(--red-50)', color: 'var(--red)' }
                    }
                  >
                    <IconWhatsApp />
                  </div>
                  <div className="body">
                    <div className="ttl">{a.title}</div>
                    <div className="desc" style={a.whatsapp_sent ? undefined : { color: 'var(--red)' }}>
                      {a.whatsapp_sent
                        ? `Delivered to ${a.client_name || 'fleet'} contact`
                        : `Not delivered — ${a.whatsapp_error}`}
                    </div>
                  </div>
                  <div className="time">
                    <span>
                      {new Date(a.whatsapp_sent_at ?? a.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <Empty>{error ? 'Not loaded — see the error above.' : 'No WhatsApp deliveries yet.'}</Empty>
            )}
          </div>
        </div>
      </div>

      {adding && <AlertDialog clients={clients} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}
