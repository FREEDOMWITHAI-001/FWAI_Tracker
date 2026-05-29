import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { checkApp } from '@/lib/checks';

export const runtime = 'nodejs';
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/apps/[id]/check -> probe this application now (URL or host:port)
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: app, error } = await db.from('apps').select('id, check_url, check_host, check_port, vm_id').eq('id', id).single();
    if (error) return bad(error.message, 404);
    if (!app.check_url && !(app.check_host && app.check_port) && !(app.vm_id && app.check_port)) {
      return bad('This application needs a Check URL, host + port, or a host VM + port. Add one to run checks.');
    }
    const out = await checkApp(db, app);
    return ok(out);
  });
}