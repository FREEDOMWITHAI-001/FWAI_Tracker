import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };
const APP_FIELDS = ['vm_id', 'name', 'type', 'host', 'status', 'resp_ms', 'health', 'uptime', 'check_url', 'check_host', 'check_port', 'alert_name', 'alert_phone'] as const;

// GET /api/apps/[id] -> one app with its client name
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data, error } = await db.from('apps').select('*, clients(name)').eq('id', id).single();
    if (error) return bad(error.message, 404);
    return ok({ ...data, client_name: (data as any).clients?.name ?? '—' });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of APP_FIELDS) if (body[f] !== undefined) patch[f] = body[f] === '' && f === 'vm_id' ? null : body[f];
    const db = supabaseAdmin();
    const { data, error } = await db.from('apps').update(patch).eq('id', id).select().single();
    if (error) return bad(error.message, 500);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('apps').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}