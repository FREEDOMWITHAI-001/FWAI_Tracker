import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/alerts/[id] — resolve/reopen or edit fields.
// Sets resolved_at automatically when status flips to 'resolved'.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of ['severity', 'title', 'description', 'whatsapp_sent', 'status', 'client_id'] as const) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    if (body.status === 'resolved') patch.resolved_at = new Date().toISOString();
    if (body.status === 'active') patch.resolved_at = null;
    const db = supabaseAdmin();
    const { data, error } = await db.from('alerts').update(patch).eq('id', id).select().single();
    if (error) return bad(error.message, 500);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('alerts').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}
