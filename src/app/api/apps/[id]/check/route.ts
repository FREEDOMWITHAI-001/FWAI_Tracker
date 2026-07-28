import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { checkApp } from '@/lib/checks';

export const runtime = 'nodejs';
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/apps/[id]/check -> probe this application now (URL or host:port)
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const app = await maybeOne<{
      id: string;
      check_url: string | null;
      check_host: string | null;
      check_port: number | null;
      vm_id: string | null;
    }>('select id, check_url, check_host, check_port, vm_id from apps where id = $1', [id]);
    if (!app) return bad('App not found', 404);
    if (!app.check_url && !(app.check_host && app.check_port) && !(app.vm_id && app.check_port)) {
      return bad('This application needs a Check URL, host + port, or a host VM + port. Add one to run checks.');
    }
    const out = await checkApp(app);
    return ok(out);
  });
}
