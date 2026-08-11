import { deleteById, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { closeOrphanedIncidents } from '@/lib/alerts';

type Ctx = { params: Promise<{ id: string }> };
const APP_FIELDS = ['vm_id', 'name', 'type', 'host', 'status', 'resp_ms', 'health', 'uptime', 'check_url', 'check_host', 'check_port', 'alert_name', 'alert_phone', 'tag'] as const;

// GET /api/apps/[id] -> one app with its client name
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const data = await maybeOne(
      `select a.*, coalesce(c.name, '—') as client_name
         from apps a
         left join clients c on c.id = a.client_id
        where a.id = $1`,
      [id]
    );
    if (!data) return bad('App not found', 404);
    return ok(data);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of APP_FIELDS) if (body[f] !== undefined) patch[f] = body[f] === '' && f === 'vm_id' ? null : body[f];
    const data = await updateById('apps', id, patch);
    if (!data) return bad('App not found', 404);
    return ok(data);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('apps', id);
    // Its open incident can no longer resolve itself — the alerter only iterates
    // rows that still exist.
    await closeOrphanedIncidents();
    return ok({ deleted: true });
  });
}
