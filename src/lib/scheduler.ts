import { supabaseAdmin } from './supabase';
import { checkVm, checkApp } from './checks';
import { syncCloudAccount } from './cloud-sync';

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
    const db = supabaseAdmin();
    const { data: vms } = await db
      .from('vms')
      .select('id,host,port,health_url')
      .or('port.not.is.null,health_url.not.is.null');
    await Promise.all((vms ?? []).map((v) => checkVm(db, v as any).catch(() => {})));

    const { data: apps } = await db
      .from('apps')
      .select('id,check_url,check_host,check_port')
      .or('check_url.not.is.null,check_port.not.is.null');
    await Promise.all((apps ?? []).map((a) => checkApp(db, a as any).catch(() => {})));
  } catch (e) {
    console.error('[scheduler] checks failed:', e instanceof Error ? e.message : e);
  } finally {
    checking = false;
  }
}

// Cloud syncs hit provider APIs, so they run much less often than checks.
async function runCloudSync() {
  try {
    const db = supabaseAdmin();
    const { data: accts } = await db
      .from('cloud_accounts')
      .select('id,client_id,provider,credentials_encrypted');
    for (const a of accts ?? []) {
      try {
        await syncCloudAccount(db, a as any);
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
    const db = supabaseAdmin();
    await db.from('vm_metrics').delete().lt('checked_at', cutoff);
    await db.from('app_metrics').delete().lt('checked_at', cutoff);
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

  const checkMs = Number(process.env.CHECK_INTERVAL_MS) || 300_000; // 5 min
  const cloudMs = Number(process.env.CLOUD_SYNC_INTERVAL_MS) || 300_000; // 5 min
  console.log(`[scheduler] started — checks every ${checkMs / 1000}s, cloud sync every ${cloudMs / 1000}s`);

  setTimeout(runChecks, 3000); // first run shortly after boot
  setInterval(runChecks, checkMs);
  setInterval(runCloudSync, cloudMs);
  setInterval(runPrune, 3_600_000); // hourly cleanup
}