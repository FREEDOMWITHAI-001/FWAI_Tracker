// Zoom API as an attendance source.
//
// We do NOT re-implement any Zoom plumbing: lib/zoom.ts already mints the S2S
// token and pulls the participant report. This module just walks the client's
// already-synced zoom_sessions rows, calls fetchSessionParticipants() for each,
// and writes the result into the SAME dataset/rows tables an upload produces —
// so downstream everything is identical and the precedence rule
// (assumptions.attendance_precedence) is the only place the two differ.

import { sql } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { fetchSessionParticipants, type ZoomCreds } from '@/lib/zoom';

// Fixed header names, so the mapping below never has to be guessed.
export const ZOOM_HEADERS = [
  'Session Id',
  'Topic',
  'Start Time',
  'Name',
  'Email',
  'Join Time',
  'Leave Time',
  'Duration (Minutes)',
];

export const ZOOM_MAPPING: Record<string, string> = {
  session_id: 'Session Id',
  session_topic: 'Topic',
  session_start: 'Start Time',
  name: 'Name',
  email: 'Email',
  join_time: 'Join Time',
  leave_time: 'Leave Time',
  watch_minutes: 'Duration (Minutes)',
};

export interface ZoomPullResult {
  rows: Record<string, string>[];
  sessions_pulled: number;
  sessions_failed: { topic: string; error: string }[];
  participants: number;
}

const MAX_SESSIONS = 40; // keep one request inside the function time budget

interface SessionRow {
  id: string;
  kind: 'webinar' | 'meeting';
  zoom_id: string | null;
  zoom_uuid: string | null;
  topic: string | null;
  start_time: string | null;
  credentials_encrypted: string | null;
}

export async function pullZoomAttendance(
  clientId: string,
  opts: { from?: string | null; to?: string | null; session_ids?: string[] } = {}
): Promise<ZoomPullResult> {
  const params: unknown[] = [clientId];
  const where = ['s.client_id = $1'];
  if (opts.session_ids?.length) {
    params.push(opts.session_ids);
    where.push(`s.id = any($${params.length}::uuid[])`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`s.start_time >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`s.start_time <= $${params.length}`);
  }
  params.push(MAX_SESSIONS);

  const sessions = await sql<SessionRow>(
    `select s.id, s.kind, s.zoom_id, s.zoom_uuid, s.topic, s.start_time,
            a.credentials_encrypted
       from zoom_sessions s
       left join zoom_accounts a on a.id = s.zoom_account_id
      where ${where.join(' and ')}
      order by s.start_time desc nulls last
      limit $${params.length}`,
    params
  );
  if (!sessions.length) {
    return { rows: [], sessions_pulled: 0, sessions_failed: [], participants: 0 };
  }

  const rows: Record<string, string>[] = [];
  const failed: { topic: string; error: string }[] = [];
  let pulled = 0;

  for (const s of sessions) {
    const enc = s.credentials_encrypted;
    if (!enc) {
      failed.push({ topic: s.topic ?? '', error: 'no Zoom account on this session' });
      continue;
    }
    let creds: ZoomCreds;
    try {
      creds = JSON.parse(decrypt(enc));
    } catch {
      failed.push({ topic: s.topic ?? '', error: 'could not decrypt credentials (check APP_ENCRYPTION_KEY)' });
      continue;
    }
    try {
      // fetchSessionParticipants falls back to zoom_id when the uuid is blank,
      // so empty strings preserve the previous behaviour for null columns.
      const parts = await fetchSessionParticipants(creds, s.kind, s.zoom_id ?? '', s.zoom_uuid ?? '');
      for (const p of parts) {
        rows.push({
          'Session Id': String(s.zoom_id ?? s.id),
          Topic: s.topic ?? '',
          'Start Time': s.start_time ?? '',
          Name: p.name ?? '',
          Email: p.email ?? '',
          'Join Time': p.join_time ?? '',
          'Leave Time': p.leave_time ?? '',
          'Duration (Minutes)': p.duration_min == null ? '' : String(p.duration_min),
        });
      }
      pulled++;
    } catch (e) {
      // A free Zoom plan has no participant report — surface it rather than
      // silently producing an attendance dataset with zero rows.
      failed.push({ topic: s.topic ?? '', error: e instanceof Error ? e.message : 'participant report failed' });
    }
  }

  return { rows, sessions_pulled: pulled, sessions_failed: failed, participants: rows.length };
}
