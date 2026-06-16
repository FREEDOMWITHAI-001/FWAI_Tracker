import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { decrypt } from '@/lib/crypto';
import { fetchSessionParticipants, summarizeParticipants, type ZoomCreds } from '@/lib/zoom';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// GET /api/zoom-sessions/[id]/participants
// Live-fetches the participant report for one session and returns it plus
// a small metrics summary. Not stored — pulled on demand when a row expands.
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: s, error } = await db
      .from('zoom_sessions')
      .select('id, kind, zoom_id, zoom_uuid, participants_count, zoom_accounts(credentials_encrypted)')
      .eq('id', id)
      .single();
    if (error) return bad(error.message, 404);

    const enc = (s as any).zoom_accounts?.credentials_encrypted;
    if (!enc) return bad('Zoom account not found for this session', 404);

    let creds: ZoomCreds;
    try {
      creds = JSON.parse(decrypt(enc));
    } catch {
      return bad('Could not decrypt Zoom credentials (check APP_ENCRYPTION_KEY).', 500);
    }

    try {
      const participants = await fetchSessionParticipants(creds, (s as any).kind, (s as any).zoom_id, (s as any).zoom_uuid);
      const storedTotal = Number((s as any).participants_count) || 0;
      const metrics = summarizeParticipants(participants);

      // Cache the computed metrics on the row so the list/export can show them.
      await db
        .from('zoom_sessions')
        .update({
          unique_participants: metrics.unique,
          peak_concurrent: metrics.peak_concurrent,
          avg_duration_min: metrics.avg_duration_min,
          rejoins: metrics.rejoins,
          metrics_at: new Date().toISOString(),
        })
        .eq('id', id);

      return ok({
        kind: (s as any).kind,
        stored_total: storedTotal,
        fetched: participants.length,
        truncated: storedTotal > 0 && participants.length < storedTotal,
        metrics,
        participants: participants.slice(0, 1000), // for the optional list view
      });
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'failed to fetch participants', 502);
    }
  });
}
