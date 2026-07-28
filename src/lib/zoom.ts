import { updateById, upsertMany } from '@/lib/db';
import { decrypt } from '@/lib/crypto';

// Zoom Server-to-Server OAuth client + sync.
//
// Each client connects their own Zoom S2S OAuth app; we store its
// { account_id, client_id, client_secret } encrypted in zoom_accounts.
// A sync mints a short-lived access token, lists the account's users, then
// pulls their recent webinars and meetings (last LOOKBACK_DAYS) and upserts
// them into zoom_sessions.
//
// Participant/attendance numbers come from the Report API, which needs a PAID
// Zoom plan + the report:read:admin scope. On free plans those calls fail; we
// swallow them per-session (counts stay 0) so the rest of the sync still works.

export interface ZoomCreds {
  account_id: string;
  client_id: string;
  client_secret: string;
}

const OAUTH_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';
const LOOKBACK_DAYS = 30; // Report API range is capped at ~1 month per query
const MAX_USERS = 50; // safety cap so a huge account can't time the function out
const MAX_WEBINARS_PER_USER = 50;
const PAGE_CAP = 4; // max pages to walk per paginated list

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// --- low-level HTTP --------------------------------------------------------

export async function zoomToken(creds: ZoomCreds): Promise<string> {
  const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
  const url = `${OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(creds.account_id)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('Zoom auth returned no access_token');
  return json.access_token as string;
}

async function zoomGet(token: string, path: string, params: Record<string, string | number> = {}): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoom ${path} (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// Walk a paginated list endpoint, collecting items under `key`.
async function zoomList(
  token: string,
  path: string,
  params: Record<string, string | number>,
  key: string,
  cap = PAGE_CAP
): Promise<any[]> {
  const out: any[] = [];
  let next = '';
  for (let i = 0; i < cap; i++) {
    const page = await zoomGet(token, path, { page_size: 300, ...params, ...(next ? { next_page_token: next } : {}) });
    if (Array.isArray(page[key])) out.push(...page[key]);
    next = page.next_page_token || '';
    if (!next) break;
  }
  return out;
}

// Zoom requires UUIDs that start with '/' or contain '//' to be double-encoded
// when used as a path segment.
function encodeUuid(uuid: string): string {
  return uuid.startsWith('/') || uuid.includes('//')
    ? encodeURIComponent(encodeURIComponent(uuid))
    : encodeURIComponent(uuid);
}

export interface ZoomParticipant {
  name: string;
  email: string | null;
  join_time: string | null;
  leave_time: string | null;
  duration_min: number | null;
}

const PARTICIPANT_PAGE_CAP = 20; // ~6000 join records max — covers large sessions in full

// Pull the participant report for one past meeting/webinar occurrence.
// Needs report:read:list_meeting_participants:admin (meetings) /
// report:read:list_webinar_participants:admin (webinars) + a paid plan.
export async function fetchSessionParticipants(
  creds: ZoomCreds,
  kind: 'webinar' | 'meeting',
  zoomId: string,
  zoomUuid: string
): Promise<ZoomParticipant[]> {
  const token = await zoomToken(creds);
  const ident = encodeUuid(zoomUuid || zoomId);
  const base = kind === 'webinar' ? '/report/webinars' : '/report/meetings';
  const raw = await zoomList(token, `${base}/${ident}/participants`, {}, 'participants', PARTICIPANT_PAGE_CAP);
  return raw.map((p: any) => ({
    name: p.name || p.user_name || '(guest)',
    email: p.user_email || null,
    join_time: p.join_time || null,
    leave_time: p.leave_time || null,
    // Zoom report `duration` is in seconds — convert to whole minutes.
    duration_min: p.duration != null ? Math.round(Number(p.duration) / 60) : null,
  }));
}

export interface SessionMetrics {
  join_events: number; // every join record (a rejoin is a new record)
  unique: number; // distinct people (by email, else name)
  rejoins: number; // join_events − unique
  rejoined_people: number; // distinct people who joined more than once
  peak_concurrent: number; // most people in the room at once
  peak_time: string | null; // when that peak happened
  total_duration_min: number; // summed watch time across all join records
  avg_duration_min: number; // total ÷ unique people
  first_join: string | null;
  last_leave: string | null;
}

// Roll a participant report up into the counts the UI shows. Peak concurrency
// comes from a +1/−1 sweep over join/leave times (leave inferred from
// join+duration when leave_time is missing).
export function summarizeParticipants(parts: ZoomParticipant[]): SessionMetrics {
  const keyOf = (p: ZoomParticipant) => (p.email ? p.email.toLowerCase() : p.name) || 'unknown';
  const joinsByPerson = new Map<string, number>();
  for (const p of parts) joinsByPerson.set(keyOf(p), (joinsByPerson.get(keyOf(p)) || 0) + 1);
  const unique = joinsByPerson.size;
  const rejoined_people = [...joinsByPerson.values()].filter((n) => n > 1).length;
  const join_events = parts.length;
  const total_duration_min = parts.reduce((s, p) => s + (p.duration_min || 0), 0);

  const events: { t: number; delta: number; iso: string }[] = [];
  const joinMs: number[] = [];
  const leaveMs: number[] = [];
  for (const p of parts) {
    if (!p.join_time) continue;
    const jt = Date.parse(p.join_time);
    if (Number.isNaN(jt)) continue;
    joinMs.push(jt);
    let lt = p.leave_time ? Date.parse(p.leave_time) : NaN;
    if (Number.isNaN(lt) && p.duration_min != null) lt = jt + p.duration_min * 60_000;
    events.push({ t: jt, delta: 1, iso: p.join_time });
    if (!Number.isNaN(lt)) {
      leaveMs.push(lt);
      events.push({ t: lt, delta: -1, iso: new Date(lt).toISOString() });
    }
  }
  // At equal timestamps, process leaves (−1) before joins (+1).
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let cur = 0;
  let peak = 0;
  let peakIso: string | null = null;
  for (const e of events) {
    cur += e.delta;
    if (cur > peak) {
      peak = cur;
      peakIso = e.iso;
    }
  }

  return {
    join_events,
    unique,
    rejoins: Math.max(0, join_events - unique),
    rejoined_people,
    peak_concurrent: peak,
    peak_time: peakIso,
    total_duration_min,
    avg_duration_min: unique ? Math.round(total_duration_min / unique) : 0,
    first_join: joinMs.length ? new Date(Math.min(...joinMs)).toISOString() : null,
    last_leave: leaveMs.length ? new Date(Math.max(...leaveMs)).toISOString() : null,
  };
}

// total_records from a list endpoint without pulling every record.
async function zoomCount(token: string, path: string, params: Record<string, string | number> = {}): Promise<number> {
  const page = await zoomGet(token, path, { page_size: 1, ...params });
  return Number(page.total_records) || 0;
}

// --- domain shapes ---------------------------------------------------------

export interface SyncedSession {
  kind: 'webinar' | 'meeting';
  zoom_id: string;
  zoom_uuid: string;
  topic: string;
  host_email: string | null;
  start_time: string | null;
  duration_min: number | null;
  registrants_count: number;
  participants_count: number;
  attendance_pct: number;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

// --- high-level sync -------------------------------------------------------

export async function collectZoomSessions(creds: ZoomCreds): Promise<SyncedSession[]> {
  const token = await zoomToken(creds);
  const now = new Date();
  const from = ymd(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));
  const to = ymd(now);

  const users = (await zoomList(token, '/users', { status: 'active' }, 'users')).slice(0, MAX_USERS);
  const sessions: SyncedSession[] = [];

  for (const u of users) {
    const userId: string = u.id;
    const email: string = u.email || '';

    // Meetings — the report endpoint gives participants_count directly.
    try {
      const meetings = await zoomList(token, `/report/users/${userId}/meetings`, { type: 'past', from, to }, 'meetings');
      for (const m of meetings) {
        sessions.push({
          kind: 'meeting',
          zoom_id: String(m.id ?? ''),
          zoom_uuid: String(m.uuid ?? m.id ?? ''),
          topic: m.topic || '(untitled meeting)',
          host_email: m.user_email || email || null,
          start_time: m.start_time || null,
          duration_min: m.duration != null ? Number(m.duration) : null,
          registrants_count: 0,
          participants_count: Number(m.participants_count) || 0,
          attendance_pct: 0, // meetings have no registrant baseline
        });
      }
    } catch {
      /* report API unavailable (free plan) — skip this user's meetings */
    }

    // Webinars — list, then count registrants + participants per webinar.
    try {
      const webinars = (await zoomList(token, `/users/${userId}/webinars`, {}, 'webinars')).slice(0, MAX_WEBINARS_PER_USER);
      for (const w of webinars) {
        const id = String(w.id ?? '');
        let registrants = 0;
        let participants = 0;
        try {
          registrants = await zoomCount(token, `/webinars/${id}/registrants`, { status: 'approved' });
        } catch {
          /* registrants unavailable */
        }
        try {
          participants = await zoomCount(token, `/report/webinars/${id}/participants`);
        } catch {
          /* participants report unavailable (free plan) */
        }
        sessions.push({
          kind: 'webinar',
          zoom_id: id,
          zoom_uuid: String(w.uuid ?? id),
          topic: w.topic || '(untitled webinar)',
          host_email: email || null,
          start_time: w.start_time || null,
          duration_min: w.duration != null ? Number(w.duration) : null,
          registrants_count: registrants,
          participants_count: participants,
          attendance_pct: pct(participants, registrants),
        });
      }
    } catch {
      /* webinars unavailable for this user */
    }
  }

  return sessions;
}

export interface ZoomAccountRow {
  id: string;
  client_id: string;
  credentials_encrypted: string;
}

// Sync one account: pull sessions, upsert them, stamp last_synced_at/error.
export async function syncZoomAccount(account: ZoomAccountRow) {
  let creds: ZoomCreds;
  try {
    creds = JSON.parse(decrypt(account.credentials_encrypted));
  } catch {
    throw new Error('Could not decrypt Zoom credentials (check APP_ENCRYPTION_KEY).');
  }

  try {
    const sessions = await collectZoomSessions(creds);
    if (sessions.length) {
      const rows = sessions.map((s) => ({
        zoom_account_id: account.id,
        client_id: account.client_id,
        kind: s.kind,
        zoom_id: s.zoom_id,
        zoom_uuid: s.zoom_uuid,
        topic: s.topic,
        host_email: s.host_email,
        start_time: s.start_time,
        duration_min: s.duration_min,
        registrants_count: s.registrants_count,
        participants_count: s.participants_count,
        attendance_pct: s.attendance_pct,
        updated_at: new Date().toISOString(),
      }));
      await upsertMany('zoom_sessions', rows, ['zoom_account_id', 'zoom_uuid']);
    }
    await updateById('zoom_accounts', account.id, {
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    });
    return { synced: sessions.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    await updateById('zoom_accounts', account.id, { last_sync_error: msg });
    throw e;
  }
}
