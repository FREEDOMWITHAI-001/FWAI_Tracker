import { exec, maybeOne, sql, updateById } from '@/lib/db';
import { getAisensyConfig, sendAisensy, type AisensyConfig } from '@/lib/aisensy';

// Evaluate every VM/app and send WhatsApp alerts via AI Sensy when something
// has been DOWN longer than the configured threshold. Sends once when the
// incident starts, then re-sends every REPEAT_ALERT_MS while it's still down,
// and (optionally) a recovery message when it comes back.
//
// Recipient = the target's own alert_phone, else its client's alert_phone.
// Template params sent (in order): [name, client, status, minutes]
//   status is "DOWN" or "BACK UP" — design your AI Sensy template with 4 vars.
//
// Every incident also lands in the `alerts` table (source_kind/source_id), so
// the Alerts page is the incident log rather than a separate hand-maintained
// list. One row covers one incident for its whole life: opened on the first
// alert, delivery state refreshed on each repeat, resolved on recovery.

/**
 * Re-alert once a day while an incident continues.
 *
 * Used by the VM/app downtime loop below. The OpenAI checker
 * (src/lib/openai-check.ts) deliberately does NOT repeat: an exhausted quota is
 * a state change, not an ongoing outage to nag about, so it alerts once per
 * episode and again only after a recovery.
 */
export const REPEAT_ALERT_MS = 24 * 60 * 60_000;

type Row = {
  id: string;
  client_id: string | null;
  name: string;
  status: string;
  down_since: string | null;
  alerted: boolean;
  last_alerted_at: string | null;
  alert_name: string | null;
  alert_phone: string | null;
  client_name: string | null;
  client_alert_name: string | null;
  client_alert_phone: string | null;
};

// The client columns are joined in flat rather than nested, so there is no
// array-or-object ambiguity to unpick at the call site.
const rowsFor = (table: 'vms' | 'apps') => `
  select t.id, t.client_id, t.name, t.status, t.down_since, t.alerted, t.last_alerted_at,
         t.alert_name, t.alert_phone,
         c.name       as client_name,
         c.alert_name as client_alert_name,
         c.alert_phone as client_alert_phone
    from ${table} t
    left join clients c on c.id = t.client_id
`;

/** What raised an alert. 'manual' rows are operator-raised and carry no source_id. */
export type SourceKind = 'vm' | 'app' | 'openai';
const kindOf = (table: 'vms' | 'apps'): SourceKind => (table === 'vms' ? 'vm' : 'app');

/** The minimum an incident needs to know about whatever it was raised for. */
export interface IncidentTarget {
  id: string;
  client_id: string | null;
}

/** The human-readable body of an incident, decided by whoever detected it. */
export interface IncidentContent {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
}

/** What happened on one delivery attempt. `error` is null only when sent. */
export interface Delivery {
  sent: boolean;
  error: string | null;
}

/**
 * WhatsApp is switched on and has everything it needs to send.
 *
 * `campaign` is the caller's template override — credit alerts send on their own
 * approved template (see AisensyConfig.credits_campaign) because that template's
 * 4th variable reads as "% remaining" rather than "minutes". It is resolved here
 * exactly as sendAisensy resolves it, so an install that configured only the
 * credits template is reported ready instead of being refused for a downtime
 * template it was never going to use.
 */
export function aisensyReady(cfg: AisensyConfig, campaign?: string): boolean {
  return !!(cfg.enabled && cfg.api_key_enc && (campaign?.trim() || cfg.campaign));
}

/**
 * Attempt one WhatsApp message, turning every failure into a recorded reason
 * instead of an exception.
 *
 * Nothing here throws: an alert whose message could not be delivered still has
 * to leave a row behind, because "we could not tell anyone" is exactly the state
 * an operator needs to see. The caller decides what to do with a failure — the
 * downtime loop deliberately leaves such a target un-alerted so the message goes
 * out on a later cycle once the number or the config is fixed.
 */
