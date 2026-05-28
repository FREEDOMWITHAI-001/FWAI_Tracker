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
  const [ai, setAi] = useState<any>(null);
  const [aiKey, setAiKey] = useState('');
  const [savingAi, setSavingAi] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [testNum, setTestNum] = useState('');
  const [testMsg, setTestMsg] = useState('');

  const load = useCallback(async () => {
    const [settings, ints, aicfg] = await Promise.all([
      api.get<Record<string, any>>('/api/settings'),
      api.get<Integration[]>('/api/integrations'),
      api.get<any>('/api/settings/aisensy').catch(() => null),
    ]);
    if (settings.notifications) setNotif({ ...{ whatsapp: true, email_digest: true, throttle: true }, ...settings.notifications });
    setIntegrations(ints);
    if (aicfg) setAi(aicfg);
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

  const setAiField = (k: string, v: any) => setAi((p: any) => ({ ...p, [k]: v }));

  const saveAi = async () => {
    setSavingAi(true);
    setAiMsg('');
    try {
      const body = { ...ai, api_key: aiKey || undefined };
      const saved = await api.put('/api/settings/aisensy', body);
      setAi(saved);
      setAiKey('');
      setAiMsg('Saved.');
    } catch (e: any) {
      setAiMsg(e.message);
    } finally {
      setSavingAi(false);
    }
  };

  const sendTest = async () => {
    setTestMsg('Sending…');
    try {
      await api.post('/api/settings/aisensy/test', { destination: testNum });
      setTestMsg('✅ Test message sent.');
    } catch (e: any) {
      setTestMsg('❌ ' + e.message);
    }
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

      {ai && (
        <div className="set-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>WhatsApp alerts (AI Sensy)</h3>
              <p>Message a contact when a VM/app is down longer than the threshold.</p>
            </div>
            <Switch on={!!ai.enabled} onClick={() => setAiField('enabled', !ai.enabled)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <label className="fld">
              <span>API key {ai.has_key ? '(saved — leave blank to keep)' : ''}</span>
              <input className="input" type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={ai.has_key ? '********' : 'paste AI Sensy API key'} />
            </label>
            <label className="fld">
              <span>Campaign / template name</span>
              <input className="input" value={ai.campaign ?? ''} onChange={(e) => setAiField('campaign', e.target.value)} placeholder="downtime_alert" />
            </label>
            <label className="fld">
              <span>API URL</span>
              <input className="input" value={ai.api_url ?? ''} onChange={(e) => setAiField('api_url', e.target.value)} placeholder="https://backend.aisensy.com/campaign/t1/api/v2" />
            </label>
            <label className="fld">
              <span>Sender name</span>
              <input className="input" value={ai.username ?? ''} onChange={(e) => setAiField('username', e.target.value)} placeholder="FWAI Tracker" />
            </label>
            <label className="fld">
              <span>Alert after (minutes down)</span>
              <input className="input" type="number" min={1} value={ai.threshold_min ?? 15} onChange={(e) => setAiField('threshold_min', Number(e.target.value))} />
            </label>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }}>
              <Switch on={!!ai.recovery} onClick={() => setAiField('recovery', !ai.recovery)} />
              <span>Also send a &quot;back up&quot; message on recovery</span>
            </label>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>
            Your approved template should accept 4 variables in this order:{' '}
            <span className="mono">{'{{1}}=name, {{2}}=client, {{3}}=status, {{4}}=minutes'}</span>. Numbers use country
            code (e.g. <span className="mono">+91…</span>), set per client/project in their Edit form.
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveAi} disabled={savingAi}>
              {savingAi ? 'Saving…' : 'Save'}
            </button>
            {aiMsg && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{aiMsg}</span>}
            <span style={{ flex: 1 }} />
            <input className="input" style={{ width: 200 }} value={testNum} onChange={(e) => setTestNum(e.target.value)} placeholder="+91… test number" />
            <button className="btn btn-ghost" onClick={sendTest} disabled={!ai.has_key}>
              Send test
            </button>
          </div>
          {testMsg && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>{testMsg}</div>}
        </div>
      )}

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