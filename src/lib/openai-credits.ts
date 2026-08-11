// OpenAI credit/usage tracking + low-credit WhatsApp alerting. Server-only.
//
// Why a TOKEN BUDGET and not a balance: OpenAI has no API that returns the
// remaining prepaid credit on a key. What it does expose is consumption, so an
// account here stores the allocation the ops team granted the client
// (allocated_tokens) and this module keeps used_tokens up to date against it.
// Remaining % drives the status and the alert thresholds.
//
// Nothing about WhatsApp is re-implemented. Delivery goes through
// src/lib/alerts.ts -> src/lib/aisensy.ts, incidents land in the same `alerts`
// table under source_kind 'openai', and throttling reuses the same
// alerted / last_alerted_at / REPEAT_ALERT_MS rules the VM alerter uses.

import { sql, updateById } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getAisensyConfig } from '@/lib/aisensy';
import {
  REPEAT_ALERT_MS,
  closeOrphanedIncidents,
  openIncident,
  openIncidentSeverity,
  resolveIncident,
  sendWhatsApp,
} from '@/lib/alerts';
import type { Status } from '@/lib/types';

// Overridable so the app can be pointed at an OpenAI-compatible gateway or
// proxy (and so the usage parsing can be exercised without live credentials).
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const USAGE_DAYS = 30; // usage window pulled per check
const PAGE_CAP = 8; // 1-day buckets over a month fit well inside this

export interface OpenAiAccountRow {
  id: string;
  client_id: string;
  name: string;
  org_id: string | null;
  project_id: string | null;
  allocated_tokens: string | number;
  used_tokens: string | number;
  used_source: 'manual' | 'api';
  low_threshold_pct: number;
  critical_threshold_pct: number;
  credentials_encrypted: string | null;
  status: string;
  alerted: boolean;
  last_checked_at: string | null;
  last_alerted_at: string | null;
  low_since: string | null;
  alert_name: string | null;
  alert_phone: string | null;
  client_name?: string | null;
  client_alert_name?: string | null;
  client_alert_phone?: string | null;
}

// bigint columns arrive from node-postgres as strings.
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Remaining allocation as a percentage, and the status that follows from it.
 *
 * With no allocation recorded there is nothing to be a percentage OF, so the
 * account reports healthy and is skipped by the alerter — otherwise every
 * freshly added account would look 0% remaining and immediately alert.
 */
export function creditState(a: {
  allocated_tokens: string | number;
  used_tokens: string | number;
  low_threshold_pct: number;
  critical_threshold_pct: number;
}): { remaining_tokens: number; remaining_pct: number; status: Status; budgeted: boolean } {
  const allocated = num(a.allocated_tokens);
  const used = num(a.used_tokens);
  const remaining_tokens = Math.max(0, allocated - used);
  if (allocated <= 0) {
    return { remaining_tokens: 0, remaining_pct: 100, status: 'healthy', budgeted: false };
  }
  const remaining_pct = Math.max(0, Math.min(100, Math.round((remaining_tokens / allocated) * 100)));
  const status: Status =
    remaining_pct <= a.critical_threshold_pct ? 'down' : remaining_pct <= a.low_threshold_pct ? 'warning' : 'healthy';
  return { remaining_tokens, remaining_pct, status, budgeted: true };
}

/**
 * Total tokens consumed over the trailing window, for ONE project.
 *
 * Authentication: `/v1/organization/usage/*` is organization-scoped and needs an
 * **admin** key (`sk-admin-…`) minted under Organization → Admin keys. A normal
 * project key (`sk-proj-…`) is rejected with 401 and cannot read usage at all —
 * so the failure is recorded on the row rather than thrown away, and the account
 * keeps whatever figure was entered by hand while saying why.
 *
 * Scoping: `projectId` is REQUIRED. It is sent as `project_ids[]`, which is the
 * encoding OpenAI's own SDK emits (its query serialiser runs with
 * arrayFormat:'brackets'), and it is what keeps two accounts under one
 * organization from reading each other's consumption. Without it the endpoint
 * answers for the WHOLE organization, and every account sharing that admin key
 * would report the same number and cross the same threshold together.
 *
 * Because that isolation is the entire point, it is not left to trust:
 * `group_by=project_id` makes the API label every result with the project it
 * belongs to, and any result carrying a DIFFERENT project id is discarded here.
 * If the server-side filter ever changed shape, this account would under-report
 * rather than silently absorb another project's usage.
 */
