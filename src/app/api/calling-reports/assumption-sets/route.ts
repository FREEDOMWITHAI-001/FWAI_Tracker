import { exec, jsonb, sql, tx } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { mergeAssumptions } from '@/lib/reports/store';

export const runtime = 'nodejs';

// GET /api/calling-reports/assumption-sets?client_id=
// Saved knob sets. The default set seeds every new report for that client, so
// the decisions settled in month 1 are not re-litigated in month 2.
export async function GET(req: Request) {
  return guard(async () => {
    const clientId = new URL(req.url).searchParams.get('client_id');
    if (!clientId) return bad('client_id is required');
    const rows = await sql(
      'select * from report_assumption_sets where client_id = $1 order by is_default desc',
      [clientId]
    );
    return ok(rows);
  });
}

// POST /api/calling-reports/assumption-sets  { client_id, name, params, is_default? }
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id || !body?.name) return bad('client_id and name are required');
    const params = mergeAssumptions(body.params);

    // Clearing the old default and setting the new one is one transaction:
    // if the upsert failed on its own, the client would be left with no
    // default set at all and new reports would silently lose their seed.
    const data = await tx(async (c) => {
      if (body.is_default) {
        await c.query('update report_assumption_sets set is_default = false where client_id = $1', [
          body.client_id,
        ]);
      }
      const res = await c.query(
        `insert into report_assumption_sets (client_id, name, params, is_default, updated_at)
         values ($1, $2, $3, $4, $5)
         on conflict (client_id, name) do update
            set params     = excluded.params,
                is_default = excluded.is_default,
                updated_at = excluded.updated_at
         returning *`,
        [body.client_id, body.name, jsonb(params), !!body.is_default, new Date().toISOString()]
      );
      return res.rows[0];
    });
    return ok(data, 201);
  });
}

// DELETE /api/calling-reports/assumption-sets?id=
export async function DELETE(req: Request) {
  return guard(async () => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return bad('id is required');
    await exec('delete from report_assumption_sets where id = $1', [id]);
    return ok({ deleted: true });
  });
}
