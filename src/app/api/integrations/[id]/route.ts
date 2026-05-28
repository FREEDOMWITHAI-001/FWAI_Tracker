import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of ['name', 'detail', 'status', 'sort_order'] as const) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from('integrations').update(patch).eq('id', id).select().single();
    if (error) return bad(error.message, 500);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('integrations').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}
