import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/zoom-accounts/[id] -> remove account (cascades its sessions)
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('zoom_accounts').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}
