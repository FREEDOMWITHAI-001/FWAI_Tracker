import { sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { checkVm, checkApp } from '@/lib/checks';
import { runAlerts } from '@/lib/alerts';

export const runtime = 'nodejs';
export const maxDuration = 60; // up to 60s on Vercel — plenty for a fleet of a few VMs

// GET /api/cron/check-all
// Called by Vercel Cron every 5 minutes (see vercel.json). Loops through every
// VM and app that has a check configured, runs the check, and fires any
// pending alerts. Returns a summary so the Vercel Cron log shows what it did.
//
// Protected by the CRON_SECRET env var. Vercel automatically attaches
// "Authorization: Bearer <CRON_SECRET>" to cron requests. Random callers
// without that secret get a 401 — so this endpoint can't be abused.
export async function GET(req: Request) {
  return guard(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) return bad('Unauthorized', 401);
    }
    const started = Date.now();

    // ---- alerts FIRST, deliberately ---------------------------------------
    // This used to run last, after every probe, and consequently never ran at
    // all: an unreachable VM's SSH probe costs ~30s plus a retry, so a single
    // down host exhausted maxDuration and the function was killed before it got
    // here. The dashboard still showed "down" (checkVm writes status inline)
    // while no WhatsApp was ever sent — down_since stayed NULL forever.
    //
    // Evaluating first means alerts act on the PREVIOUS cycle's statuses, which
    // are at most one cron interval stale, and can never be starved by a slow
    // probe. The two-pass safeguard (first sighting starts the clock, a later
    // pass sends) still holds, so this needs the cron to run every few minutes
    // — see README for the external-cron setup.
    let alertsOk = true;
    try {
      await runAlerts();
    } catch (e: any) {
      alertsOk = false;
      console.error('[cron] runAlerts failed', e?.message);
    }

    // VMs: anything with SSH, a port, or a Health URL set.
    // Probed in parallel — sequentially, a fleet of SSH hosts cannot fit inside
    // the function budget once even one of them is unreachable.
    const vms = await sql<any>(
      `select id, host, port, health_url, ssh_user, ssh_port, ssh_key_encrypted, ssh_pass_encrypted
         from vms
        where port is not null or health_url is not null or ssh_key_encrypted is not null`
    );
    const vmResults = await Promise.all(
      vms.map((v) =>
        checkVm(v).then(
          () => true,
          (e) => {
            console.error('[cron] checkVm failed', v.id, e?.message);
            return false;
          }
        )
      )
    );
    const vmsChecked = vmResults.filter(Boolean).length;

    // Apps: URL, host+port, or VM+port.
    const apps = await sql<any>('select id, check_url, check_host, check_port, vm_id from apps');
    const checkable = apps.filter(
      (a) => a.check_url || (a.check_host && a.check_port) || (a.vm_id && a.check_port)
    );
    const appResults = await Promise.all(
      checkable.map((a) =>
        checkApp(a).then(
          () => true,
          (e) => {
            console.error('[cron] checkApp failed', a.id, e?.message);
            return false;
          }
        )
      )
    );
    const appsChecked = appResults.filter(Boolean).length;

    return ok({
      alerts_evaluated: alertsOk,
      vms_checked: vmsChecked,
      vms_total: vms.length,
      apps_checked: appsChecked,
      ms: Date.now() - started,
    });
  });
}
