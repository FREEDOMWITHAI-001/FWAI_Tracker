import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

const ALERT_FIELDS = ['client_id', 'severity', 'title', 'description', 'whatsapp_sent', 'status'] as const;

// GET /api/alerts            -> all alerts (with client name), newest first
// GET /api/alerts?status=active
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const db = supabaseAdmin();
    let q = db.from('alerts').select('*, clients(name)').order('created_at', { ascending: false });
    if (status === 'active' || status === 'resolved') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((a: any) => ({ ...a, client_name: a.clients?.name ?? null }));
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
    const db = supabaseAdmin();
    const { data, error } = await db.from('alerts').insert(row).select().single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}
