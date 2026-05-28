import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { checkVm } from '@/lib/checks';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// POST /api/vms/[id]/check -> probe this VM's health_url right now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: vm, error } = await db.from('vms').select('id, host, port, health_url').eq('id', id).single();
    if (error) return bad(error.message, 404);
    if (!vm.port && !vm.health_url) return bad('This VM has no host:port (or Health URL) set. Add one to run checks.');
    const out = await checkVm(db, vm);
    return ok(out);
  });
}
