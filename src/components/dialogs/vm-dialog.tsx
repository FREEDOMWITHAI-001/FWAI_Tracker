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
    alert_name: initial?.alert_name ?? '',
    alert_phone: initial?.alert_phone ?? '',
    ssh_user: initial?.ssh_user ?? '',
    ssh_port: initial?.ssh_port ?? 22,
    ssh_key: '',
    ssh_pass: '',
    tag: initial?.tag ?? '',
  });
  const hasSsh = !!initial?.has_ssh;
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
        alert_name: form.alert_name?.trim() || null,
        alert_phone: form.alert_phone?.trim() || null,
        ssh_user: form.ssh_user?.trim() || null,
        ssh_port: Number(form.ssh_port) || 22,
        tag: form.tag?.trim() || null,
        ...(form.ssh_key?.trim() ? { ssh_key: form.ssh_key } : {}),
        ...(form.ssh_pass?.trim() ? { ssh_pass: form.ssh_pass } : {}),
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
      <Field label="Tag (optional)" hint="Free-form label, e.g. production, internal, Apex Motors.">
        <input className="input" value={form.tag ?? ''} onChange={(e) => set('tag', e.target.value)} placeholder="production" />
      </Field>
      <Field label="Host / IP" hint="The server address — used for the SSH connection.">
        <input className="input" value={form.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="13.232.10.5  or  myserver.com" />
      </Field>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '12px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Connect via SSH (.pem)</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 10 }}>
          Logs into the server to read real <b>CPU, Memory and Disk</b>.
        </div>
        <div className="field-row">
          <Field label="SSH username">
            <input className="input" value={form.ssh_user ?? ''} onChange={(e) => set('ssh_user', e.target.value)} placeholder="ubuntu / ec2-user / opc" autoComplete="off" />
          </Field>
          <Field label="SSH port">
            <input className="input" type="number" value={form.ssh_port} onChange={(e) => set('ssh_port', Number(e.target.value))} placeholder="22" />
          </Field>
        </div>
        <Field label={hasSsh ? 'Private key (.pem) — saved; paste to replace' : 'Private key (.pem)'} hint="The SSH private key text. Encrypted before storage.">
          <textarea
            className="textarea"
            rows={5}
            value={form.ssh_key}
            onChange={(e) => set('ssh_key', e.target.value)}
            placeholder={hasSsh ? '•••••• (leave blank to keep the saved key)' : '-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'}
            style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}
          />
        </Field>
        <Field label="Key passphrase (optional)">
          <input className="input" type="password" value={form.ssh_pass} onChange={(e) => set('ssh_pass', e.target.value)} autoComplete="off" placeholder={hasSsh ? '(unchanged)' : ''} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Alert contact name (optional)" hint="Defaults to the client's contact if blank.">
          <input className="input" value={form.alert_name ?? ''} onChange={(e) => set('alert_name', e.target.value)} placeholder="Dev on-call" />
        </Field>
        <Field label="Alert WhatsApp (optional)" hint="With country code, e.g. +91XXXXXXXXXX.">
          <input className="input" value={form.alert_phone ?? ''} onChange={(e) => set('alert_phone', e.target.value)} placeholder="+919999999999" />
        </Field>
      </div>
    </Modal>
  );
}