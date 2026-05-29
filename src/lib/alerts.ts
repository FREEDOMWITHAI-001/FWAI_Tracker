import type { SupabaseClient } from '@supabase/supabase-js';
import { getAisensyConfig, sendAisensy } from '@/lib/aisensy';

// Evaluate every VM/app and send WhatsApp alerts via AI Sensy when something
// has been DOWN longer than the configured threshold. Sends once per incident
// and (optionally) a recovery message when it comes back.
//
// Recipient = the target's own alert_phone, else its client's alert_phone.
// Template params sent (in order): [name, client, status, minutes]
//   status is "DOWN" or "BACK UP" — design your AI Sensy template with 4 vars.

type Row = {
  id: string;
  name: string;
  status: string;
  down_since: string | null;
  alerted: boolean;
  alert_name: string | null;
  alert_phone: string | null;
  clients: any;
};

export async function runAlerts(db: SupabaseClient) {
  const cfg = await getAisensyConfig(db);
  if (!cfg.enabled || !cfg.api_key_enc || !cfg.campaign) return; // not configured

  const thresholdMs = (cfg.threshold_min || 15) * 60_000;
  const now = Date.now();

  const sel = 'id,name,status,down_since,alerted,alert_name,alert_phone, clients(name,alert_name,alert_phone)';
  const [{ data: vms }, { data: apps }] = await Promise.all([
    db.from('vms').select(sel),
    db.from('apps').select(sel),
  ]);

  const handle = async (table: 'vms' | 'apps', rows: Row[] | null) => {
    for (const t of rows ?? []) {
      const client = Array.isArray(t.clients) ? t.clients[0] : t.clients || {};
      const phone = t.alert_phone || client?.alert_phone || '';
      const who = t.alert_name || client?.alert_name || undefined;
      const clientName = client?.name || '';

      if (t.status === 'down') {
        if (!t.down_since) {
          // first confirmed-down moment — start the clock
          await db.from(table).update({ down_since: new Date().toISOString() }).eq('id', t.id);
          continue;
        }
        if (t.alerted) continue;
        const downMs = now - new Date(t.down_since).getTime();
        if (downMs < thresholdMs) continue;
        if (!phone) continue; // no contact set — leave un-alerted so it fires once a number is added

        const minutes = Math.round(downMs / 60_000);
        try {
          await sendAisensy(cfg, { destination: phone, userName: who, templateParams: [t.name, clientName, 'DOWN', String(minutes)] });
          await db.from(table).update({ alerted: true }).eq('id', t.id);
        } catch (e) {
          console.error('[alerts] send failed:', e instanceof Error ? e.message : e);
        }
      } else if (t.status === 'warning') {
        // 'warning' is ambiguous — it's either a first failed probe (pending
        // confirmation as down) or a reachable-but-degraded service. Neither is
        // a clean recovery, so we DON'T reset a running down-timer here: that
        // lets a flapping outage keep accumulating toward the alert threshold,
        // and avoids sending a "BACK UP" while the target is still degraded.
        // (no-op; recovery only happens on a fully healthy check below)
      } else {
        // healthy == reachable and well -> recovery / reset
        if (t.alerted) {
          if (cfg.recovery && phone) {
            try {
              await sendAisensy(cfg, { destination: phone, userName: who, templateParams: [t.name, clientName, 'BACK UP', '0'] });
            } catch (e) {
              console.error('[alerts] recovery send failed:', e instanceof Error ? e.message : e);
            }
          }
          await db.from(table).update({ down_since: null, alerted: false }).eq('id', t.id);
        } else if (t.down_since) {
          await db.from(table).update({ down_since: null }).eq('id', t.id);
        }
      }
    }
  };

  await handle('vms', vms as Row[]);
  await handle('apps', apps as Row[]);
}