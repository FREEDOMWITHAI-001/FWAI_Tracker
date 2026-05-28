'use client';

import { useState } from 'react';
import { Modal, Field, StatusSelect } from '@/components/ui';
import { api } from '@/lib/client';
import type { Client, Cloud } from '@/lib/types';

export function CloudAccountDialog({
  clients,
  onClose,
  onSaved,
}: {
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Cloud>('aws');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // aws
  const [awsKey, setAwsKey] = useState('');
  const [awsSecret, setAwsSecret] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  // azure
  const [azTenant, setAzTenant] = useState('');
  const [azClient, setAzClient] = useState('');
  const [azSecret, setAzSecret] = useState('');
  const [azSub, setAzSub] = useState('');
  // gcp
  const [gcpJson, setGcpJson] = useState('');
  // oci
  const [ociTenancy, setOciTenancy] = useState('');
  const [ociUser, setOciUser] = useState('');
  const [ociFingerprint, setOciFingerprint] = useState('');
  const [ociRegion, setOciRegion] = useState('ap-mumbai-1');
  const [ociCompartment, setOciCompartment] = useState('');
  const [ociKey, setOciKey] = useState('');

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setGcpJson(text);
    try {
      const parsed = JSON.parse(text);
      if (!name && parsed.project_id) setName(parsed.project_id);
    } catch {
      /* ignore */
    }
  };

  const save = async () => {
    setErr('');
    if (!clientId) return setErr('Pick which client these VMs belong to.');
    if (!name.trim()) return setErr('Display name is required.');

    let credentials: any;
    if (tab === 'aws') {
      if (!awsKey.trim() || !awsSecret.trim() || !awsRegion.trim()) return setErr('Fill in all AWS fields.');
      credentials = { accessKeyId: awsKey.trim(), secretAccessKey: awsSecret.trim(), region: awsRegion.trim() };
    } else if (tab === 'azure') {
      if (!azTenant.trim() || !azClient.trim() || !azSecret.trim() || !azSub.trim()) return setErr('Fill in all Azure fields.');
      credentials = { tenantId: azTenant.trim(), clientId: azClient.trim(), clientSecret: azSecret.trim(), subscriptionId: azSub.trim() };
    } else if (tab === 'gcp') {
      try {
        credentials = JSON.parse(gcpJson);
      } catch {
        return setErr('Service account key is not valid JSON.');
      }
      if (!credentials.project_id || !credentials.client_email || !credentials.private_key)
        return setErr('That JSON is missing project_id / client_email / private_key.');
    } else {
      if (!ociTenancy.trim() || !ociUser.trim() || !ociFingerprint.trim() || !ociRegion.trim() || !ociKey.trim())
        return setErr('Fill in tenancy OCID, user OCID, fingerprint, region and private key.');
      credentials = {
        tenancyId: ociTenancy.trim(),
        userId: ociUser.trim(),
        fingerprint: ociFingerprint.trim(),
        region: ociRegion.trim(),
        privateKey: ociKey,
        compartmentId: ociCompartment.trim() || undefined,
      };
    }

    setBusy(true);
    try {
      await api.post('/api/cloud-accounts', { name: name.trim(), client_id: clientId, provider: tab, credentials });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add cloud account"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Connecting…' : 'Add account'}
          </button>
        </>
      }
    >
      {err && <div className="form-err">{err}</div>}

      <div className="field-row">
        <Field label="Client" hint="Imported instances become this client's VMs.">
          <StatusSelect value={clientId} onChange={setClientId} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Display name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-aws / staging-azure" />
        </Field>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'aws' ? 'on' : ''} onClick={() => setTab('aws')} type="button">
          AWS
        </button>
        <button className={tab === 'azure' ? 'on' : ''} onClick={() => setTab('azure')} type="button">
          Azure
        </button>
        <button className={tab === 'gcp' ? 'on' : ''} onClick={() => setTab('gcp')} type="button">
          GCP
        </button>
        <button className={tab === 'oci' ? 'on' : ''} onClick={() => setTab('oci')} type="button">
          OCI
        </button>
      </div>

      {tab === 'aws' && (
        <>
          <Field label="Access key ID">
            <input className="input" value={awsKey} onChange={(e) => setAwsKey(e.target.value)} placeholder="AKIA…" autoComplete="off" />
          </Field>
          <Field label="Secret access key">
            <input className="input" type="password" value={awsSecret} onChange={(e) => setAwsSecret(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Default region" hint="Used to discover the other enabled regions.">
            <input className="input" value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} placeholder="ap-south-1" />
          </Field>
        </>
      )}

      {tab === 'azure' && (
        <>
          <div className="field-row">
            <Field label="Tenant ID">
              <input className="input" value={azTenant} onChange={(e) => setAzTenant(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Subscription ID">
              <input className="input" value={azSub} onChange={(e) => setAzSub(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Client (Application) ID">
            <input className="input" value={azClient} onChange={(e) => setAzClient(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Client secret">
            <input className="input" type="password" value={azSecret} onChange={(e) => setAzSecret(e.target.value)} autoComplete="off" />
          </Field>
        </>
      )}

      {tab === 'gcp' && (
        <>
          <Field label="Service account JSON key">
            <label className="btn" style={{ marginBottom: 8, display: 'inline-flex' }}>
              Upload .json file
              <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
            </label>
            <textarea
              className="textarea"
              rows={6}
              value={gcpJson}
              onChange={(e) => setGcpJson(e.target.value)}
              placeholder='{ "type": "service_account", "project_id": "...", "client_email": "...", "private_key": "..." }'
              style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}
            />
          </Field>
        </>
      )}

      {tab === 'oci' && (
        <>
          <div className="field-row">
            <Field label="Tenancy OCID">
              <input className="input" value={ociTenancy} onChange={(e) => setOciTenancy(e.target.value)} placeholder="ocid1.tenancy.oc1..aaaa…" autoComplete="off" />
            </Field>
            <Field label="User OCID">
              <input className="input" value={ociUser} onChange={(e) => setOciUser(e.target.value)} placeholder="ocid1.user.oc1..aaaa…" autoComplete="off" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Key fingerprint">
              <input className="input" value={ociFingerprint} onChange={(e) => setOciFingerprint(e.target.value)} placeholder="12:34:56:…" autoComplete="off" />
            </Field>
            <Field label="Region">
              <input className="input" value={ociRegion} onChange={(e) => setOciRegion(e.target.value)} placeholder="ap-mumbai-1" />
            </Field>
          </div>
          <Field label="Compartment OCID (optional)" hint="Leave blank to scan the tenancy (root compartment).">
            <input className="input" value={ociCompartment} onChange={(e) => setOciCompartment(e.target.value)} placeholder="ocid1.compartment.oc1..aaaa…" autoComplete="off" />
          </Field>
          <Field label="Private key (PEM)" hint="From the API key pair you created under your OCI user.">
            <textarea
              className="textarea"
              rows={6}
              value={ociKey}
              onChange={(e) => setOciKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----"
              style={{ fontFamily: 'IBM Plex Mono', fontSize: 12 }}
            />
          </Field>
        </>
      )}

      <div className="hint" style={{ color: 'var(--faint)', fontSize: 11.5, marginTop: 4 }}>
        Credentials are encrypted (AES-256-GCM) before being stored — only the encrypted blob is saved. Use a read-only
        role/key where possible.
      </div>
    </Modal>
  );
}