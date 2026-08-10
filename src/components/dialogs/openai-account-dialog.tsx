'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { OpenAiAccount, Client } from '@/lib/types';

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
    org_id: initial?.org_id ?? '',
    project_id: initial?.project_id ?? '',
    allocated_tokens: initial?.allocated_tokens ?? ('' as number | ''),
    used_tokens: initial?.used_tokens ?? ('' as number | ''),
    low_threshold_pct: initial?.low_threshold_pct ?? 25,
    critical_threshold_pct: initial?.critical_threshold_pct ?? 10,
    alert_name: initial?.alert_name ?? '',
    alert_phone: initial?.alert_phone ?? '',
    api_key: '',
  });
  const hasKey = !!initial?.has_key;
  const [clearKey, setClearKey] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.client_id) return setErr('Pick a client.');
    if (!form.name.trim()) return setErr('Account name is required.');
    if (Number(form.critical_threshold_pct) > Number(form.low_threshold_pct)) {
      return setErr('Critical threshold must be less than or equal to the low threshold.');
    }
    setBusy(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        client_id: form.client_id,
        name: form.name.trim(),
        org_id: form.org_id?.trim() || null,
        project_id: form.project_id?.trim() || null,
        allocated_tokens: form.allocated_tokens === '' ? 0 : Number(form.allocated_tokens),
        used_tokens: form.used_tokens === '' ? 0 : Number(form.used_tokens),
        low_threshold_pct: Number(form.low_threshold_pct),
        critical_threshold_pct: Number(form.critical_threshold_pct),
        alert_name: form.alert_name?.trim() || null,
        alert_phone: form.alert_phone?.trim() || null,
      };
      // Only send a key when one was typed, so "leave blank to keep" works — the
      // same rule the VM editor uses for .pem keys.
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      else if (editing && clearKey) {
        body.api_key = '';
        body.clear_api_key = true;
      }

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
      title={editing ? 'Edit OpenAI account' : 'Add OpenAI account'}
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
        <Field label="Account name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme — production" autoFocus />
        </Field>
      </div>

      <Field
        label={hasKey ? 'OpenAI API key — saved; paste to replace' : 'OpenAI API key'}
        hint="Encrypted before storage and never sent back to the browser. Usage tracking needs an admin key (sk-admin-…); a project key still works for everything except the automatic usage pull."
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          value={form.api_key}
          onChange={(e) => set('api_key', e.target.value)}
          placeholder={hasKey ? `•••••• (${initial!.label ?? 'saved'})` : 'sk-admin-…'}
          style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}
        />
      </Field>
      {editing && hasKey && !form.api_key.trim() && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', marginTop: -6, marginBottom: 12 }}>
          <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
          Remove the saved key (usage reverts to manual entry)
        </label>
      )}

      <div className="field-row">
        <Field label="Organization ID (optional)">
          <input className="input" value={form.org_id ?? ''} onChange={(e) => set('org_id', e.target.value)} placeholder="org-…" />
        </Field>
        <Field label="Project ID (optional)" hint="Scopes the usage pull to one project.">
          <input className="input" value={form.project_id ?? ''} onChange={(e) => set('project_id', e.target.value)} placeholder="proj_…" />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Allocated tokens" hint="The budget granted to this client. Leave 0 to track usage without alerting.">
          <input
            className="input"
            type="number"
            min={0}
            value={form.allocated_tokens}
            onChange={(e) => set('allocated_tokens', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="10000000"
          />
        </Field>
        <Field label="Used tokens" hint="Filled automatically when an admin key is saved; enter by hand otherwise.">
          <input
            className="input"
            type="number"
            min={0}
            value={form.used_tokens}
            onChange={(e) => set('used_tokens', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="0"
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Low at (% remaining)" hint="WhatsApp warning when remaining falls to this.">
          <input className="input" type="number" min={0} max={100} value={form.low_threshold_pct} onChange={(e) => set('low_threshold_pct', Number(e.target.value))} />
        </Field>
        <Field label="Critical at (% remaining)" hint="Escalates the same alert to critical.">
          <input className="input" type="number" min={0} max={100} value={form.critical_threshold_pct} onChange={(e) => set('critical_threshold_pct', Number(e.target.value))} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Alert contact name (optional)" hint="Defaults to the client's contact if blank.">
          <input className="input" value={form.alert_name ?? ''} onChange={(e) => set('alert_name', e.target.value)} placeholder="Acme ops" />
        </Field>
        <Field label="Mobile number" hint="With country code, e.g. +91XXXXXXXXXX. Blank falls back to the client's alert number.">
          <input className="input" value={form.alert_phone ?? ''} onChange={(e) => set('alert_phone', e.target.value)} placeholder="+919999999999" />
        </Field>
      </div>
    </Modal>
  );
}
