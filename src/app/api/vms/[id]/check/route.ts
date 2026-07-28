import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { checkVm } from '@/lib/checks';

export const runtime = 'nodejs';
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/vms/[id]/check -> probe this VM's health_url right now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const vm = await maybeOne<{
      id: string;
      host: string | null;
      port: number | null;
      health_url: string | null;
      ssh_user: string | null;
      ssh_port: number | null;
      ssh_key_encrypted: string | null;
      ssh_pass_encrypted: string | null;
    }>(
      `select id, host, port, health_url, ssh_user, ssh_port, ssh_key_encrypted, ssh_pass_encrypted
         from vms where id = $1`,
      [id]
    );
    if (!vm) return bad('VM not found', 404);
    if (!vm.port && !vm.health_url && !vm.ssh_key_encrypted) return bad('This VM has no SSH, host:port or Health URL set. Add one to run checks.');
    const out = await checkVm(vm);
    return ok(out);
  });
}
