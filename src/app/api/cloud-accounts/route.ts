import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

// GET /api/cloud-accounts -> accounts WITHOUT secrets, plus client name + vm count
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('cloud_accounts')
      .select('id, client_id, name, provider, label, last_synced_at, last_sync_error, created_at, clients(name), vms(count)')
      .order('created_at', { ascending: false });
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((a: any) => ({
      id: a.id,
      client_id: a.client_id,
      name: a.name,
      provider: a.provider,
      label: a.label,
      last_synced_at: a.last_synced_at,
      last_sync_error: a.last_sync_error,
      created_at: a.created_at,
      client_name: a.clients?.name ?? '—',
      vm_count: a.vms?.[0]?.count ?? 0,
    }));
    return ok(rows);
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

    const db = supabaseAdmin();
    const { data, error } = await db
      .from('cloud_accounts')
      .insert({ name, client_id, provider, label, credentials_encrypted })
      .select('id, name, provider, label, client_id, created_at')
      .single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}