'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { OpenAiAccount, Client } from '@/lib/types';

// Five fields, deliberately. A client is asked for their own project key and who
// to message — nothing else. No admin key, organization ID, OpenAI project ID,
// token allocation or threshold percentages: the check is "can this key make a
// request", which needs none of them. See migration 21.
export function OpenAiAccountDialog({
  initial,
  clients,
  onClose,
  onSaved,
}: {
  initial?: OpenAiAccount;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [form, setForm] = useState({
    client_id: initial?.client_id ?? clients[0]?.id ?? '',
    name: initial?.name ?? '',
    alert_name: initial?.alert_name ?? '',
    alert_phone: initial?.alert_phone ?? '',
    api_key: '',
  });
  const hasKey = !!initial?.has_key;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Project name is required.');
    // Required on create; on edit, blank means "keep the saved key".
    if (!editing && !form.api_key.trim()) return setErr('Enter the OpenAI project API key.');

    setBusy(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        client_id: form.client_id,
        name: form.name.trim(),
        alert_name: form.alert_name.trim() || null,
        alert_phone: form.alert_phone.trim() || null,
      };
      // Only send a key when one was typed, so "leave blank to keep" works —
      // the same rule the VM editor uses for .pem keys.
      if (form.api_key.trim()) body.api_key = form.api_key.trim();

      if (editing) await api.patch(`/api/openai-accounts/${initial!.id}`, body);
      else await api.post('/api/openai-accounts', body);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit OpenAI project' : 'Add OpenAI project'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}

      <div className="field-row">
        <Field label="Client">
          <StatusSelect
            value={form.client_id}
            onChange={(v) => set('client_id', v)}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Project name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="ABC Production"
            autoFocus
          />
        </Field>
      </div>

      <Field
        label={hasKey ? 'OpenAI project API key — saved; paste to replace' : 'OpenAI project API key'}
        hint="The project key (sk-proj-…) from the client's own OpenAI project. Encrypted before storage and never sent back to the browser. Used only server-side, for one minimal request that tests whether the project can still call the API."
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={form.api_key}
          onChange={(e) => set('api_key', e.target.value)}
          placeholder={hasKey ? `•••••• (${initial!.label ?? 'saved'})` : 'sk-proj-…'}
          style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}
        />
      </Field>

      <div className="field-row">
        <Field label="Contact person name" hint="Defaults to the client's contact if blank.">
          <input
            className="input"
            value={form.alert_name}
            onChange={(e) => set('alert_name', e.target.value)}
            placeholder="Acme ops"
          />
        </Field>
        <Field
          label="WhatsApp / mobile number"
          hint="Messaged over the existing AI Sensy setup if this project runs out of credit. With country code, e.g. +91XXXXXXXXXX. Blank falls back to the client's number."
        >
          <input
            className="input"
            value={form.alert_phone}
            onChange={(e) => set('alert_phone', e.target.value)}
            placeholder="+919999999999"
          />
        </Field>
      </div>
    </Modal>
  );
}
