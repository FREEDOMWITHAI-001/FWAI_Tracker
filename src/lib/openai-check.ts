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
// table under source_kind 'openai', and the recipient resolves account phone ->
// client phone exactly as the VM alerter resolves it.

import { maybeOne, sql, updateById } from '@/lib/db';
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
  last_checked_at: string | null;
  last_alerted_at: string | null;
  alert_name: string | null;
  alert_phone: string | null;
  client_name?: string | null;
  client_alert_name?: string | null;
  client_alert_phone?: string | null;
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

const SELECT_WITH_CLIENT = `
  select a.id, a.client_id, a.name, a.credentials_encrypted, a.status, a.alerted,
         a.last_checked_at, a.last_alerted_at, a.alert_name, a.alert_phone,
         c.name        as client_name,
         c.alert_name  as client_alert_name,
         c.alert_phone as client_alert_phone
    from openai_accounts a
    left join clients c on c.id = a.client_id
`;

export async function loadAccountForCheck(id: string): Promise<OpenAiAccountRow | null> {
  return maybeOne<OpenAiAccountRow>(`${SELECT_WITH_CLIENT} where a.id = $1`, [id]);
}

/**
 * Alert the contact when an account ENTERS the no-credit state, and close the
 * incident when it leaves.
 *
 * Duplicate protection is a pure edge transition, which is why this is a few
 * lines rather than the scheduled scan the credit tracker needed: `alerted` is
 * the record of "a message has already gone out for this episode". It is set
 * ONLY when a send actually succeeded, so an account with no phone number — or
 * one whose delivery failed — is picked up again on the next check instead of
 * being marked done and going quiet. Leaving NO_CREDIT clears it, so a later
 * relapse alerts again.
 *
 * INVALID_KEY and CHECK_FAILED deliberately message nobody. Neither means the
 * client is out of credit, and a checker that cries wolf about its own
 * misconfiguration trains people to ignore it. Both are shown on the page.
 */
async function handleAlert(acct: OpenAiAccountRow, result: CheckResult): Promise<void> {
  if (result.status === 'NO_CREDIT') {
    if (acct.alerted) return; // already told them about this episode

    const cfg = await getAisensyConfig();
    // Credit alerts prefer their own approved template; blank falls back to the
    // downtime one inside sendAisensy.
    const campaign = cfg.credits_campaign?.trim() || undefined;
    const phone = acct.alert_phone || acct.client_alert_phone || '';
    const who = acct.alert_name || acct.client_alert_name || undefined;
    const clientName = acct.client_name || '';

    // Same 4-variable contract as every other alert in the app, so no new AI
    // Sensy template needs approving: [name, client, status, detail].
    const d = await sendWhatsApp(
      cfg,
      phone,
      who,
      [acct.name, clientName, 'NO CREDIT', 'OpenAI reports quota/credit exhausted'],
      campaign
    );

    await openIncident(
      'openai',
      { id: acct.id, client_id: acct.client_id },
      {
        severity: 'critical',
        title: `${acct.name} — OpenAI requests blocked`,
        description:
          'OpenAI reports insufficient quota/credit for this project, so it cannot make API requests' +
          (clientName ? ` · ${clientName}` : ''),
      },
      d
    );

    if (d.sent) {
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

  if (acct.alerted) {
    await updateById('openai_accounts', acct.id, { alerted: false, last_alerted_at: null });
  }
}

/**
 * Check one account: decrypt its key, probe, store the outcome, then alert on a
 * transition into or out of NO_CREDIT.
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

/**
 * Check every account. Never rejects — one bad key must not stop the rest.
 *
 * `staleMs` skips accounts checked more recently than that, so the 5-minute cron
 * can call this without probing every key every five minutes. Omit it to force a
 * refresh, which is what the UI's "Check now" does.
 */
export async function checkAllOpenAiAccounts(staleMs?: number): Promise<Array<CheckResult & { id: string }>> {
  const all = await sql<OpenAiAccountRow>(`${SELECT_WITH_CLIENT} order by a.created_at asc`);
  const due =
    staleMs == null
      ? all
      : all.filter((a) => !a.last_checked_at || Date.now() - new Date(a.last_checked_at).getTime() >= staleMs);

  return Promise.all(
    due.map((a) =>
      checkOpenAiAccount(a).catch((e) => ({
        id: a.id,
        status: 'CHECK_FAILED' as const,
        error: e instanceof Error ? e.message : 'check failed',
      }))
    )
  );
}

/** Sweep incidents whose account was deleted, then check everything due. */
export async function syncOpenAiChecks(staleMs?: number): Promise<{ checked: number }> {
  // A deleted account cannot close its own incident — checkAllOpenAiAccounts
  // only iterates rows that still exist.
  await closeOrphanedIncidents();
  const outcomes = await checkAllOpenAiAccounts(staleMs);
  return { checked: outcomes.length };
}
