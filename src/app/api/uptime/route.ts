import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

// GET /api/uptime            -> fleet-wide samples (client_id IS NULL), last 14 by day
// GET /api/uptime?client_id= -> samples for a specific client
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const db = supabaseAdmin();
    let q = db.from('uptime_samples').select('day,uptime').order('day', { ascending: true }).limit(60);
    q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
    const { data, error } = await q;
    if (error) return bad(error.message, 500);
    return ok((data ?? []).map((r: any) => Number(r.uptime)));
  });
}
