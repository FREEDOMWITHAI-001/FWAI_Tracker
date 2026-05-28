'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { Alert, Client } from '@/lib/types';

const SEVERITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
];

export function AlertDialog({
  initial,
  clients,
  onClose,
  onSaved,
}: {
  initial?: Alert;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    client_id: initial?.client_id ?? '',
    severity: initial?.severity ?? 'warning',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    whatsapp_sent: initial?.whatsapp_sent ?? false,
    status: initial?.status ?? 'active',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) return setErr('Title is required.');
    setBusy(true);
    setErr('');
    try {
      const body = { ...form, title: form.title.trim(), client_id: form.client_id || null };
      if (editing) await api.patch(`/api/alerts/${initial!.id}`, body);
      else await api.post('/api/alerts', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit alert' : 'Raise alert'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Raise alert'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      <Field label="Title">
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="VM unreachable" autoFocus />
      </Field>
      <div className="field-row">
        <Field label="Severity">
          <StatusSelect value={form.severity} onChange={(v) => set('severity', v)} options={SEVERITIES} />
        </Field>
        <Field label="Client">
          <StatusSelect
            value={form.client_id ?? ''}
            onChange={(v) => set('client_id', v)}
            options={[{ value: '', label: '— none —' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className="textarea"
          rows={3}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="ec2 i-04c2 not responding to probe"
        />
      </Field>
      <div className="field-row">
        <Field label="Status">
          <StatusSelect value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
        </Field>
        <Field label="WhatsApp delivery">
          <button
            type="button"
            className={`switch ${form.whatsapp_sent ? 'on' : ''}`}
            onClick={() => set('whatsapp_sent', !form.whatsapp_sent)}
            style={{ marginTop: 4 }}
            aria-label="Toggle WhatsApp delivery"
          >
            <i />
          </button>
        </Field>
      </div>
    </Modal>
  );
}
