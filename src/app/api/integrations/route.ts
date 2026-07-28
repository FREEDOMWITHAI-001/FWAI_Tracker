import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

export async function GET() {
  return guard(async () => {
    const rows = await sql('select * from integrations order by sort_order asc');
    return ok(rows);
  });
}

export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.name) return bad('name is required');
    const data = await insertOne('integrations', {
      name: body.name,
      detail: body.detail ?? '',
      status: body.status ?? 'healthy',
      sort_order: body.sort_order ?? 99,
    });
    return ok(data, 201);
  });
}
