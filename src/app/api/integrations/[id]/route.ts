import { deleteById, updateById } from '@/lib/db';
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
    const data = await updateById('integrations', id, patch);
    if (!data) return bad('Integration not found', 404);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('integrations', id);
    return ok({ deleted: true });
  });
}
