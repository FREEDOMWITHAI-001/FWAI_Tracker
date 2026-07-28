import { insertMany, insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

interface StageInput {
  stage: string;
  triggered?: number;
  succeeded?: number;
  failed?: number;
}

// GET /api/webinars -> webinars with stages + client name, newest first
export async function GET() {
  return guard(async () => {
    // Stages are ordered inside the aggregate, so no re-sort is needed in JS.
    const rows = await sql(
      `select w.*,
              coalesce(c.name, '—') as client_name,
              coalesce((select json_agg(s order by s.sort_order)
                          from webinar_stages s
                         where s.webinar_id = w.id), '[]'::json) as webinar_stages
         from webinars w
         left join clients c on c.id = w.client_id
        order by w.webinar_date desc nulls last`
    );
    return ok(rows);
  });
}

// POST /api/webinars  { client_id, name, ..., stages: [{stage, triggered, succeeded, failed}] }
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');

    const webinar = await insertOne<{ id: string }>('webinars', {
      client_id: body.client_id,
      name: body.name,
      participants: body.participants ?? 0,
      reminders: body.reminders ?? 0,
      attendance: body.attendance ?? 0,
      webinar_date: body.webinar_date || null,
      status: body.status ?? 'healthy',
    });

    const stages: StageInput[] = Array.isArray(body.stages) ? body.stages : [];
    if (stages.length) {
      const rows = stages
        .filter((s) => s.stage?.trim())
        .map((s, i) => ({
          webinar_id: webinar.id,
          stage: s.stage,
          triggered: Number(s.triggered) || 0,
          succeeded: Number(s.succeeded) || 0,
          failed: Number(s.failed) || 0,
          sort_order: i,
        }));
      if (rows.length) await insertMany('webinar_stages', rows);
    }
    return ok(webinar, 201);
  });
}
