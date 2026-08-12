// OpenAI project health / credit-availability check + WhatsApp alerting.
// Server-only.
//
// WHAT THIS ANSWERS, precisely: can this project API key currently make a
// billable OpenAI request, or does OpenAI report that its quota/credit is
// exhausted? That is the whole question.
//
// WHAT IT DOES NOT KNOW: the dollar balance. OpenAI exposes no API that returns
// remaining prepaid credit for a project key, so nothing here — no status, no
// message, no UI string — may imply that it does. The previous version of this
// file tried to synthesise one from a hand-entered allocation minus usage read
// through an organization admin key; see migration 21 for why that was removed.
//
// Nothing about WhatsApp is re-implemented. Delivery goes through
// src/lib/alerts.ts -> src/lib/aisensy.ts, incidents land in the same `alerts`
// table under source_kind 'openai', and a project with no recipients of its own
// falls back to its client's number exactly as the VM alerter does.
//
// WHEN IT RUNS: once a day, at 09:00 Asia/Kolkata, driven by the single cron
// entry in vercel.json. See `dailyDueSince` and `claimDueAccounts` below for the
// two safeguards that make a duplicated or late trigger harmless — neither of
// them ever CAUSES a check.

import { exec, maybeOne, sql, updateById } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getAisensyConfig } from '@/lib/aisensy';
import { closeOrphanedIncidents, openIncident, resolveIncident, sendWhatsApp } from '@/lib/alerts';

// Overridable so the app can be pointed at an OpenAI-compatible gateway or
// proxy, and so the classification below can be exercised against a stub
// without live credentials (scripts/test-openai-check.mjs does exactly that).
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

/**
 * The model the probe requests.
 *
 * NOT assumed to be universally available: a project API key can be scoped to a
 * subset of models, so any given project may legitimately have no access to the
 * default. That is a configuration problem, not a credit problem — see
 * `classify`, which maps it to CHECK_FAILED with a message naming this variable.
 * The default is the cheapest broadly-enabled chat model; one probe bills for
 * roughly two tokens.
 */
const CHECK_MODEL = process.env.OPENAI_CHECK_MODEL || 'gpt-4o-mini';

/** A probe that hangs must not eat the cron's budget — see the ordering
 *  comments in src/app/api/cron/check-all/route.ts for what that cost before. */
const TIMEOUT_MS = Number(process.env.OPENAI_CHECK_TIMEOUT_MS) || 10_000;

export type OpenAiCheckStatus = 'CREDIT_AVAILABLE' | 'NO_CREDIT' | 'INVALID_KEY' | 'CHECK_FAILED';

export const CHECK_STATUS_LABEL: Record<OpenAiCheckStatus, string> = {
  CREDIT_AVAILABLE: 'Credit available',
  NO_CREDIT: 'No credit / quota',
  INVALID_KEY: 'Invalid API key',
  CHECK_FAILED: 'Check failed',
};

export interface CheckResult {
  status: OpenAiCheckStatus;
  /** Why it is not CREDIT_AVAILABLE; null when it is. */
  error: string | null;
}

export interface OpenAiAccountRow {
  id: string;
  client_id: string;
  name: string;
  credentials_encrypted: string | null;
  status: string;
  alerted: boolean;
  daily_check_enabled: boolean;
  last_checked_at: string | null;
  last_alerted_at: string | null;
  alert_name: string | null;
  client_name?: string | null;
  client_alert_name?: string | null;
  client_alert_phone?: string | null;
}

// --- daily schedule --------------------------------------------------------

/**
 * Asia/Kolkata is UTC+05:30 and India has never observed daylight saving, so a
 * fixed offset is exact all year and no timezone library is needed. 09:00 IST
 * is therefore always 03:30 UTC — which is the cron expression in vercel.json.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60_000;
export const DAILY_CHECK_HOUR_IST = 9;

/** How long one invocation's claim on a project is respected. */
export const CLAIM_LEASE_MS = 10 * 60_000;

/**
 * The most recent 09:00 Asia/Kolkata that has already passed.
 *
 * A project is due when it has not been checked since that instant. This is a
 * guard, not a schedule: the cron fires once a day and does the work, and this
 * is what stops a retried or hand-fired trigger from doing it a second time.
 */
export function dailyDueSince(now: number = Date.now()): Date {
  const ist = now + IST_OFFSET_MS;
  const d = new Date(ist);
  const boundary = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAILY_CHECK_HOUR_IST);
  // Before 09:00 IST today, the live boundary is yesterday's.
  const due = boundary <= ist ? boundary : boundary - 86_400_000;
  return new Date(due - IST_OFFSET_MS);
}

