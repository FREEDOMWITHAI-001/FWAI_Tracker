import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// GET /api/calling-reports/[id]/versions
// The version list for one report, newest first. `result`/`quality` are NOT
// selected — they can be megabytes each and this drives a table. The
// denormalised headline/buyers/revenue columns are enough to compare runs at a
// glance; fetch one version to see its full numbers.
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const rows = await sql(
      `select id, version, template_key, period_label, quality_hash,
              fact_count, headline, primary_lens, buyers, revenue, created_at,
              assumptions
         from report_versions
        where report_id = $1
        order by version desc`,
      [id]
    );
    return ok(rows);
  });
}
