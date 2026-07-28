import { insertOne, jsonb, maybeOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { DEFAULT_ASSUMPTIONS } from '@/lib/reports/types';
import { loadTemplate } from '@/lib/reports/store';

export const runtime = 'nodejs';

// GET /api/calling-reports?client_id=
// Report history, newest first. `result` is omitted — it can be megabytes.
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const params: unknown[] = [];
    let where = '';
    if (clientId) {
      params.push(clientId);
      where = 'where r.client_id = $1';
    }
    // The dataset roles/count are aggregated in SQL so the megabyte-sized
    // `result` column is never read, and neither are the dataset rows.
    const rows = await sql<any>(
      `select r.id, r.client_id, r.name, r.template_key, r.period_label,
              r.period_start, r.period_end, r.status, r.error, r.generated_at,
              r.run_count, r.quality_ack_at, r.created_at, r.updated_at,
              coalesce(c.name, '—') as client_name,
              coalesce((select array_agg(distinct d.role)
                          from report_datasets d where d.report_id = r.id), '{}') as dataset_roles,
              (select count(*) from report_datasets d where d.report_id = r.id) as dataset_count
         from calling_reports r
         left join clients c on c.id = r.client_id
         ${where}
        order by r.created_at desc
        limit 200`,
      params
    );
    return ok(rows.map((r) => ({ ...r, dataset_count: Number(r.dataset_count) })));
  });
}

// POST /api/calling-reports  { client_id, name, template_key, period_label?,
//                              period_start?, period_end?, assumptions?, copy_from? }
// Creates a draft. `copy_from` clones another report's assumptions — this is
// how month 2 inherits every knob month 1 settled on.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');
    if (!body?.template_key) return bad('template_key is required');

    const template = await loadTemplate(body.client_id, body.template_key);
    if (!template) return bad(`Unknown template "${body.template_key}"`);

    let assumptions = { ...DEFAULT_ASSUMPTIONS, ...(body.assumptions ?? {}) };

    if (body.copy_from) {
      const prev = await maybeOne<{ assumptions: object | null }>(
        'select assumptions from calling_reports where id = $1',
        [body.copy_from]
      );
      if (prev?.assumptions) assumptions = { ...assumptions, ...prev.assumptions };
    } else {
      // Otherwise fall back to the client's default saved assumption set.
      const set = await maybeOne<{ params: object | null }>(
        'select params from report_assumption_sets where client_id = $1 and is_default = true',
        [body.client_id]
      );
      if (set?.params) assumptions = { ...assumptions, ...set.params };
    }

    const data = await insertOne('calling_reports', {
      client_id: body.client_id,
      name: body.name,
      template_key: body.template_key,
      period_label: body.period_label ?? null,
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
      assumptions: jsonb(assumptions),
      status: 'draft',
    });
    return ok(data, 201);
  });
}
