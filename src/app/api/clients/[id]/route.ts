import { deleteById, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { closeOrphanedIncidents } from '@/lib/alerts';

type Ctx = { params: Promise<{ id: string }> };

// Strip secret SSH blobs before returning a VM to the client; expose has_ssh
// instead (mirrors /api/vms).
function sanitizeVm(v: any) {
  const { ssh_key_encrypted, ssh_pass_encrypted, ...rest } = v;
  return { ...rest, has_ssh: !!ssh_key_encrypted };
}

// The children are aggregated as JSON in correlated subqueries rather than
// joined, so exactly one row comes back and no parent column is duplicated
// across children. Each list coalesces to [] so an absent child set stays an
// empty array rather than null.
const CLIENT_SQL = `
  select c.*,
         coalesce((select json_agg(v order by v.created_at)
                     from vms v where v.client_id = c.id), '[]'::json) as vms,
         coalesce((select json_agg(a order by a.created_at)
                     from apps a where a.client_id = c.id), '[]'::json) as apps,
         coalesce((select json_agg(al order by al.created_at desc)
                     from alerts al where al.client_id = c.id), '[]'::json) as alerts,
         coalesce((select json_agg(w)
                     from (select w.*,
                                  coalesce((select json_agg(s order by s.id)
                                              from webinar_stages s
                                             where s.webinar_id = w.id), '[]'::json) as webinar_stages
                             from webinars w
                            where w.client_id = c.id
                            order by w.created_at) w), '[]'::json) as webinars
    from clients c
   where c.id = $1
`;

// GET /api/clients/[id] -> client with vms, apps, alerts, webinars(+stages)
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const data = await maybeOne<any>(CLIENT_SQL, [id]);
    if (!data) return bad('Client not found', 404);
    const sanitized = { ...data, vms: Array.isArray(data.vms) ? data.vms.map(sanitizeVm) : data.vms };
    return ok(sanitized);
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
    const data = await updateById('clients', id, patch);
    if (!data) return bad('Client not found', 404);
    return ok(data);
  });
}

// DELETE /api/clients/[id] (cascades to vms/apps/webinars)
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('clients', id);
    // Deleting a client cascades to its VMs, apps and OpenAI accounts, so any
    // incident they had open is now orphaned. The alert rows themselves survive
    // (client_id is set to null) — this closes them instead of leaving them
    // active for a target that no longer exists.
    await closeOrphanedIncidents();
    return ok({ deleted: true });
  });
}