export async function sendWhatsApp(
  cfg: AisensyConfig,
  phone: string,
  who: string | undefined,
  templateParams: string[],
  campaign?: string
): Promise<Delivery> {
  if (!aisensyReady(cfg, campaign)) {
    return { sent: false, error: 'WhatsApp alerts are off or AI Sensy is not configured in Settings.' };
  }
  if (!phone) {
    return { sent: false, error: 'No alert phone set on this target or its client.' };
  }
  try {
    await sendAisensy(cfg, { destination: phone, userName: who, templateParams, campaign });
    return { sent: true, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'send failed';
    console.error('[alerts] send failed:', error);
    return { sent: false, error };
  }
}

/**
 * Open (or refresh) the alert row for one down target.
 *
 * The insert is a no-op when this incident is already logged — that's what
 * `alerts_one_active_per_source` is for — and the update then stamps the latest
 * delivery attempt onto whichever row is open. `whatsapp_sent` only ever ratchets
 * to true: once a message got through for this incident, a later repeat that
 * fails must not rewrite history, so the failure lands in whatsapp_error alone.
 */
export async function openIncident(
  kind: SourceKind,
  t: IncidentTarget,
  c: IncidentContent,
  d: Delivery
): Promise<void> {
  const sentAt = d.sent ? new Date().toISOString() : null;
  const { title, description } = c;

  await exec(
    `insert into alerts
       (client_id, severity, title, description, status, source_kind, source_id,
        whatsapp_sent, whatsapp_sent_at, whatsapp_error)
     values ($1, $9, $2, $3, 'active', $4, $5, $6, $7, $8)
     -- The predicate has to restate alerts_one_active_per_source's WHERE in full:
     -- Postgres only picks a partial index as the arbiter when that index's
     -- predicate is implied by the one given here, and "status = 'active'" alone
     -- does not imply "source_id is not null".
     on conflict (source_kind, source_id) where status = 'active' and source_id is not null
       do nothing`,
    [t.client_id, title, description, kind, t.id, d.sent, sentAt, d.error, c.severity]
  );

  // Ongoing incident: keep the open row's figures and delivery state current
  // instead of adding another row for the same incident. Severity is refreshed
  // too, so a warning that escalates to critical is visible on the same row.
  await exec(
    `update alerts
        set title            = $8,
            description      = $3,
            severity         = $7,
            whatsapp_sent    = whatsapp_sent or $4,
            whatsapp_sent_at = coalesce($5, whatsapp_sent_at),
            whatsapp_error   = $6
      where source_kind = $1 and source_id = $2 and status = 'active'`,
    [kind, t.id, description, d.sent, sentAt, d.error, c.severity, title]
  );
}

/**
 * Close the open alert for a target that has recovered. `d` is the recovery
 * message's outcome, or null when no recovery message was attempted — in which
 * case the existing delivery fields are left exactly as they were rather than
 * being blanked on the way out.
 */
/**
 * Close incidents whose target no longer exists.
 *
 * `source_id` is polymorphic across vms / apps / openai_accounts, so no foreign
 * key can cascade it. Without this sweep, deleting a monitored thing while it has
 * an open alert strands that alert as 'active' forever: the alerters only iterate
 * rows that still exist, so nothing ever resolves it, and it keeps counting
 * toward the sidebar badge.
 *
 * Resolved rather than deleted — the incident genuinely happened and its
 * WhatsApp delivery record is worth keeping. The reason is appended so a row that
 * closed without a recovery isn't mysterious; it only ever runs once per row,
 * because the same statement flips status away from 'active'.
 *
 * SPLIT INTO TWO STATEMENTS ON PURPOSE. Postgres resolves every relation in a
 * statement at PARSE time, so a single query that also mentions openai_accounts
 * fails outright — vms and apps included — on any database where that table has
 * not been created yet (code deployed ahead of `npm run migrate`). This function
 * is called from runAlerts() and from the DELETE handler of vms, apps, clients
 * and openai accounts, so that one missing table used to stop every downtime
 * WhatsApp alert and turn four delete endpoints into 500s. Core monitoring must
 * not depend on an optional feature's schema, so the vm/app sweep runs
 * unconditionally and the openai sweep is attempted only once the table is known
 * to exist. A guard inside the SQL (`case when to_regclass(...)`) would NOT work
 * — parse-time resolution happens before any predicate is evaluated.
 */
export async function closeOrphanedIncidents(): Promise<number> {
  let closed = await exec(
    `update alerts a
        set status      = 'resolved',
            resolved_at = now(),
            description = coalesce(nullif(a.description, ''), '') || ' · target removed'
      where a.status = 'active'
        and a.source_id is not null
        and (
             (a.source_kind = 'vm'  and not exists (select 1 from vms v  where v.id = a.source_id))
          or (a.source_kind = 'app' and not exists (select 1 from apps p where p.id = a.source_id))
        )`
  );

  const present = await maybeOne<{ reg: string | null }>(
    `select to_regclass('public.openai_accounts')::text as reg`
  );
  if (!present?.reg) return closed;

  closed += await exec(
    `update alerts a
        set status      = 'resolved',
            resolved_at = now(),
            description = coalesce(nullif(a.description, ''), '') || ' · target removed'
      where a.status = 'active'
        and a.source_id is not null
        and a.source_kind = 'openai'
        and not exists (select 1 from openai_accounts o where o.id = a.source_id)`
  );
  return closed;
}

/**
 * Severity of the open incident for a target, or null when none is open.
 *
 * Lets a caller tell "already told them about this" from "this just got worse",
 * using the alert row itself as the record of what was last communicated rather
 * than a second copy of that state on the target.
 */
export async function openIncidentSeverity(
  kind: SourceKind,
  id: string
): Promise<'critical' | 'warning' | 'info' | null> {
  const row = await maybeOne<{ severity: 'critical' | 'warning' | 'info' }>(
    `select severity from alerts
      where source_kind = $1 and source_id = $2 and status = 'active'
      limit 1`,
    [kind, id]
  );
  return row?.severity ?? null;
}

export async function resolveIncident(kind: SourceKind, id: string, d: Delivery | null): Promise<void> {
  if (!d) {
    await exec(
      `update alerts set status = 'resolved', resolved_at = now()
        where source_kind = $1 and source_id = $2 and status = 'active'`,
      [kind, id]
    );
    return;
  }
  await exec(
    `update alerts
        set status           = 'resolved',
            resolved_at      = now(),
            whatsapp_sent    = whatsapp_sent or $3,
            whatsapp_sent_at = coalesce($4, whatsapp_sent_at),
            whatsapp_error   = $5
      where source_kind = $1 and source_id = $2 and status = 'active'`,
    [kind, id, d.sent, d.sent ? new Date().toISOString() : null, d.error]
  );
}

export async function runAlerts() {
  // Note there is no early return when WhatsApp is unconfigured any more. The
  // incident log is not a WhatsApp feature: an outage still has to appear on the
  // Alerts page when nobody has set up messaging yet, with the reason no message
  // went out recorded on the row.
  const cfg = await getAisensyConfig();

  // Anything deleted since the last pass can no longer resolve itself.
  await closeOrphanedIncidents();

  const thresholdMs = (cfg.threshold_min || 15) * 60_000;
  const now = Date.now();

  const [vms, apps] = await Promise.all([sql<Row>(rowsFor('vms')), sql<Row>(rowsFor('apps'))]);

  const handle = async (table: 'vms' | 'apps', rows: Row[]) => {
    const kind = kindOf(table);
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
        const downMs = now - new Date(t.down_since).getTime();
        if (t.alerted) {
          if (!t.last_alerted_at) {
            // alerted=true from before this column existed (or any other gap
            // that left it unset) — start the repeat clock now rather than
            // treating "no timestamp" as "infinitely overdue", which would
            // fire an immediate repeat instead of waiting REPEAT_ALERT_MS.
            await updateById(table, t.id, { last_alerted_at: new Date().toISOString() });
            continue;
          }
          // Already alerted once — only re-alert after REPEAT_ALERT_MS of
          // continued downtime, so an ongoing incident isn't silent for days.
          const sinceLastMs = now - new Date(t.last_alerted_at).getTime();
          if (sinceLastMs < REPEAT_ALERT_MS) continue;
        } else if (downMs < thresholdMs) {
          continue;
        }

        const minutes = Math.round(downMs / 60_000);
        const d = await sendWhatsApp(cfg, phone, who, [t.name, clientName, 'DOWN', String(minutes)]);
        await openIncident(kind, t, {
          severity: 'critical',
          title: `${t.name} is down`,
          description:
            `${kind === 'vm' ? 'VM' : 'Application'} has not responded for ${minutes} min` +
            (t.client_name ? ` · ${t.client_name}` : ''),
        }, d);

        // `alerted` is only set once a message actually went out, so a target
        // with no contact number — or one whose send failed — is picked up again
        // next cycle instead of being marked done and going quiet.
        if (d.sent) {
          await updateById(table, t.id, { alerted: true, last_alerted_at: new Date().toISOString() });
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
          const d = cfg.recovery && phone ? await sendWhatsApp(cfg, phone, who, [t.name, clientName, 'BACK UP', '0']) : null;
          await resolveIncident(kind, t.id, d);
          await updateById(table, t.id, { down_since: null, alerted: false, last_alerted_at: null });
        } else if (t.down_since) {
          // Recovered before anyone could be messaged. There may still be an
          // open row from a failed delivery, so close that too — otherwise it
          // would sit on the Alerts page as active for a target that is fine.
          await resolveIncident(kind, t.id, null);
          await updateById(table, t.id, { down_since: null });
        }
      }
    }
  };

  await handle('vms', vms);
  await handle('apps', apps);
}

