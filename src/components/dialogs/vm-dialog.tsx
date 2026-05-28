'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { VM, Client } from '@/lib/types';

const PROVIDERS = ['AWS EC2', 'Azure VM', 'GCP CE', 'DigitalOcean', 'Linode', 'Hetzner', 'Other VPS', 'Self-host'];
const STATUSES = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'warning', label: 'Warning' },
  { value: 'down', label: 'Down' },
];

export function VMDialog({
  initial,
  clientId,
  clients,
  onClose,
  onSaved,
}: {
  initial?: VM;
  clientId?: string; // preset + lock client when adding from a client page
  clients?: Client[]; // required when adding without a preset client
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    client_id: initial?.client_id ?? clientId ?? clients?.[0]?.id ?? '',
    name: initial?.name ?? '',
    provider: initial?.provider ?? 'AWS EC2',
    region: initial?.region ?? '',
    status: initial?.status ?? 'healthy',
    uptime_label: initial?.uptime_label ?? '',
    host: initial?.host ?? '',
    port: initial?.port ?? ('' as number | ''),
    health_url: initial?.health_url ?? '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const lockClient = !!clientId || editing;

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Instance name is required.');
    setBusy(true);
    setErr('');
    try {
      // CPU / memory / disk are intentionally NOT entered here — they are filled
      // automatically by port/health checks and cloud syncs.
      const body = {
        client_id: form.client_id,
        name: form.name.trim(),
        provider: form.provider,
        region: form.region,
        status: form.status,
        uptime_label: form.uptime_label,
        host: form.host?.trim() || null,
        port: form.port === '' || form.port == null ? null : Number(form.port),
        health_url: form.health_url?.trim() || null,
      };
      if (editing) await api.patch(`/api/vms/${initial!.id}`, body);
      else await api.post('/api/vms', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit VM' : 'Add VM'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add VM'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      {!lockClient && clients && (
        <Field label="Client">
          <StatusSelect
            value={form.client_id}
            onChange={(v) => set('client_id', v)}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      )}
      <div className="field-row">
        <Field label="Instance name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="i-0a91c2 / web-01" autoFocus />
        </Field>
        <Field label="Provider">
          <StatusSelect value={form.provider} onChange={(v) => set('provider', v)} options={PROVIDERS.map((p) => ({ value: p, label: p }))} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Region">
          <input className="input" value={form.region ?? ''} onChange={(e) => set('region', e.target.value)} placeholder="ap-south-1" />
        </Field>
        <Field label="Initial status" hint="Auto-updated on each check.">
          <StatusSelect value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Host / IP" hint="The address the app connects to for the port check.">
          <input className="input" value={form.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="13.232.10.5  or  myserver.com" />
        </Field>
        <Field label="Port" hint="e.g. 443, 80, 22, 3306. Primary up/down check.">
          <input
            className="input"
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => set('port', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="443"
          />
        </Field>
      </div>

      <Field
        label="Health URL (optional)"
        hint="Used only if no port is set. If it returns JSON like {cpu, mem, disk}, those fill the gauges automatically."
      >
        <input className="input" value={form.health_url ?? ''} onChange={(e) => set('health_url', e.target.value)} placeholder="https://my-server.com/health" />
      </Field>

      <Field label="Uptime label (optional)" hint='Free text, e.g. "42d 6h".'>
        <input className="input" value={form.uptime_label ?? ''} onChange={(e) => set('uptime_label', e.target.value)} placeholder="42d 6h" />
      </Field>

      <div className="hint" style={{ color: 'var(--faint)', fontSize: 11.5, marginTop: 2 }}>
        CPU, memory and disk aren&apos;t entered here — they fill in automatically from a connected cloud account or a Health
        URL that reports them, and show as live gauges + history graphs.
      </div>
    </Modal>
  );
}
