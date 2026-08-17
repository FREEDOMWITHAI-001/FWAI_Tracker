import { exec, sql } from './db';
import { checkVm, checkApp } from './checks';
import { syncCloudAccount } from './cloud-sync';
import { runAlerts } from './alerts';

// Server-side scheduler. Started from instrumentation.ts when the Next server
// boots, so checks run automatically even with no browser open. Stops when the
// server process stops.

const g = globalThis as unknown as { __fwaiScheduler?: boolean };
let checking = false;

// Check every VM (host:port or health_url) and every app (check_url or host:port).
async function runChecks() {
  if (checking) return; // skip if the previous cycle is still running
  checking = true;
  try {
    const vms = await sql(
      `select id, host, port, health_url, ssh_user, ssh_port, ssh_key_encrypted, ssh_pass_encrypted
         from vms
        where port is not null or health_url is not null or ssh_key_encrypted is not null`
    );
    await Promise.all(vms.map((v) => checkVm(v as any).catch(() => {})));

    const apps = await sql(
      `select id, check_url, check_host, check_port, vm_id
         from apps
        where check_url is not null or check_port is not null`
    );
    await Promise.all(apps.map((a) => checkApp(a as any).catch(() => {})));

    // after fresh statuses are written, evaluate alert conditions
    await runAlerts().catch((e) => console.error('[alerts] failed:', e?.message));

    // NO OPENAI WORK HERE. Each OpenAI check is a billable request, so it runs
    // four times a day from an external cron-job.org schedule hitting
    // GET /api/cron/openai — not on this 5-minute cycle. A self-hosted install
    // points the same external job at its own URL.
  } catch (e) {
    console.error('[scheduler] checks failed:', e instanceof Error ? e.message : e);
  } finally {
    checking = false;
  }
}

// Cloud syncs hit provider APIs, so they run much less often than checks.
async function runCloudSync() {
  try {
    const accts = await sql('select id, client_id, provider, credentials_encrypted from cloud_accounts');
    for (const a of accts) {
      try {
        await syncCloudAccount(a as any);
      } catch {
        /* error is recorded on the account row */
      }
    }
  } catch (e) {
    console.error('[scheduler] cloud sync failed:', e instanceof Error ? e.message : e);
  }
}

// Keep the history tables from growing forever.
async function runPrune() {
  try {
    const days = Number(process.env.METRICS_RETENTION_DAYS) || 7;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    await exec('delete from vm_metrics where checked_at < $1', [cutoff]);
    await exec('delete from app_metrics where checked_at < $1', [cutoff]);
  } catch {
    /* ignore */
  }
}

export function startScheduler() {
  if (g.__fwaiScheduler) return; // guard against dev hot-reload double-start
  if (process.env.SCHEDULER_DISABLED === '1') {
    console.log('[scheduler] disabled via SCHEDULER_DISABLED=1');
    return;
  }
  g.__fwaiScheduler = true;

  const checkMs = Number(process.env.CHECK_INTERVAL_MS) || 300_000; // 5 min default
  const cloudMs = Number(process.env.CLOUD_SYNC_INTERVAL_MS) || 300_000; // 5 min
  console.log(
    `[scheduler] started — checks every ${checkMs / 1000}s (VMs, apps, alerts), ` +
      `cloud sync every ${cloudMs / 1000}s`
  );

  setTimeout(runChecks, 3000); // first run shortly after boot
  setInterval(runChecks, checkMs);
  setInterval(runCloudSync, cloudMs);
  setInterval(runPrune, 3_600_000); // hourly cleanup
}