/**
 * Deliver an operator-raised alert over WhatsApp and stamp the outcome on its
 * row. The recipient is the alert's client contact — a manual alert has no VM or
 * app of its own to fall back to, so an alert with no client (or a client with no
 * number) records that as the reason rather than sending to nobody.
 *
 * Reuses the same 4-variable template as automated alerts, so no second AI Sensy
 * template needs approving: [title, client, SEVERITY, '0'] — the minutes slot is
 * '0' because a manually raised alert has no measured downtime.
 */
export async function sendManualAlert(alertId: string): Promise<Delivery> {
  const row = await maybeOne<{
    title: string;
    severity: string;
    client_name: string | null;
    client_alert_name: string | null;
    client_alert_phone: string | null;
  }>(
    `select a.title, a.severity,
            c.name        as client_name,
            c.alert_name  as client_alert_name,
            c.alert_phone as client_alert_phone
       from alerts a
       left join clients c on c.id = a.client_id
      where a.id = $1`,
    [alertId]
  );
  if (!row) return { sent: false, error: 'Alert not found.' };

  const cfg = await getAisensyConfig();
  const d = await sendWhatsApp(cfg, row.client_alert_phone || '', row.client_alert_name || undefined, [
    row.title,
    row.client_name || 'fleet',
    (row.severity || 'warning').toUpperCase(),
    '0',
  ]);

  await exec(
    `update alerts set whatsapp_sent = $2, whatsapp_sent_at = $3, whatsapp_error = $4 where id = $1`,
    [alertId, d.sent, d.sent ? new Date().toISOString() : null, d.error]
  );
  return d;
}
