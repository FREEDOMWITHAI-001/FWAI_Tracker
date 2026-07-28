import { sql, updateById } from '@/lib/db';
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
  client_name: string | null;
  client_alert_name: string | null;
  client_alert_phone: string | null;
};

// The client columns are joined in flat rather than nested, so there is no
// array-or-object ambiguity to unpick at the call site.
const rowsFor = (table: 'vms' | 'apps') => `
  select t.id, t.name, t.status, t.down_since, t.alerted, t.alert_name, t.alert_phone,
         c.name       as client_name,
         c.alert_name as client_alert_name,
         c.alert_phone as client_alert_phone
    from ${table} t
    left join clients c on c.id = t.client_id
`;

export async function runAlerts() {
  const cfg = await getAisensyConfig();
  if (!cfg.enabled || !cfg.api_key_enc || !cfg.campaign) return; // not configured

  const thresholdMs = (cfg.threshold_min || 15) * 60_000;
  const now = Date.now();

  const [vms, apps] = await Promise.all([sql<Row>(rowsFor('vms')), sql<Row>(rowsFor('apps'))]);

  const handle = async (table: 'vms' | 'apps', rows: Row[]) => {
    for (const t of rows) {
      const phone = t.alert_phone || t.client_alert_phone || '';
      const who = t.alert_name || t.client_alert_name || undefined;
      const clientName = t.client_name || '';

      if (t.status === 'down') {
        if (!t.down_since) {
          // first confirmed-down moment — start the clock
          await updateById(table, t.id, { down_since: new Date().toISOString() });
          continue;
        }
        if (t.alerted) continue;
        const downMs = now - new Date(t.down_since).getTime();
        if (downMs < thresholdMs) continue;
        if (!phone) continue; // no contact set — leave un-alerted so it fires once a number is added

        const minutes = Math.round(downMs / 60_000);
        try {
          await sendAisensy(cfg, { destination: phone, userName: who, templateParams: [t.name, clientName, 'DOWN', String(minutes)] });
          await updateById(table, t.id, { alerted: true });
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
          await updateById(table, t.id, { down_since: null, alerted: false });
        } else if (t.down_since) {
          await updateById(table, t.id, { down_since: null });
        }
      }
    }
  };

  await handle('vms', vms);
  await handle('apps', apps);
}
