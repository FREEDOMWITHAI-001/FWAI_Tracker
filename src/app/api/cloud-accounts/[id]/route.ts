import { deleteById } from '@/lib/db';
import { ok, guard } from '@/lib/api';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/cloud-accounts/[id] — also removes its imported VMs (FK cascade).
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('cloud_accounts', id);
    return ok({ deleted: true });
  });
}
