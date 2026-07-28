import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

// GET /api/zoom-accounts -> accounts WITHOUT secrets, plus client name + session count
export async function GET() {
  return guard(async () => {
    // credentials_encrypted is deliberately not selected — the column never
    // leaves the server. count(*) arrives as a bigint string, hence Number().
    const rows = await sql<any>(
      `select a.id, a.client_id, a.name, a.account_id, a.label,
              a.last_synced_at, a.last_sync_error, a.created_at,
              coalesce(c.name, '—') as client_name,
              (select count(*) from zoom_sessions z where z.zoom_account_id = a.id) as session_count
         from zoom_accounts a
         left join clients c on c.id = a.client_id
        order by a.created_at desc`
    );
    return ok(rows.map((a) => ({ ...a, session_count: Number(a.session_count) })));
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

    const row = await insertOne<any>('zoom_accounts', {
      name,
      client_id,
      account_id: String(c.account_id),
      label: String(c.client_id).slice(0, 8) + '…',
      credentials_encrypted,
    });
    // Echo back only the non-secret columns the previous .select() returned.
    return ok(
      {
        id: row.id,
        name: row.name,
        account_id: row.account_id,
        label: row.label,
        client_id: row.client_id,
        created_at: row.created_at,
      },
      201
    );
  });
}
