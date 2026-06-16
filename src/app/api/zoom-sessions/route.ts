import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

export const runtime = 'nodejs';

// GET /api/zoom-sessions?client_id=&account_id=&kind=
// Synced Zoom webinars/meetings, newest first, with client name.
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const accountId = url.searchParams.get('account_id');
    const kind = url.searchParams.get('kind');

    const db = supabaseAdmin();
    let q = db
      .from('zoom_sessions')
      .select('*, clients(name)')
      .order('start_time', { ascending: false, nullsFirst: false })
      .limit(500);
    if (clientId) q = q.eq('client_id', clientId);
    if (accountId) q = q.eq('zoom_account_id', accountId);
    if (kind) q = q.eq('kind', kind);

    const { data, error } = await q;
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((s: any) => ({ ...s, client_name: s.clients?.name ?? '—' }));
    return ok(rows);
  });
}
