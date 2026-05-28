'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/client';
import { Pill, Loading } from '@/components/ui';
import { IntegrationDialog } from '@/components/dialogs/integration-dialog';
import { IconPlus } from '@/lib/icons';
import type { Integration } from '@/lib/types';

interface Notifications {
  whatsapp: boolean;
  email_digest: boolean;
  throttle: boolean;
}

const STATUS_LABEL: Record<string, string> = { healthy: 'Connected', warning: 'Token expired', down: 'Disconnected' };

export default function SettingsPage() {
  const [notif, setNotif] = useState<Notifications>({ whatsapp: true, email_digest: true, throttle: true });
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);

  const load = useCallback(async () => {
    const [settings, ints] = await Promise.all([
      api.get<Record<string, any>>('/api/settings'),
      api.get<Integration[]>('/api/integrations'),
    ]);
    if (settings.notifications) setNotif({ ...{ whatsapp: true, email_digest: true, throttle: true }, ...settings.notifications });
    setIntegrations(ints);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const toggle = async (key: keyof Notifications) => {
    const next = { ...notif, [key]: !notif[key] };
    setNotif(next);
    await api.put('/api/settings', { key: 'notifications', value: next }).catch(() => load());
  };

  const removeInt = async (id: string) => {
    if (!confirm('Remove this integration?')) return;
    await api.del(`/api/integrations/${id}`);
    load();
  };

  if (loading) return <Loading label="Loading settings…" />;

  const Switch = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} aria-label="toggle">
      <i />
    </button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Connections, alert routing and preferences.</div>
        </div>
      </div>

      <div className="set-card">
        <h3>Notifications</h3>
        <p>Choose how the team is alerted when something goes down.</p>
        <div className="set-row">
          <div className="l">
            <b>WhatsApp alerts</b>
            <span>Send to the Ops group on every critical alert</span>
          </div>
          <Switch on={notif.whatsapp} onClick={() => toggle('whatsapp')} />
        </div>
        <div className="set-row">
          <div className="l">
            <b>Email digest</b>
            <span>Daily summary at 9:00 AM</span>
          </div>
          <Switch on={notif.email_digest} onClick={() => toggle('email_digest')} />
        </div>
        <div className="set-row">
          <div className="l">
            <b>Re-alert throttle</b>
            <span>Don&apos;t repeat the same alert within 15 minutes</span>
          </div>
          <Switch on={notif.throttle} onClick={() => toggle('throttle')} />
        </div>
      </div>

      <div className="set-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3>Integrations</h3>
            <p>Services FWAI Tracker connects to.</p>
          </div>
          <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={() => setAdding(true)}>
            <IconPlus /> Add
          </button>
        </div>
        {integrations.map((it) => (
          <div className="set-row" key={it.id}>
            <div className="l">
              <b>{it.name}</b>
              <span>{it.detail}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill status={it.status} label={STATUS_LABEL[it.status] ?? it.status} />
              <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setEditing(it)}>
                Edit
              </button>
              <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} onClick={() => removeInt(it.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        {!integrations.length && <div className="set-row" style={{ color: 'var(--faint)' }}>No integrations configured.</div>}
      </div>

      {adding && <IntegrationDialog onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <IntegrationDialog initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
