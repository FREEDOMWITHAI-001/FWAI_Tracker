import { jsonb, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { runReport } from '@/lib/reports/engine';
import {
  loadDatasets,
  loadExclusions,
  loadTemplate,
  mergeAssumptions,
  saveFacts,
  snapshotVersion,
} from '@/lib/reports/store';
import { checkTemplate } from '@/lib/reports/templates';
import type { InputRole } from '@/lib/reports/types';

export const runtime = 'nodejs';
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/calling-reports/[id]/run   { assumptions? }
//
// Re-runs the whole engine off the stored raw rows. Passing `assumptions` here
// is the entire point of the product: change a knob, re-run, get a new version
// without touching a single file.
export async function POST(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const report = await maybeOne<any>('select * from calling_reports where id = $1', [id]);
    if (!report) return bad('Report not found', 404);

    const assumptions = mergeAssumptions({ ...(report.assumptions ?? {}), ...(body.assumptions ?? {}) });
    const template = await loadTemplate(report.client_id, report.template_key);
    if (!template) return bad(`Unknown template "${report.template_key}"`);

    const datasets = await loadDatasets(id);
    if (!datasets.length) return bad('Upload at least one input file before running.');

    const roles = [...new Set(datasets.map((d) => d.role))] as InputRole[];
    const validity = checkTemplate(template, roles);
    if (!validity.valid) {
      return bad(`Template "${template.name}" needs ${validity.missing.join(', ')} — upload those first.`, 422);
    }

    try {
      const { result, quality, facts } = runReport({
        template,
        assumptions,
        datasets,
        exclusions: await loadExclusions(report.client_id),
        period_label: report.period_label ?? null,
      });

      await saveFacts(id, facts);

      const version = Number(report.run_count ?? 0) + 1;
      // Snapshot before updating the report row, so a crash leaves an extra
      // version rather than a version that was never recorded.
      await snapshotVersion(id, version, {
        template_key: report.template_key,
        period_label: report.period_label ?? null,
        assumptions,
        result,
        quality,
      });

      // A fresh run always clears the sign-off: the operator must look at the
      // NEW quality panel before these numbers can be exported.
      const saved = await updateById<any>('calling_reports', id, {
        assumptions: jsonb(assumptions),
        result: jsonb(result),
        quality: jsonb(quality),
        status: 'ready',
        error: null,
        generated_at: new Date().toISOString(),
        run_count: version,
        quality_ack_at: null,
        quality_ack_hash: null,
        updated_at: new Date().toISOString(),
      });
      if (!saved) return bad('Report not found', 404);

      return ok({
        id: saved.id,
        status: saved.status,
        generated_at: saved.generated_at,
        run_count: saved.run_count,
        result,
        quality,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Report run failed';
      await updateById('calling_reports', id, { status: 'failed', error: msg });
      return bad(msg, 500);
    }
  });
}
