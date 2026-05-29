import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { checkVm } from '@/lib/checks';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/vms/check-all -> probe every VM that has a host:port or a health_url,
// in parallel. Used by the manual "Check now" button, the page auto-poll, and is
// a convenient target for an external cron (see README).
export async function POST() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data: vms, error } = await db
      .from('vms')
      .select('id, host, port, health_url')
      .or('port.not.is.null,health_url.not.is.null');
    if (error) return bad(error.message, 500);
    const results = await Promise.all((vms ?? []).map((vm) => checkVm(db, vm)));
    const checked = results.filter((r) => !r.skipped).length;
    return ok({ checked, total: vms?.length ?? 0 });
  });
}

export const GET = POST; // allow cron/uptime pings via GET too