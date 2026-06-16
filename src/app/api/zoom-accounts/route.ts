import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

// GET /api/zoom-accounts -> accounts WITHOUT secrets, plus client name + session count
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('zoom_accounts')
      .select('id, client_id, name, account_id, label, last_synced_at, last_sync_error, created_at, clients(name), zoom_sessions(count)')
      .order('created_at', { ascending: false });
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((a: any) => ({
      id: a.id,
      client_id: a.client_id,
      name: a.name,
      account_id: a.account_id,
      label: a.label,
      last_synced_at: a.last_synced_at,
      last_sync_error: a.last_sync_error,
      created_at: a.created_at,
      client_name: a.clients?.name ?? '—',
      session_count: a.zoom_sessions?.[0]?.count ?? 0,
    }));
    return ok(rows);
  });
}

// POST /api/zoom-accounts  { name, client_id, credentials: { account_id, client_id, client_secret } }
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const { name, client_id, credentials } = body ?? {};
    if (!name || !client_id || !credentials) return bad('name, client_id and credentials are required');
    const c = credentials;
    if (!c.account_id || !c.client_id || !c.client_secret)
      return bad('Zoom requires account_id, client_id and client_secret');

    let credentials_encrypted: string;
    try {
      credentials_encrypted = encrypt(JSON.stringify(c));
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'encryption failed', 500);
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from('zoom_accounts')
      .insert({
        name,
        client_id,
        account_id: String(c.account_id),
        label: String(c.client_id).slice(0, 8) + '…',
        credentials_encrypted,
      })
      .select('id, name, account_id, label, client_id, created_at')
      .single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}