/** Milliseconds until the next 09:00 IST — used to align the self-hosted timer. */
export function msUntilNextDailyCheck(now: number = Date.now()): number {
  return dailyDueSince(now).getTime() + 86_400_000 - now;
}

/**
 * Turn one OpenAI HTTP response into a status.
 *
 * DRIVEN BY error.code / error.type, NEVER by the HTTP status alone. 429 is the
 * case that matters: OpenAI uses it both for "you are out of credit"
 * (insufficient_quota) and for "you are going too fast" (rate_limit_exceeded).
 * Treating every 429 as NO_CREDIT would tell a client to recharge an account
 * that is merely busy.
 *
 * `insufficient_quota` is matched on the code/type field ONLY — there is
 * deliberately no message-substring fallback for it. A rate-limit body can and
 * does mention the word "quota", and being wrong in that direction sends a false
 * "your credit is exhausted" WhatsApp.
 *
 * Anything unrecognised falls through to CHECK_FAILED carrying the raw reason.
 * That is the safe default in both directions: it messages nobody, and it shows
 * the operator exactly what OpenAI said instead of guessing.
 *
 * Exported for the test — this is the one piece of real logic in the file.
 */
export function classify(httpStatus: number, body: unknown): CheckResult {
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'CREDIT_AVAILABLE', error: null };

  const err = (body as { error?: { code?: unknown; type?: unknown; message?: unknown } })?.error;
  const code = typeof err?.code === 'string' ? err.code : '';
  const type = typeof err?.type === 'string' ? err.type : '';
  const message = typeof err?.message === 'string' ? err.message : '';
  const detail = message || `HTTP ${httpStatus}`;

  // Out of credit. The only path to NO_CREDIT.
  if (code === 'insufficient_quota' || type === 'insufficient_quota') {
    return { status: 'NO_CREDIT', error: detail };
  }

  // Key revoked, deleted, or never valid.
  if (httpStatus === 401 || code === 'invalid_api_key') {
    return { status: 'INVALID_KEY', error: detail };
  }

  // The configured model is not one this key may use. A configuration problem
  // that says nothing about credit, so it must not alert anyone — but the
  // account IS unmonitored until it is fixed, so the message says what to do.
  if (httpStatus === 404 || code === 'model_not_found' || code === 'model_not_supported') {
    return {
      status: 'CHECK_FAILED',
      error: `The check model "${CHECK_MODEL}" is not available to this project — set OPENAI_CHECK_MODEL to one this key can use. (${detail})`,
    };
  }

  // 403 covers both a model/endpoint permission denial and unsupported-region.
  // Neither is a credit signal.
  if (httpStatus === 403) {
    return { status: 'CHECK_FAILED', error: `Request not permitted for this key: ${detail}` };
  }

  // Rate limited — temporary, and explicitly NOT NO_CREDIT.
  if (httpStatus === 429) {
    return { status: 'CHECK_FAILED', error: `Rate limited by OpenAI (not a credit problem): ${detail}` };
  }

  return { status: 'CHECK_FAILED', error: detail };
}

/**
 * Make the smallest billable request that can distinguish the four states.
 *
 * A cheaper-looking option was considered and rejected: GET /v1/models
 * validates the key but consumes no quota, so it answers 200 on a project whose
 * credit is exhausted. It cannot detect NO_CREDIT at all, which is the one thing
 * this feature exists to detect.
 *
 * The key is a parameter and never logged; callers decrypt it immediately before
 * this call and let it go out of scope immediately after.
 */
export async function probeKey(apiKey: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CHECK_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body (a proxy's HTML error page, say) is still a real
      // outcome; classify falls back to the HTTP status.
    }
    return classify(res.status, json);
  } catch (e) {
    // Timeout, DNS failure, connection refused, TLS error.
    const reason = e instanceof Error ? (e.name === 'TimeoutError' ? `No response within ${TIMEOUT_MS / 1000}s` : e.message) : 'request failed';
    return { status: 'CHECK_FAILED', error: reason };
  }
}

// Columns the checker needs. Listed explicitly so the ciphertext is only ever
// pulled where it is about to be decrypted.
const ACCOUNT_COLS = `a.id, a.client_id, a.name, a.credentials_encrypted, a.status, a.alerted,
         a.daily_check_enabled, a.last_checked_at, a.last_alerted_at, a.alert_name`;

