import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

const VM_FIELDS = ['client_id', 'name', 'provider', 'region', 'status', 'cpu', 'mem', 'disk', 'uptime_label', 'health_url', 'host', 'port', 'alert_name', 'alert_phone'] as const;

// GET /api/vms -> all VMs with the client name attached
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('vms')
      .select('*, clients(name)')
      .order('created_at', { ascending: true });
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((v: any) => ({ ...v, client_name: v.clients?.name ?? '—' }));
    return ok(rows);
  });
}

// POST /api/vms
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');
    const row: Record<string, unknown> = {};
    for (const f of VM_FIELDS) if (body[f] !== undefined) row[f] = body[f];
    const db = supabaseAdmin();
    const { data, error } = await db.from('vms').insert(row).select().single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}