import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

const VM_FIELDS = ['client_id', 'name', 'provider', 'region', 'status', 'cpu', 'mem', 'disk', 'uptime_label', 'health_url', 'host', 'port', 'alert_name', 'alert_phone', 'ssh_user', 'ssh_port', 'tag'] as const;

// Strip secret blobs before returning to the client; expose has_ssh instead.
function sanitize(v: any) {
  const { ssh_key_encrypted, ssh_pass_encrypted, clients, ...rest } = v;
  return { ...rest, has_ssh: !!ssh_key_encrypted, client_name: clients?.name ?? rest.client_name ?? '—' };
}

// GET /api/vms -> all VMs with the client name attached (no secrets)
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('vms')
      .select('*, clients(name)')
      .order('created_at', { ascending: true });
    if (error) return bad(error.message, 500);
    return ok((data ?? []).map(sanitize));
  });
}

// POST /api/vms  (ssh_key / ssh_pass are encrypted before storage)
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');
    const row: Record<string, unknown> = {};
    for (const f of VM_FIELDS) if (body[f] !== undefined) row[f] = body[f];
    if (body.ssh_key && String(body.ssh_key).trim()) row.ssh_key_encrypted = encrypt(String(body.ssh_key).trim());
    if (body.ssh_pass && String(body.ssh_pass).trim()) row.ssh_pass_encrypted = encrypt(String(body.ssh_pass).trim());
    const db = supabaseAdmin();
    const { data, error } = await db.from('vms').insert(row).select().single();
    if (error) return bad(error.message, 500);
    return ok(sanitize(data), 201);
  });
}