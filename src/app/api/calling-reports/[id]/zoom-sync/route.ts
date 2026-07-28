import { exec, insertOne, jsonb, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { insertRows } from '@/lib/reports/store';
import { pullZoomAttendance, ZOOM_HEADERS, ZOOM_MAPPING } from '@/lib/reports/zoom-source';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/calling-reports/[id]/zoom-sync  { from?, to?, session_ids? }
//
// Builds an attendance dataset straight from the Zoom participant report via
// lib/zoom.ts. It lands in the same tables an upload does; which one wins for a
// session is decided by assumptions.attendance_precedence (default: upload).
export async function POST(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const report = await maybeOne<{
      id: string;
      client_id: string;
      period_start: string | null;
      period_end: string | null;
    }>('select id, client_id, period_start, period_end from calling_reports where id = $1', [id]);
    if (!report) return bad('Report not found', 404);

    const from = body.from ?? report.period_start ?? null;
    const to = body.to ?? report.period_end ?? null;

    const pull = await pullZoomAttendance(report.client_id, {
      from: from ? `${from}T00:00:00+05:30` : null,
      to: to ? `${to}T23:59:59+05:30` : null,
      session_ids: body.session_ids,
    });

    if (!pull.rows.length) {
      return bad(
        pull.sessions_failed.length
          ? `Zoom returned no participants. ${pull.sessions_failed.map((f) => `${f.topic}: ${f.error}`).join(' | ')}`
          : 'No synced Zoom sessions matched this period. Sync the Zoom account on the Zoom Metrics page first.',
        502
      );
    }

    // Replace any previous Zoom pull on this report rather than stacking them.
    await exec("delete from report_datasets where report_id = $1 and source = 'zoom_api'", [id]);

    const ds = await insertOne<any>('report_datasets', {
      client_id: report.client_id,
      report_id: id,
      role: 'attendance',
      source: 'zoom_api',
      filename: `Zoom API — ${pull.sessions_pulled} session(s)`,
      shape: 'zoom_api',
      headers: jsonb(ZOOM_HEADERS),
      row_count: pull.rows.length,
      mapping: jsonb(ZOOM_MAPPING),
      mapping_confidence: jsonb(Object.fromEntries(Object.keys(ZOOM_MAPPING).map((k) => [k, 1]))),
      options: jsonb({ duration_unit: 'minutes', date_order: 'mdy' }),
      detect_notes: jsonb([
        `Pulled ${pull.participants.toLocaleString()} join records from ${pull.sessions_pulled} Zoom session(s).`,
        ...pull.sessions_failed.map((f) => `Skipped "${f.topic}": ${f.error}`),
      ]),
    });

    await insertRows(ds.id, pull.rows, []);
    await updateById('calling_reports', id, {
      status: 'draft',
      quality_ack_at: null,
      quality_ack_hash: null,
      updated_at: new Date().toISOString(),
    });

    return ok({ dataset: ds, ...pull, rows: undefined }, 201);
  });
}
