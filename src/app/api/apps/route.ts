import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

const APP_FIELDS = ['client_id', 'vm_id', 'name', 'type', 'host', 'status', 'resp_ms', 'health', 'uptime', 'check_url', 'check_host', 'check_port', 'alert_name', 'alert_phone', 'tag'] as const;

// GET /api/apps -> all apps with client name
export async function GET() {
  return guard(async () => {
    const rows = await sql(
      `select a.*, coalesce(c.name, '—') as client_name
         from apps a
         left join clients c on c.id = a.client_id
        order by a.created_at asc`
    );
    return ok(rows);
  });
}

// POST /api/apps
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');
    const row: Record<string, unknown> = {};
    for (const f of APP_FIELDS) if (body[f] !== undefined) row[f] = body[f] === '' && f === 'vm_id' ? null : body[f];
    const data = await insertOne('apps', row);
    return ok(data, 201);
  });
}
