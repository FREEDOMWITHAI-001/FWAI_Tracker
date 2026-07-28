import { deleteById, tx, updateById } from '@/lib/db';
import { ok, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };
const FIELDS = ['name', 'participants', 'reminders', 'attendance', 'webinar_date', 'status'] as const;

// PATCH /api/webinars/[id] — edits the webinar; if `stages` is provided,
// replaces the full stage set.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f] === '' && f === 'webinar_date' ? null : body[f];
    if (Object.keys(patch).length) await updateById('webinars', id, patch);

    if (Array.isArray(body.stages)) {
      const rows = body.stages
        .filter((s: any) => s.stage?.trim())
        .map((s: any, i: number) => ({
          stage: s.stage,
          triggered: Number(s.triggered) || 0,
          succeeded: Number(s.succeeded) || 0,
          failed: Number(s.failed) || 0,
          sort_order: i,
        }));
      // Replacing the set is delete-then-insert, so it runs in one transaction:
      // a failure partway through must not leave the webinar with no stages.
      await tx(async (c) => {
        await c.query('delete from webinar_stages where webinar_id = $1', [id]);
        for (const r of rows) {
          await c.query(
            `insert into webinar_stages (webinar_id, stage, triggered, succeeded, failed, sort_order)
             values ($1, $2, $3, $4, $5, $6)`,
            [id, r.stage, r.triggered, r.succeeded, r.failed, r.sort_order]
          );
        }
      });
    }
    return ok({ updated: true });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('webinars', id);
    return ok({ deleted: true });
  });
}
