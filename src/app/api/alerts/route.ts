import { insertOne, maybeOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { sendManualAlert } from '@/lib/alerts';

// `whatsapp_sent` is deliberately NOT accepted from the client. It records what
// AI Sensy actually did, so only the server writes it — pass `send_whatsapp: true`
// to ask for a real delivery instead of asserting one happened.
const ALERT_FIELDS = ['client_id', 'severity', 'title', 'description', 'status'] as const;

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

// POST /api/alerts   { title, severity?, client_id?, description?, send_whatsapp? }
//
// Raises an operator alert. With send_whatsapp, the message goes out through the
// same AI Sensy path the downtime alerter uses and the outcome is stored on the
// row. A failed send does NOT fail the request — the alert is still raised, and
// the caller gets `whatsapp_error` back to show why nothing was delivered.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.title) return bad('title is required');
    const row: Record<string, unknown> = { source_kind: 'manual' };
    for (const f of ALERT_FIELDS) if (body[f] !== undefined) row[f] = body[f] === '' && f === 'client_id' ? null : body[f];
    const data = await insertOne<any>('alerts', row);

    if (!body.send_whatsapp) return ok(data, 201);

    await sendManualAlert(data.id);
    // Re-read so the response carries the stored delivery state verbatim rather
    // than a client-side reconstruction of it.
    const fresh = await maybeOne('select * from alerts where id = $1', [data.id]);
    return ok(fresh ?? data, 201);
  });
}
