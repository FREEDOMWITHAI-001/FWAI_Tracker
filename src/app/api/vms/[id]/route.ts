import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };
const VM_FIELDS = ['name', 'provider', 'region', 'status', 'cpu', 'mem', 'disk', 'uptime_label', 'health_url', 'host', 'port', 'alert_name', 'alert_phone', 'ssh_user', 'ssh_port', 'tag'] as const;

function sanitize(v: any) {
  const { ssh_key_encrypted, ssh_pass_encrypted, clients, ...rest } = v;
  return { ...rest, has_ssh: !!ssh_key_encrypted, client_name: clients?.name ?? rest.client_name ?? '—' };
}

// GET /api/vms/[id] -> one VM with its client name (no secrets)
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data, error } = await db.from('vms').select('*, clients(name)').eq('id', id).single();
    if (error) return bad(error.message, 404);
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
    const db = supabaseAdmin();
    const { data, error } = await db.from('vms').update(patch).eq('id', id).select().single();
    if (error) return bad(error.message, 500);
    return ok(sanitize(data));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('vms').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}