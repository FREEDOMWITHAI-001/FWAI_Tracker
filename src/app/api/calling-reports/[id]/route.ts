import { deleteById, jsonb, maybeOne, sql, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { loadTemplates } from '@/lib/reports/store';
import { checkTemplate, visibleTemplates } from '@/lib/reports/templates';
import type { InputRole } from '@/lib/reports/types';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// GET /api/calling-reports/[id]
// The whole builder state: report + datasets + which templates are runnable
// given what has been uploaded so far.
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;

    const report = await maybeOne<any>(
      `select r.*, coalesce(c.name, '—') as client_name
         from calling_reports r
         left join clients c on c.id = r.client_id
        where r.id = $1`,
      [id]
    );
    if (!report) return bad('Report not found', 404);

    const datasets = await sql(
      `select id, role, source, filename, shape, row_count, headers, mapping,
              mapping_confidence, options, detect_notes, content_hash, created_at
         from report_datasets
        where report_id = $1
        order by created_at asc`,
      [id]
    );

    const roles = [...new Set(datasets.map((d: any) => d.role))] as InputRole[];
    const templates = visibleTemplates(await loadTemplates(report.client_id), report.template_key).map((t) => ({
      ...t,
      validity: checkTemplate(t, roles),
    }));

    return ok({
      ...report,
      datasets,
      present_roles: roles,
      templates,
    });
  });
}

// PATCH /api/calling-reports/[id]
// Editing assumptions invalidates the quality acknowledgement — the numbers the
// operator signed off on no longer exist.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ['name', 'template_key', 'period_label', 'period_start', 'period_end'] as const) {
      if (k in body) patch[k] = body[k];
    }
    if (body.assumptions) {
      patch.assumptions = jsonb(body.assumptions);
      patch.quality_ack_at = null;
      patch.quality_ack_hash = null;
    }
    const data = await updateById('calling_reports', id, patch);
    if (!data) return bad('Report not found', 404);
    return ok(data);
  });
}

// DELETE /api/calling-reports/[id] — cascades to datasets, rows and facts.
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('calling_reports', id);
    return ok({ deleted: true });
  });
}
