import { timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { checkVm, checkApp } from '@/lib/checks';
import { runAlerts } from '@/lib/alerts';
import { runOpenAiChecks } from '@/lib/openai-check';

export const runtime = 'nodejs';
export const maxDuration = 60; // up to 60s on Vercel — plenty for a fleet of a few VMs

/**
 * Constant-time string comparison, so a caller cannot recover the secret by
 * measuring how long a wrong guess takes to be rejected. Length is compared
 * first because timingSafeEqual throws on a length mismatch; that leaks only the
 * length, which is not the secret.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// GET /api/cron/check-all
// The monitoring tick. Called every 5 minutes by
// .github/workflows/monitor-cron.yml — Vercel's Hobby plan allows only one cron
// run per day, so the cron entry in vercel.json is a daily backstop, not the
// trigger. Evaluates alerts, checks every OpenAI project that is due, then
// probes every VM and app that has a check configured. Returns a summary, which
// the workflow prints, so a run is diagnosable from the Actions log alone.
//
// Protected by the CRON_SECRET env var. The workflow sends
// "Authorization: Bearer <CRON_SECRET>"; Vercel Cron attaches the same header
// automatically once the variable is set on the project.
//
// FAILS CLOSED in production. This previously read `if (secret) { ...check... }`,
// so forgetting to set CRON_SECRET did not merely weaken the endpoint — it
// removed the check entirely and left a route that probes the whole fleet, sends
// WhatsApp messages and spends OpenAI API quota open to anonymous callers, while
// the comment above it claimed it "can't be abused". An unset secret is now a
// 503 in production rather than an open door. Development is exempt so `npm run
// dev` and local curl testing keep working without ceremony.
export async function GET(req: Request) {
  return guard(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[cron] refused: CRON_SECRET is not set in this environment');
        return bad('This endpoint requires CRON_SECRET to be configured on the server.', 503);
      }
      console.warn('[cron] CRON_SECRET is not set — running unauthenticated (development only)');
    } else {
      const auth = req.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token || !secretMatches(token, secret)) return bad('Unauthorized', 401);
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

    // ---- OpenAI checks, also BEFORE the probes ------------------------------
    // Same starvation reason as runAlerts above: this used to run last, after
    // every probe, so a single unreachable SSH host (30s + retry) exhausted
    // maxDuration and the function was killed before any no-credit WhatsApp
    // could be sent — silently, because a killed function reports no error.
    //
    // RUNS ON EVERY TICK, i.e. every 5 minutes, so a project that runs out of
    // credit is noticed within minutes rather than at some point the next day.
    //
    // This used to be gated behind "is the caller Vercel Cron?" (a ?openai=daily
    // flag plus the x-vercel-cron-schedule header and vercel-cron user agent),
    // so that only the once-a-day cron in vercel.json triggered it. That gate is
    // gone, and with it the reason the 09:00 check silently never ran: Hobby
    // cron precision is ±59 minutes, so the trigger regularly landed before the
    // 09:00 IST boundary its own due-gate was measured against, claimed nothing,
    // and reported success.
    //
    // TICKING THIS OFTEN DOES NOT MEAN PROBING OPENAI THIS OFTEN. runOpenAiChecks
    // claims each project for MIN_CHECK_INTERVAL_MS in the same UPDATE that
    // selects it, so the probe rate is bounded in SQL no matter who calls here
    // or how often. And the WhatsApp rate is bounded separately again, by the
    // per-recipient latch in handleAlert. See src/lib/openai-check.ts.
    let openaiChecked = 0;
    let openaiClaimed = 0;
    let openaiOk = true;
    try {
      const r = await runOpenAiChecks();
      openaiChecked = r.checked;
      openaiClaimed = r.claimed;
    } catch (e: any) {
      openaiOk = false;
      console.error('[cron] openai check failed', e?.message);
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
      // `openai_checked: 0` is the normal state for a tick that arrives inside
      // MIN_CHECK_INTERVAL_MS of the last one — it means nothing was due, not
      // that anything failed. `openai_ok` is the field that reports failure.
      openai_checked: openaiChecked,
      openai_claimed: openaiClaimed,
      openai_ok: openaiOk,
      ms: Date.now() - started,
    });
  });
}
