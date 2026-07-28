import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const RANGE_HOURS: Record<string, number> = { '1h': 1, '4h': 4, '12h': 12, '1d': 24, '3d': 72, '1w': 168, '1m': 720 };

// GET /api/apps/[id]/metrics?range=1d|3d|1w|1m|all -> samples oldest-first
export async function GET(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const url = new URL(req.url);
    const range = url.searchParams.get('range') || '1d';

    const params_: unknown[] = [id];
    let cutoffClause = '';
    if (range !== 'all' && RANGE_HOURS[range]) {
      params_.push(new Date(Date.now() - RANGE_HOURS[range] * 3600 * 1000).toISOString());
      cutoffClause = `and checked_at >= $${params_.length}`;
    }

    // Newest 2000 within the range, then flipped to oldest-first for the chart.
    const rows = await sql(
      `select * from (
         select checked_at, status, response_ms
           from app_metrics
          where app_id = $1 ${cutoffClause}
          order by checked_at desc
          limit 2000
       ) s order by checked_at asc`,
      params_
    );
    return ok(rows);
  });
}
