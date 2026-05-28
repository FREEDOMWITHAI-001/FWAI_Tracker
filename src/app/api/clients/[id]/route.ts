import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/clients/[id] -> client with vms, apps, alerts, webinars(+stages)
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('clients')
      .select(
        '*, vms(*), apps(*), alerts(*), webinars(*, webinar_stages(*))'
      )
      .eq('id', id)
      .single();
    if (error) return bad(error.message, error.code === 'PGRST116' ? 404 : 500);
    return ok(data);
  });
}

// PATCH /api/clients/[id]
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.industry !== undefined) patch.industry = body.industry;
    if (body.alert_name !== undefined) patch.alert_name = body.alert_name;
    if (body.alert_phone !== undefined) patch.alert_phone = body.alert_phone;
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('clients')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return bad(error.message, 500);
    return ok(data);
  });
}

// DELETE /api/clients/[id] (cascades to vms/apps/webinars)
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('clients').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}