const SELECT_WITH_CLIENT = `
  select ${ACCOUNT_COLS},
         c.name        as client_name,
         c.alert_name  as client_alert_name,
         c.alert_phone as client_alert_phone
    from openai_accounts a
    left join clients c on c.id = a.client_id
`;

export async function loadAccountForCheck(id: string): Promise<OpenAiAccountRow | null> {
  return maybeOne<OpenAiAccountRow>(`${SELECT_WITH_CLIENT} where a.id = $1`, [id]);
}

// --- recipients ------------------------------------------------------------

/**
 * One WhatsApp destination for a project. `id` is the openai_account_contacts
 * row, or null for the client-level fallback, which has no row of its own and
 * is latched on the account instead.
 */
interface Recipient {
  id: string | null;
  phone: string;
  alerted_at: string | null;
}

/**
 * Everyone who should hear about this project, and whether they already have.
 *
 * A project's own contacts win outright. Only when it has none at all does the
 * client's number stand in — preserving the behaviour projects had before they
 * could hold a list of their own.
 */
async function recipientsFor(acct: OpenAiAccountRow): Promise<Recipient[]> {
  const own = await sql<Recipient>(
    `select id, phone, alerted_at
       from openai_account_contacts
      where openai_account_id = $1
      order by created_at asc`,
    [acct.id]
  );
  if (own.length) return own;
  if (acct.client_alert_phone) {
    // The fallback's "already told" state is the account latch, since there is
    // no contact row to stamp.
    return [{ id: null, phone: acct.client_alert_phone, alerted_at: acct.alerted ? acct.last_alerted_at : null }];
  }
  return [];
}

/** Clear every recipient's episode latch, so a relapse messages them all again. */
async function clearRecipientLatches(accountId: string): Promise<void> {
  await exec(
    `update openai_account_contacts set alerted_at = null, updated_at = now()
      where openai_account_id = $1 and alerted_at is not null`,
    [accountId]
  );
}

/**
 * Alert every recipient when a project ENTERS the no-credit state, and close the
 * incident when it leaves.
 *
 * ONE MESSAGE PER RECIPIENT PER EPISODE. The latch is per-recipient
 * (openai_account_contacts.alerted_at), not per-project, because with several
 * numbers a single project-level flag cannot express it: if two of three sends
 * succeed, setting the flag abandons the third forever and clearing it
 * re-messages the two who already know, every single check. Sending only to
 * contacts whose latch is still NULL gives exactly the required behaviour —
 * everyone hears once, a failed delivery is retried on the next check, and
 * nobody is told twice. Recovery clears every latch, so a relapse messages the
 * whole list again.
 *
 * INVALID_KEY and CHECK_FAILED deliberately message nobody. Neither means the
 * client is out of credit, and a checker that cries wolf about its own
 * misconfiguration trains people to ignore it. Both are shown on the page.
 */
