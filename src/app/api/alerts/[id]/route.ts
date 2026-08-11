import { deleteById, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

// `whatsapp_sent` is not editable: it now reflects what AI Sensy actually did,
// written only by src/lib/alerts.ts.
const PATCH_FIELDS = ['severity', 'title', 'description', 'status', 'client_id'] as const;

// PATCH /api/alerts/[id] — resolve/reopen or edit fields.
// Sets resolved_at automatically when status flips to 'resolved'.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of PATCH_FIELDS) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    if (body.status === 'resolved') patch.resolved_at = new Date().toISOString();
    if (body.status === 'active') patch.resolved_at = null;

    let data;
    try {
      data = await updateById('alerts', id, patch);
    } catch (e: any) {
      // alerts_one_active_per_source: reopening a monitored target's alert while
      // a newer one is already open for the same target. Say so plainly instead
      // of surfacing a raw constraint name.
      if (e?.code === '23505') {
        return bad('That target already has an open alert — resolve it first.', 409);
      }
      throw e;
    }
    if (!data) return bad('Alert not found', 404);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('alerts', id);
    return ok({ deleted: true });
  });
}
