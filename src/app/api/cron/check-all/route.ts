import { sql } from '@/lib/db';
import { ok, guard, requireCronSecret } from '@/lib/api';
import { checkVm, checkApp } from '@/lib/checks';
import { runAlerts } from '@/lib/alerts';

export const runtime = 'nodejs';
export const maxDuration = 60; // up to 60s on Vercel — plenty for a fleet of a few VMs

// GET /api/cron/check-all
// The VM and app monitoring tick. Called every 5 minutes by
// .github/workflows/monitor-cron.yml — Vercel's Hobby plan allows only one cron
// run per day, so the cron entry in vercel.json is a daily backstop, not the
// trigger. Evaluates alerts, then probes every VM and app that has a check
// configured. Returns a summary, which the workflow prints, so a run is
// diagnosable from the Actions log alone.
//
// DOES NO OPENAI WORK, DELIBERATELY. The OpenAI credit check lives at
// /api/cron/openai and runs four times a day from cron-job.org, because each
// check is a real billable request and this route fires 288 times a day. The two
// were briefly merged and that is exactly what it cost. Do not add it back here:
// scripts/test-openai-check.mjs asserts this route sends nothing to OpenAI.
//
// Protected by the CRON_SECRET env var, via the shared guard in src/lib/api.ts.
// The workflow sends "Authorization: Bearer <CRON_SECRET>"; Vercel Cron attaches
// the same header automatically once the variable is set on the project.
export async function GET(req: Request) {
  return guard(async () => {
    const refused = requireCronSecret(req, 'cron');
    if (refused) return refused;
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
