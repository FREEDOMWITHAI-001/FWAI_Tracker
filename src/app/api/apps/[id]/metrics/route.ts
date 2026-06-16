import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const RANGE_HOURS: Record<string, number> = { '1h': 1, '4h': 4, '12h': 12, '1d': 24, '3d': 72, '1w': 168, '1m': 720 };

// GET /api/apps/[id]/metrics?range=1d|3d|1w|1m|all -> samples oldest-first
export async function GET(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const url = new URL(req.url);
    const range = url.searchParams.get('range') || '1d';
    const db = supabaseAdmin();

    let q = db
      .from('app_metrics')
      .select('checked_at,status,response_ms')
      .eq('app_id', id)
      .order('checked_at', { ascending: false })
      .limit(2000);

    if (range !== 'all' && RANGE_HOURS[range]) {
      const cutoff = new Date(Date.now() - RANGE_HOURS[range] * 3600 * 1000).toISOString();
      q = q.gte('checked_at', cutoff);
    }

    const { data, error } = await q;
    if (error) return bad(error.message, 500);
    return ok((data ?? []).slice().reverse());
  });
}
