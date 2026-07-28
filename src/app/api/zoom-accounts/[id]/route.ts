import { deleteById } from '@/lib/db';
import { ok, guard } from '@/lib/api';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/zoom-accounts/[id] -> remove account (cascades its sessions)
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('zoom_accounts', id);
    return ok({ deleted: true });
  });
}
