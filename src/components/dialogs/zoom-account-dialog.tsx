'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { Client } from '@/lib/types';

// Connect a client's Zoom account via Server-to-Server OAuth credentials.
// Create the app at marketplace.zoom.us → "Server-to-Server OAuth"; copy the
// Account ID, Client ID and Client Secret here. Scopes needed:
// user:read:admin, webinar:read:admin, meeting:read:admin, report:read:admin.
export function ZoomAccountDialog({
  clients,
  onClose,
  onSaved,
}: {
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [zClientId, setZClientId] = useState('');
  const [zClientSecret, setZClientSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr('');
    if (!clientId) return setErr('Pick which client this Zoom account belongs to.');
    if (!name.trim()) return setErr('Display name is required.');
    if (!accountId.trim() || !zClientId.trim() || !zClientSecret.trim())
      return setErr('Account ID, Client ID and Client Secret are all required.');

    setBusy(true);
    try {
      await api.post('/api/zoom-accounts', {
        name: name.trim(),
        client_id: clientId,
        credentials: {
          account_id: accountId.trim(),
          client_id: zClientId.trim(),
          client_secret: zClientSecret.trim(),
        },
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Connect Zoom account"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}

      <div className="field-row">
        <Field label="Client" hint="Synced webinars/meetings become this client's.">
          <StatusSelect value={clientId} onChange={setClientId} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Display name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Zoom" />
        </Field>
      </div>

      <Field label="Account ID">
        <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} autoComplete="off" placeholder="abCdEf…" />
      </Field>
      <Field label="Client ID">
        <input className="input" value={zClientId} onChange={(e) => setZClientId(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Client Secret">
        <input className="input" type="password" value={zClientSecret} onChange={(e) => setZClientSecret(e.target.value)} autoComplete="off" />
      </Field>

      <div className="hint" style={{ color: 'var(--faint)', fontSize: 11.5, marginTop: 4 }}>
        From a <b>Server-to-Server OAuth</b> app at marketplace.zoom.us. Add scopes <code>user:read:admin</code>,{' '}
        <code>webinar:read:admin</code>, <code>meeting:read:admin</code>, <code>report:read:admin</code>. Credentials are
        encrypted (AES-256-GCM) before storage. Participant/attendance numbers need a paid Zoom plan.
      </div>
    </Modal>
  );
}
