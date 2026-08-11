import { deleteById, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { closeOrphanedIncidents } from '@/lib/alerts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };
const VM_FIELDS = ['name', 'provider', 'region', 'status', 'cpu', 'mem', 'disk', 'uptime_label', 'health_url', 'host', 'port', 'alert_name', 'alert_phone', 'ssh_user', 'ssh_port', 'tag'] as const;

function sanitize(v: any) {
  const { ssh_key_encrypted, ssh_pass_encrypted, ...rest } = v;
  return { ...rest, has_ssh: !!ssh_key_encrypted, client_name: rest.client_name ?? '—' };
}

// GET /api/vms/[id] -> one VM with its client name (no secrets)
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const data = await maybeOne(
      `select v.*, c.name as client_name
         from vms v
         left join clients c on c.id = v.client_id
        where v.id = $1`,
      [id]
    );
    if (!data) return bad('VM not found', 404);
    return ok(sanitize(data));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of VM_FIELDS) if (body[f] !== undefined) patch[f] = body[f];
    // Only re-encrypt when a new key/passphrase is actually provided.
    if (body.ssh_key && String(body.ssh_key).trim()) patch.ssh_key_encrypted = encrypt(String(body.ssh_key).trim());
    if (body.ssh_pass !== undefined) patch.ssh_pass_encrypted = String(body.ssh_pass).trim() ? encrypt(String(body.ssh_pass).trim()) : null;
    const data = await updateById('vms', id, patch);
    if (!data) return bad('VM not found', 404);
    return ok(sanitize(data));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('vms', id);
    // Its open incident can no longer resolve itself — the alerter only iterates
    // rows that still exist.
    await closeOrphanedIncidents();
    return ok({ deleted: true });
  });
}
