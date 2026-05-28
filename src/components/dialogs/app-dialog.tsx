'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { App, VM, Client } from '@/lib/types';

const TYPES = ['Website', 'Web service', 'n8n + GHL', 'Supabase', 'Wavelength', 'Flutter + Supabase', 'Pabbly', 'n8n', 'Other'];
const STATUSES = [
  { value: 'healthy', label: 'Healthy / Running' },
  { value: 'warning', label: 'Warning' },
  { value: 'down', label: 'Down / Failed' },
];

export function AppDialog({
  initial,
  clientId,
  clients,
  vms,
  onClose,
  onSaved,
}: {
  initial?: App;
  clientId?: string;
  clients?: Client[];
  vms?: VM[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    client_id: initial?.client_id ?? clientId ?? clients?.[0]?.id ?? '',
    vm_id: initial?.vm_id ?? '',
    name: initial?.name ?? '',
    type: initial?.type ?? 'Website',
    host: initial?.host ?? '',
    status: initial?.status ?? 'healthy',
    health: initial?.health ?? '',
    uptime: initial?.uptime ?? 100,
    check_url: initial?.check_url ?? '',
    check_host: initial?.check_host ?? '',
    check_port: initial?.check_port ?? ('' as number | ''),
    alert_name: initial?.alert_name ?? '',
    alert_phone: initial?.alert_phone ?? '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const lockClient = !!clientId || editing;
  const clientVms = (vms ?? []).filter((v) => v.client_id === form.client_id);

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Application name is required.');
    setBusy(true);
    setErr('');
    try {
      const body = {
        client_id: form.client_id,
        vm_id: form.vm_id || null,
        name: form.name.trim(),
        type: form.type,
        host: form.host,
        status: form.status,
        health: form.health,
        uptime: Number(form.uptime) || 0,
        check_url: form.check_url?.trim() || null,
        check_host: form.check_host?.trim() || null,
        check_port: form.check_port === '' || form.check_port == null ? null : Number(form.check_port),
        alert_name: form.alert_name?.trim() || null,
        alert_phone: form.alert_phone?.trim() || null,
      };
      if (editing) await api.patch(`/api/apps/${initial!.id}`, body);
      else await api.post('/api/apps', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit application' : 'Add application'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add application'}
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
        <Field label="Application name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="apexmotors.in / clinic-api" autoFocus />
        </Field>
        <Field label="Type">
          <StatusSelect value={form.type} onChange={(v) => set('type', v)} options={TYPES.map((t) => ({ value: t, label: t }))} />
        </Field>
      </div>

      <Field label="Check URL" hint="The app is monitored by hitting this URL — up/down + response time.">
        <input className="input" value={form.check_url ?? ''} onChange={(e) => set('check_url', e.target.value)} placeholder="https://apexmotors.in" />
      </Field>
      <div className="field-row">
        <Field label="…or Host / IP" hint="Use host + port instead of a URL (e.g. an API or DB).">
          <input className="input" value={form.check_host ?? ''} onChange={(e) => set('check_host', e.target.value)} placeholder="13.232.10.5" />
        </Field>
        <Field label="Port">
          <input
            className="input"
            type="number"
            min={1}
            max={65535}
            value={form.check_port}
            onChange={(e) => set('check_port', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="443"
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Initial status" hint="Auto-updated on each check.">
          <StatusSelect value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
        </Field>
        <Field label="Host VM (optional)" hint="Link to the VM it runs on.">
          <StatusSelect
            value={form.vm_id ?? ''}
            onChange={(v) => set('vm_id', v)}
            options={[{ value: '', label: '— none —' }, ...clientVms.map((v) => ({ value: v.id, label: v.name }))]}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Host label (optional)" hint='Shown on the card, e.g. "ec2 i-0a91", "supabase".'>
          <input className="input" value={form.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="ec2 i-0a91" />
        </Field>
        <Field label="Uptime %">
          <input className="input" type="number" min={0} max={100} step="0.1" value={form.uptime} onChange={(e) => set('uptime', e.target.value)} />
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
      <div className="hint" style={{ color: 'var(--faint)', fontSize: 11.5 }}>
        Response time and status fill in automatically when the app is checked — you don&apos;t enter them by hand.
      </div>
    </Modal>
  );
}