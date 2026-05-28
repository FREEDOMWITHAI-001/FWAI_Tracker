'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { Integration } from '@/lib/types';

const STATUSES = [
  { value: 'healthy', label: 'Connected' },
  { value: 'warning', label: 'Needs attention' },
  { value: 'down', label: 'Disconnected' },
];

export function IntegrationDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Integration;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    detail: initial?.detail ?? '',
    status: initial?.status ?? 'healthy',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) return setErr('Name is required.');
    setBusy(true);
    setErr('');
    try {
      if (editing) await api.patch(`/api/integrations/${initial!.id}`, form);
      else await api.post('/api/integrations', form);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit integration' : 'Add integration'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add integration'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      <Field label="Name">
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Zoom" autoFocus />
      </Field>
      <Field label="Detail">
        <input className="input" value={form.detail ?? ''} onChange={(e) => set('detail', e.target.value)} placeholder="Server-to-Server OAuth" />
      </Field>
      <Field label="Status">
        <StatusSelect value={form.status} onChange={(v) => set('status', v)} options={STATUSES} />
      </Field>
    </Modal>
  );
}
