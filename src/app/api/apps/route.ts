import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

const APP_FIELDS = ['client_id', 'vm_id', 'name', 'type', 'host', 'status', 'resp_ms', 'health', 'uptime', 'check_url', 'check_host', 'check_port', 'alert_name', 'alert_phone'] as const;

// GET /api/apps -> all apps with client name
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('apps')
      .select('*, clients(name)')
      .order('created_at', { ascending: true });
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((a: any) => ({ ...a, client_name: a.clients?.name ?? '—' }));
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
    const db = supabaseAdmin();
    const { data, error } = await db.from('apps').insert(row).select().single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}