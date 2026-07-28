import { exec, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { phone10 } from '@/lib/reports/identity';

export const runtime = 'nodejs';

const KINDS = ['phone', 'email', 'email_domain', 'name'];

// GET /api/calling-reports/exclusions?client_id=
// Per-client test/internal numbers. Kept per client because "our own QA number"
// is different for every account.
export async function GET(req: Request) {
  return guard(async () => {
    const clientId = new URL(req.url).searchParams.get('client_id');
    if (!clientId) return bad('client_id is required');
    const rows = await sql(
      'select * from report_exclusions where client_id = $1 order by created_at asc',
      [clientId]
    );
    return ok(rows);
  });
}

// POST /api/calling-reports/exclusions  { client_id, kind, value, note? }
// Accepts a newline/comma separated list in `value` for bulk paste.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    const kind = String(body.kind ?? 'phone');
    if (!KINDS.includes(kind)) return bad(`kind must be one of: ${KINDS.join(', ')}`);

    const values = String(body.value ?? '')
      .split(/[\n,;]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (kind === 'phone' ? phone10(v) ?? v : kind === 'email_domain' ? v.toLowerCase().replace(/^@/, '') : v.toLowerCase()));
    if (!values.length) return bad('value is required');

    // unnest turns the list into rows in one statement. DO NOTHING + RETURNING
    // yields only the values that were genuinely new, matching the previous
    // ignoreDuplicates upsert.
    const rows = await sql(
      `insert into report_exclusions (client_id, kind, value, note)
       select $1, $2, v, $3 from unnest($4::text[]) as v
       on conflict (client_id, kind, value) do nothing
       returning *`,
      [body.client_id, kind, body.note ?? null, values]
    );
    return ok(rows, 201);
  });
}

// DELETE /api/calling-reports/exclusions?id=
export async function DELETE(req: Request) {
  return guard(async () => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return bad('id is required');
    await exec('delete from report_exclusions where id = $1', [id]);
    return ok({ deleted: true });
  });
}
