'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { OpenAiAccount, Client } from '@/lib/types';

// Client, project name, project API key, contact person, and one or more
// WhatsApp numbers. No admin key, organization ID, OpenAI project ID, token
// allocation or threshold percentages — the check is "can this key make a
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
    api_key: '',
  });
  // Always at least one row so the primary number has somewhere to go.
  const [phones, setPhones] = useState<string[]>(initial?.phones?.length ? [...initial.phones] : ['']);
  const [daily, setDaily] = useState(initial?.daily_check_enabled ?? true);
  const hasKey = !!initial?.has_key;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const setPhone = (i: number, v: string) => setPhones((p) => p.map((x, j) => (j === i ? v : x)));
  const addPhone = () => setPhones((p) => [...p, '']);
  const removePhone = (i: number) => setPhones((p) => (p.length === 1 ? [''] : p.filter((_, j) => j !== i)));

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Project name is required.');
    // Required on create; on edit, blank means "keep the saved key".
    if (!editing && !form.api_key.trim()) return setErr('Enter the OpenAI project API key.');

    const cleaned = [...new Set(phones.map((p) => p.trim()).filter(Boolean))];
    // Mirrors the server rule so the operator is told before the round trip. The
    // server also accepts a client-level number as the fallback; it will say so
    // if that applies.
    if (daily && !cleaned.length) {
      return setErr('Add at least one WhatsApp number, or switch automatic checking off.');
    }

    setBusy(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        client_id: form.client_id,
        name: form.name.trim(),
        alert_name: form.alert_name.trim() || null,
        phones: cleaned,
        daily_check_enabled: daily,
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

      <Field label="Contact person name" hint="Defaults to the client's contact if blank.">
        <input
          className="input"
          value={form.alert_name}
          onChange={(e) => set('alert_name', e.target.value)}
          placeholder="Acme ops"
        />
      </Field>

      <Field
        label="WhatsApp / mobile numbers"
        hint="Everyone here is messaged over the existing AI Sensy setup if this project runs out of credit — once each per incident. With country code, e.g. +91XXXXXXXXXX. Leave empty to fall back to the client's alert number."
      >
        <div style={{ display: 'grid', gap: 6 }}>
          {phones.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={p}
                onChange={(e) => setPhone(i, e.target.value)}
                placeholder="+919999999999"
                style={{ flex: 1 }}
              />
              {/* The first row has no Remove: clearing it is how you empty the
                  list, and a Remove that silently re-adds a blank row reads as
                  broken. */}
              {i > 0 && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => removePhone(i)}
                  style={{ padding: '4px 10px', fontSize: 12, color: 'var(--red)' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={addPhone}
              style={{ padding: '4px 10px', fontSize: 12.5 }}
            >
              + Add another number
            </button>
          </div>
        </div>
      </Field>

      <Field
        label="Automatic checking"
        hint="When on, this project is checked automatically every 5 minutes. When off, it is skipped by the automatic checks — you can still check it by hand with “Check now”."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className={`switch ${daily ? 'on' : ''}`}
            onClick={() => setDaily((d) => !d)}
            aria-label="toggle automatic checking"
          >
            <i />
          </button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{daily ? 'ON' : 'OFF'}</span>
        </div>
      </Field>
    </Modal>
  );
}