async function fetchUsedTokens(apiKey: string, projectId: string): Promise<number> {
  const startTime = Math.floor((Date.now() - USAGE_DAYS * 86_400_000) / 1000);
  const base = new URLSearchParams({
    start_time: String(startTime),
    bucket_width: '1d',
    limit: '31', // API maximum for 1d buckets
  });
  base.set('project_ids[]', projectId);
  // Makes result.project_id non-null so the cross-check below has something to
  // compare; without a group_by the API returns it as null.
  base.set('group_by[]', 'project_id');

  let total = 0;
  let page = '';
  for (let i = 0; i < PAGE_CAP; i++) {
    const qs = new URLSearchParams(base);
    if (page) qs.set('page', page);
    const res = await fetch(`${API_BASE}/organization/usage/completions?${qs}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI usage API (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = text ? JSON.parse(text) : {};
    for (const bucket of json.data ?? []) {
      for (const r of bucket.results ?? []) {
        // Belt and braces: never count a bucket the API attributed elsewhere.
        if (r.project_id && r.project_id !== projectId) continue;
        // input_cached_tokens / input_audio_tokens are SUBSETS of input_tokens,
        // so adding them would double-count.
        total += num(r.input_tokens) + num(r.output_tokens);
      }
    }
    if (!json.has_more || !json.next_page) break;
    page = String(json.next_page);
  }
  return total;
}

export interface CheckOutcome {
  id: string;
  status: Status;
  remaining_pct: number;
  used_tokens: number;
  used_source: 'manual' | 'api';
  error: string | null;
}

/**
 * Refresh one account: pull usage when a key is stored, then recompute status.
 *
 * The status is written even when the usage pull fails, because the previously
 * known figures are still worth judging — a stale "critical" must not silently
 * become healthy just because OpenAI was unreachable this cycle.
 */
export async function checkOpenAiAccount(acct: OpenAiAccountRow): Promise<CheckOutcome> {
  let used = num(acct.used_tokens);
  let source: 'manual' | 'api' = acct.used_source;
  let error: string | null = null;

  if (acct.credentials_encrypted) {
    try {
      // A stored key with no project id predates the project requirement (or was
      // written straight into the database). Pulling anyway would attribute the
      // whole organization's consumption to this one account, so it is refused
      // and said out loud instead — the row keeps its manual figure.
      if (!acct.project_id) {
        throw new Error(
          'No OpenAI project ID on this account — usage cannot be scoped to it. Edit the account and set its project ID (proj_…).'
        );
      }
      // Decrypted per account, used for this account only, and never returned or
      // logged: the plaintext key does not leave this block.
      const key = decrypt(acct.credentials_encrypted);
      used = await fetchUsedTokens(key, acct.project_id);
      source = 'api';
    } catch (e) {
      error = e instanceof Error ? e.message : 'usage check failed';
      // Deliberately identifies the account by name only. The key, the
      // ciphertext and the response body never reach the log.
      console.error('[openai] usage check failed for', acct.name, '-', error);
    }
  }

  const state = creditState({ ...acct, used_tokens: used });

  await updateById('openai_accounts', acct.id, {
    used_tokens: used,
    used_source: source,
    status: state.status,
    last_checked_at: new Date().toISOString(),
    last_check_error: error,
    updated_at: new Date().toISOString(),
  });

  return {
    id: acct.id,
    status: state.status,
    remaining_pct: state.remaining_pct,
    used_tokens: used,
    used_source: source,
    error,
  };
}

const SELECT_WITH_CLIENT = `
  select a.*,
         c.name        as client_name,
         c.alert_name  as client_alert_name,
         c.alert_phone as client_alert_phone
    from openai_accounts a
    left join clients c on c.id = a.client_id
`;

export async function loadAccountsForCheck(): Promise<OpenAiAccountRow[]> {
  return sql<OpenAiAccountRow>(`${SELECT_WITH_CLIENT} order by a.created_at asc`);
}

/**
 * Refresh every account. Never rejects — one bad key must not stop the rest.
 *
 * `staleMs` skips accounts checked more recently than that, so a caller running
 * on a short interval (the 5-minute cron) can be wired up without hammering
 * OpenAI's org API. Omit it to force a refresh, which is what the UI's
 * "Check now" does.
 */
export async function checkAllOpenAiAccounts(staleMs?: number): Promise<CheckOutcome[]> {
  const all = await loadAccountsForCheck();
  const accounts =
    staleMs == null
      ? all
      : all.filter(
          (a) => !a.last_checked_at || Date.now() - new Date(a.last_checked_at).getTime() >= staleMs
        );
  const out = await Promise.all(
    accounts.map((a) =>
      checkOpenAiAccount(a).catch((e) => ({
        id: a.id,
        status: a.status as Status,
        remaining_pct: 0,
        used_tokens: num(a.used_tokens),
        used_source: a.used_source,
        error: e instanceof Error ? e.message : 'check failed',
      }))
    )
  );
  return out;
}

/**
 * Message the account's contact when its remaining allocation has crossed a
 * threshold, and close the incident once it is topped up.
 *
 * Deliberately the same shape as runAlerts() in src/lib/alerts.ts:
 *   - one WhatsApp per incident, repeated at most every REPEAT_ALERT_MS
 *   - `alerted` only set once a message actually went out, so an account with no
 *     phone number alerts as soon as one is added
 *   - one open `alerts` row per account, enforced by alerts_one_active_per_source
 *
 * Unlike a VM there is no two-pass time threshold: an exhausted allocation is not
 * a blip that might resolve itself on the next probe, so the first cycle that
 * sees it low both records `low_since` and sends.
 */
export async function runOpenAiAlerts(): Promise<void> {
  const cfg = await getAisensyConfig();
  // Credit alerts prefer their own approved template; blank falls back to the
  // downtime one inside sendAisensy.
  const campaign = cfg.credits_campaign?.trim() || undefined;
  const now = Date.now();

  // A deleted account cannot close its own incident — the loop below only sees
  // rows that still exist.
  await closeOrphanedIncidents();

  const accounts = await loadAccountsForCheck();

  for (const a of accounts) {
    const state = creditState(a);
    // No allocation recorded means no basis for "low" — skip rather than alert.
    if (!state.budgeted) continue;

    const phone = a.alert_phone || a.client_alert_phone || '';
    const who = a.alert_name || a.client_alert_name || undefined;
    const clientName = a.client_name || '';
    const isLow = state.status === 'warning' || state.status === 'down';

    if (isLow) {
      if (!a.low_since) {
        await updateById('openai_accounts', a.id, { low_since: new Date().toISOString() });
      }
      const critical = state.status === 'down';
      // Dropping from low to critical is new, urgent information, so it breaks
      // through the repeat window instead of waiting up to 24h behind the warning
      // that was already sent. The open alert row is the record of what the
      // contact was last told.
      const escalated = critical && (await openIncidentSeverity('openai', a.id)) === 'warning';

      if (a.alerted && !escalated) {
        if (!a.last_alerted_at) {
          // alerted with no timestamp — start the repeat clock now instead of
          // treating "unknown" as infinitely overdue and firing immediately.
          await updateById('openai_accounts', a.id, { last_alerted_at: new Date().toISOString() });
          continue;
        }
        if (now - new Date(a.last_alerted_at).getTime() < REPEAT_ALERT_MS) continue;
      }

      const label = critical ? 'CREDITS CRITICAL' : 'CREDITS LOW';
      const d = await sendWhatsApp(
        cfg,
        phone,
        who,
        // Same 4-variable contract as the downtime template: the 4th slot is the
        // figure that matters for this alert type.
        [a.name, clientName, label, `${state.remaining_pct}% remaining`],
        campaign
      );

      await openIncident(
        'openai',
        { id: a.id, client_id: a.client_id },
        {
          severity: critical ? 'critical' : 'warning',
          title: `${a.name} — OpenAI credits ${critical ? 'critical' : 'low'}`,
          description:
            `${state.remaining_pct}% of the allocation remaining ` +
            `(${state.remaining_tokens.toLocaleString()} of ${num(a.allocated_tokens).toLocaleString()} tokens)` +
            (clientName ? ` · ${clientName}` : ''),
        },
        d
      );

      if (d.sent) {
        await updateById('openai_accounts', a.id, { alerted: true, last_alerted_at: new Date().toISOString() });
      }
    } else if (a.alerted) {
      // Topped up (or allocation raised) after an alert went out.
      const d =
        cfg.recovery && phone
          ? await sendWhatsApp(cfg, phone, who, [a.name, clientName, 'CREDITS OK', `${state.remaining_pct}% remaining`], campaign)
          : null;
      await resolveIncident('openai', a.id, d);
      await updateById('openai_accounts', a.id, { alerted: false, last_alerted_at: null, low_since: null });
    } else if (a.low_since) {
      // Went low and recovered before anything could be delivered; an incident
      // row may still be open from a failed send, so close that too.
      await resolveIncident('openai', a.id, null);
      await updateById('openai_accounts', a.id, { low_since: null });
    }
  }
}

/**
 * Refresh usage for every account, then evaluate low-credit alerts.
 *
 * Alert evaluation always runs even when every usage figure was still fresh: it
 * only reads the database, and it is what delivers the 24h repeat on an account
 * that is already low.
 */
export async function syncOpenAiCredits(staleMs?: number): Promise<{ checked: number }> {
  const outcomes = await checkAllOpenAiAccounts(staleMs);
  await runOpenAiAlerts();
  return { checked: outcomes.length };
}
