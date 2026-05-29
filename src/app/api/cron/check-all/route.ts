import { supabaseAdmin } from '@/lib/supabase';
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
    const db = supabaseAdmin();

    // VMs: anything with SSH, a port, or a Health URL set.
    const { data: vms } = await db
      .from('vms')
      .select('id,host,port,health_url,ssh_user,ssh_port,ssh_key_encrypted,ssh_pass_encrypted')
      .or('port.not.is.null,health_url.not.is.null,ssh_key_encrypted.not.is.null');
    let vmsChecked = 0;
    for (const v of vms ?? []) {
      try {
        await checkVm(db, v as any);
        vmsChecked++;
      } catch (e: any) {
        console.error('[cron] checkVm failed', v.id, e?.message);
      }
    }

    // Apps: URL, host+port, or VM+port.
    const { data: apps } = await db
      .from('apps')
      .select('id,check_url,check_host,check_port,vm_id');
    let appsChecked = 0;
    for (const a of apps ?? []) {
      if (!a.check_url && !(a.check_host && a.check_port) && !(a.vm_id && a.check_port)) continue;
      try {
        await checkApp(db, a as any);
        appsChecked++;
      } catch (e: any) {
        console.error('[cron] checkApp failed', a.id, e?.message);
      }
    }

    // Alerts: WhatsApp DOWN / RECOVERY based on what the checks above wrote.
    try {
      await runAlerts(db);
    } catch (e: any) {
      console.error('[cron] runAlerts failed', e?.message);
    }

    return ok({ vms_checked: vmsChecked, apps_checked: appsChecked, ms: Date.now() - started });
  });
}