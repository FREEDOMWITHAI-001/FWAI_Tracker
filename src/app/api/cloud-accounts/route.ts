import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

// GET /api/cloud-accounts -> accounts WITHOUT secrets, plus client name + vm count
export async function GET() {
  return guard(async () => {
    // credentials_encrypted is deliberately not selected — the column never
    // leaves the server. count(*) arrives as a bigint string, hence Number().
    const rows = await sql<any>(
      `select a.id, a.client_id, a.name, a.provider, a.label,
              a.last_synced_at, a.last_sync_error, a.created_at,
              coalesce(c.name, '—') as client_name,
              (select count(*) from vms v where v.cloud_account_id = a.id) as vm_count
         from cloud_accounts a
         left join clients c on c.id = a.client_id
        order by a.created_at desc`
    );
    return ok(rows.map((a) => ({ ...a, vm_count: Number(a.vm_count) })));
  });
}

// POST /api/cloud-accounts  { name, client_id, provider, credentials }
// Validates per provider, derives a non-secret label, encrypts and stores.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const { name, client_id, provider, credentials } = body ?? {};
    if (!name || !client_id || !provider || !credentials) {
      return bad('name, client_id, provider and credentials are required');
    }
    if (!['aws', 'azure', 'gcp', 'oci'].includes(provider)) return bad('provider must be aws | azure | gcp | oci');

    let label = '';
    if (provider === 'aws') {
      const c = credentials;
      if (!c.accessKeyId || !c.secretAccessKey || !c.region) return bad('AWS requires accessKeyId, secretAccessKey, region');
      label = String(c.accessKeyId).slice(0, 8) + '…';
    } else if (provider === 'azure') {
      const c = credentials;
      if (!c.tenantId || !c.clientId || !c.clientSecret || !c.subscriptionId)
        return bad('Azure requires tenantId, clientId, clientSecret, subscriptionId');
      label = String(c.subscriptionId);
    } else if (provider === 'gcp') {
      const c = credentials;
      if (!c.project_id || !c.client_email || !c.private_key) return bad('GCP key must include project_id, client_email and private_key');
      label = String(c.project_id);
    } else {
      const c = credentials;
      if (!c.tenancyId || !c.userId || !c.fingerprint || !c.region || !c.privateKey)
        return bad('OCI requires tenancyId, userId, fingerprint, region and privateKey');
      label = String(c.region) + ' · ' + String(c.fingerprint).slice(0, 11) + '…';
    }

    let credentials_encrypted: string;
    try {
      credentials_encrypted = encrypt(JSON.stringify(credentials));
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'encryption failed', 500);
    }

    const row = await insertOne<any>('cloud_accounts', { name, client_id, provider, label, credentials_encrypted });
    // Echo back only the non-secret columns the previous .select() returned.
    return ok(
      {
        id: row.id,
        name: row.name,
        provider: row.provider,
        label: row.label,
        client_id: row.client_id,
        created_at: row.created_at,
      },
      201
    );
  });
}
