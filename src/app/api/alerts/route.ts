import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

const ALERT_FIELDS = ['client_id', 'severity', 'title', 'description', 'whatsapp_sent', 'status'] as const;

// GET /api/alerts            -> all alerts (with client name), newest first
// GET /api/alerts?status=active
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const params: unknown[] = [];
    let where = '';
    if (status === 'active' || status === 'resolved') {
      params.push(status);
      where = 'where a.status = $1';
    }
    const rows = await sql(
      `select a.*, c.name as client_name
         from alerts a
         left join clients c on c.id = a.client_id
         ${where}
        order by a.created_at desc`,
      params
    );
    return ok(rows);
  });
}

// POST /api/alerts
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.title) return bad('title is required');
    const row: Record<string, unknown> = {};
    for (const f of ALERT_FIELDS) if (body[f] !== undefined) row[f] = body[f] === '' && f === 'client_id' ? null : body[f];
    const data = await insertOne('alerts', row);
    return ok(data, 201);
  });
}
