'use client';

import { useState } from 'react';
import { Modal, Field } from '@/components/ui';
import { api } from '@/lib/client';
import type { Client } from '@/lib/types';

export function ClientDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [industry, setIndustry] = useState(initial?.industry ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = !!initial;

  const save = async () => {
    if (!name.trim()) return setErr('Client name is required.');
    setBusy(true);
    setErr('');
    try {
      const body = { name: name.trim(), industry: industry.trim() || null };
      if (editing) await api.patch(`/api/clients/${initial!.id}`, body);
      else await api.post('/api/clients', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit client' : 'Add client'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add client'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}
      <Field label="Company name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Clinic" autoFocus />
      </Field>
      <Field label="Industry" hint="Optional — shown on the client list and detail header.">
        <input className="input" value={industry ?? ''} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Healthcare" />
      </Field>
    </Modal>
  );
}
