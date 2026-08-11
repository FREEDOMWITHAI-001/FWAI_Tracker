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
    status: initial?.status ?? 'active',
  });
  // Asks the server to actually message the client contact — not a note that
  // someone already did.
  const [send, setSend] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) return setErr('Title is required.');
    setBusy(true);
    setErr('');
    try {
      const body = { ...form, title: form.title.trim(), client_id: form.client_id || null };
      if (editing) {
        await api.patch(`/api/alerts/${initial!.id}`, body);
      } else {
        const created = await api.post<Alert>('/api/alerts', { ...body, send_whatsapp: send });
        if (send && created.whatsapp_error) {
          // The alert WAS raised; only the WhatsApp leg failed. Refresh the list
          // but hold the dialog open, otherwise the reason disappears on close
          // and it looks like the message went out.
          onSaved();
          setWarn(created.whatsapp_error);
          setBusy(false);
          return;
        }
      }
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
        warn ? (
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? (send ? 'Sending…' : 'Saving…') : editing ? 'Save changes' : 'Raise alert'}
            </button>
          </>
        )
      }
    >
      {err && <div className="form-err">{err}</div>}
      {warn && <div className="form-warn">Alert raised, but WhatsApp was not delivered: {warn}</div>}
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
        {editing ? (
          // Read-only on an existing alert: the column is written by the server
          // when a message is actually attempted, so it isn't ours to toggle.
          <Field label="WhatsApp delivery">
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
              {initial!.whatsapp_sent
                ? `Sent${initial!.whatsapp_sent_at ? ` · ${new Date(initial!.whatsapp_sent_at).toLocaleString()}` : ''}`
                : initial!.whatsapp_error || 'Not sent'}
            </div>
          </Field>
        ) : (
          <Field label="Send WhatsApp now">
            <button
              type="button"
              className={`switch ${send ? 'on' : ''}`}
              onClick={() => setSend((v) => !v)}
              style={{ marginTop: 4 }}
              aria-label="Send WhatsApp now"
            >
              <i />
            </button>
          </Field>
        )}
      </div>
      {!editing && send && (
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: -4 }}>
          Messages the selected client&apos;s alert contact via AI Sensy. Needs WhatsApp configured in Settings.
        </div>
      )}
    </Modal>
  );
}