async function handleAlert(acct: OpenAiAccountRow, result: CheckResult): Promise<void> {
  if (result.status === 'NO_CREDIT') {
    const clientName = acct.client_name || '';
    const description =
      'OpenAI reports insufficient quota/credit for this project, so it cannot make API requests' +
      (clientName ? ` · ${clientName}` : '');
    const content = {
      severity: 'critical' as const,
      title: `${acct.name} — OpenAI requests blocked`,
      description,
    };
    const target = { id: acct.id, client_id: acct.client_id };

    const recipients = await recipientsFor(acct);

    // Nobody to tell. Still log the incident — "we could not reach anyone" is
    // exactly the state an operator has to be able to see. openIncident is
    // insert-or-refresh, so repeating this on later checks adds no rows.
    if (!recipients.length) {
      await openIncident('openai', target, content, {
        sent: false,
        error: 'No WhatsApp recipient configured for this project or its client.',
      });
      return;
    }

    const pending = recipients.filter((r) => !r.alerted_at);
    if (!pending.length) return; // everyone has already been told about this episode

    const cfg = await getAisensyConfig();
    // Credit alerts prefer their own approved template; blank falls back to the
    // downtime one inside sendAisensy.
    const campaign = cfg.credits_campaign?.trim() || undefined;
    const who = acct.alert_name || acct.client_alert_name || undefined;

    // Sequential, not parallel: the lists are short and AI Sensy is a rate-limited
    // third party, so a burst buys nothing and risks 429s that would look like
    // delivery failures.
    const delivered: string[] = []; // contact-row ids to stamp
    const failures: string[] = [];
    let sentCount = 0;
    for (const r of pending) {
      // Same 4-variable contract as every other alert in the app, so no new AI
      // Sensy template needs approving: [name, client, status, detail].
      const d = await sendWhatsApp(
        cfg,
        r.phone,
        who,
        [acct.name, clientName, 'NO CREDIT', 'OpenAI reports quota/credit exhausted'],
        campaign
      );
      if (d.sent) {
        sentCount++;
        // The client fallback has no row to stamp; the account latch below is
        // what stops it being messaged again.
        if (r.id) delivered.push(r.id);
      } else {
        failures.push(`${r.phone}: ${d.error ?? 'send failed'}`);
      }
    }

    // Stamp only the recipients actually reached. Anyone missing stays NULL and
    // is retried next check, without re-messaging the ones who got through.
    if (delivered.length) {
      await exec(
        `update openai_account_contacts set alerted_at = now(), updated_at = now() where id = any($1::uuid[])`,
        [delivered]
      );
    }

    await openIncident('openai', target, content, {
      sent: sentCount > 0,
      // Partial failure is recorded in full rather than collapsed into "sent",
      // so the Alerts page shows which numbers were not reached.
      error: failures.length ? failures.join('; ') : null,
    });

    // The account latch means "at least one person knows". It drives the UI and
    // the fallback recipient; the per-contact latches are what actually decide
    // who gets messaged next time.
    if (sentCount > 0) {
      await updateById('openai_accounts', acct.id, {
        alerted: true,
        last_alerted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Not NO_CREDIT. Only a recovery to CREDIT_AVAILABLE closes the incident:
  // INVALID_KEY and CHECK_FAILED mean we could not determine the credit state,
  // and resolving an open "no credit" alert on the strength of a failed check
  // would quietly tell the operator the problem went away.
  if (result.status !== 'CREDIT_AVAILABLE') return;

  // Recovered. Close the incident and clear the latch so a later relapse alerts
  // again — but send NOTHING.
  //
  // NO RECOVERY MESSAGE, DELIBERATELY. This is the one place the OpenAI checker
  // diverges from how the rest of the app alerts: runAlerts() in
  // src/lib/alerts.ts sends a "BACK UP" for a recovered VM or app when
  // Settings → recovery is on, and that behaviour is unchanged for those
  // sources. Credit is different — the only OpenAI message anyone wants is the
  // one that asks them to recharge, and a "you're fine now" follow-up on a
  // client's WhatsApp is noise they did not ask for. Nothing here reads
  // cfg.recovery, so flipping that setting cannot reintroduce the message.
  //
  // Resolving is unconditional rather than guarded on acct.alerted: an incident
  // row can be open with the latch false — from a send that failed, or from a
  // key replacement, which resets `alerted` while leaving the old episode's row
  // active. Resolving is a no-op UPDATE when nothing is open, and it is the only
  // thing that cannot strand one.
  await resolveIncident('openai', acct.id, null);

  // Every recipient's latch is cleared too, so if this project runs out again
  // tomorrow the whole list is messaged afresh rather than staying silent
  // because they were told about the previous episode.
  await clearRecipientLatches(acct.id);

  if (acct.alerted) {
    await updateById('openai_accounts', acct.id, { alerted: false, last_alerted_at: null });
  }
}

/**
 * Check one account: decrypt its key, probe, store the outcome, then alert on a
 * transition into or out of NO_CREDIT.
 *
 * FORCED. It does not consult daily_check_enabled, the due-gate or the claim —
 * that flag governs the SCHEDULED run only, so "Check now" keeps working on a
 * project whose daily checking is switched off. Callers that represent the
 * scheduler go through runDailyOpenAiChecks() instead.
 *
 * The decrypted key exists only inside this function and is never returned,
 * stored or logged. Failures are identified by account name only.
 */
export async function checkOpenAiAccount(acct: OpenAiAccountRow): Promise<CheckResult & { id: string }> {
  let result: CheckResult;

  if (!acct.credentials_encrypted) {
    result = { status: 'CHECK_FAILED', error: 'No API key stored for this project.' };
  } else {
    try {
      result = await probeKey(decrypt(acct.credentials_encrypted));
    } catch (e) {
      // Decryption failed — almost always APP_ENCRYPTION_KEY changed since the
      // key was saved, which no amount of retrying will fix.
      result = {
        status: 'CHECK_FAILED',
        error: `Stored key could not be decrypted (${e instanceof Error ? e.message : 'unknown error'}). Re-enter it on this account.`,
      };
    }
  }

  if (result.error) console.error('[openai] check:', acct.name, '-', result.status, '-', result.error);

  await updateById('openai_accounts', acct.id, {
    status: result.status,
    last_checked_at: new Date().toISOString(),
    last_check_error: result.error,
    updated_at: new Date().toISOString(),
  });

  // Reads acct.alerted / acct.status as they were BEFORE this write, which is
  // exactly the previous-state the transition rule needs.
  await handleAlert(acct, result);

  return { id: acct.id, ...result };
}

/** Run a set of accounts. Never rejects — one bad key must not stop the rest. */
function checkEach(accounts: OpenAiAccountRow[]): Promise<Array<CheckResult & { id: string }>> {
  return Promise.all(
    accounts.map((a) =>
      checkOpenAiAccount(a).catch((e) => ({
        id: a.id,
        status: 'CHECK_FAILED' as const,
        error: e instanceof Error ? e.message : 'check failed',
      }))
    )
  );
}

/**
 * Atomically take ownership of every project that is enabled and due.
 *
 * ONE STATEMENT SELECTS AND CLAIMS, which is the whole point. Reading the due
 * rows and then probing them would be a check-then-act with seconds of daylight
 * in between, and a cron that fires twice — a retry, a hand-run
 * workflow_dispatch, two hosts — would have both invocations see the same
 * project as due, both spend a billable request, and both send the same
 * WhatsApp.
 *
 * Why the race cannot happen here: under READ COMMITTED, a second UPDATE
 * reaching a row this one has locked blocks until this one commits, then
 * RE-EVALUATES its WHERE against the updated row. By then check_claimed_at is
 * now(), so the `check_claimed_at < lease cutoff` test fails, the row is not in
 * the second statement's result, and the second caller never sees it. Exactly
 * one invocation gets each project.
 *
 * Each statement is its own autocommit transaction, so nothing is held open
 * across the OpenAI HTTP call — which matters with PGPOOL_MAX=3. The lease makes
 * it crash-safe: a run killed mid-flight (the 60s maxDuration cut-off this route
 * has a history of) releases its projects after CLAIM_LEASE_MS instead of
 * leaving them unchecked until tomorrow.
 *
 * `client_id` is NOT NULL with a foreign key, so joining clients cannot drop a
 * row from the claim.
 */
async function claimDueAccounts(dueSince: Date): Promise<OpenAiAccountRow[]> {
  return sql<OpenAiAccountRow>(
    `update openai_accounts a
        set check_claimed_at = now()
       from clients c
      where c.id = a.client_id
        and a.daily_check_enabled
        and (a.last_checked_at  is null or a.last_checked_at  < $1)
        and (a.check_claimed_at is null or a.check_claimed_at < $2)
    returning ${ACCOUNT_COLS},
              c.name        as client_name,
              c.alert_name  as client_alert_name,
              c.alert_phone as client_alert_phone`,
    [dueSince.toISOString(), new Date(Date.now() - CLAIM_LEASE_MS).toISOString()]
  );
}

/**
 * THE scheduled entry point — one run a day, from the single cron entry in
 * vercel.json (03:30 UTC = 09:00 Asia/Kolkata).
 *
 * Projects with daily_check_enabled = false are excluded in SQL, so a disabled
 * project is never sent to OpenAI and can never produce a scheduled alert.
 * A project that has never been checked counts as due, so a key added during the
 * day is verified promptly rather than sitting unverified until morning.
 */
export async function runDailyOpenAiChecks(): Promise<{
  checked: number;
  claimed: number;
  due_since: string;
}> {
  // A deleted account cannot close its own incident — the claim below only
  // returns rows that still exist.
  await closeOrphanedIncidents();
  const dueSince = dailyDueSince();
  const claimed = await claimDueAccounts(dueSince);
  const outcomes = await checkEach(claimed);
  return { checked: outcomes.length, claimed: claimed.length, due_since: dueSince.toISOString() };
}

/**
 * Manual "check everything now" from the UI. Forced: it ignores the daily
 * schedule, the due-gate and the claim, because an operator pressing a button is
 * not the scheduler. daily_check_enabled is ignored too — see checkOpenAiAccount.
 */
export async function runManualOpenAiChecks(): Promise<{ checked: number }> {
  await closeOrphanedIncidents();
  const all = await sql<OpenAiAccountRow>(`${SELECT_WITH_CLIENT} order by a.created_at asc`);
  const outcomes = await checkEach(all);
  return { checked: outcomes.length };
}
