import { deleteById, jsonb, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { headerSignature } from '@/lib/reports/parse';
import { fieldSpecs } from '@/lib/reports/mapping';
import { loadRows, rememberMapping } from '@/lib/reports/store';
import type { InputRole } from '@/lib/reports/types';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ dsId: string }> };

// GET /api/calling-reports/datasets/[dsId]?preview=50
// The confirm-and-edit mapping screen reads this: headers, current mapping,
// the field catalogue for the role, and a sample of real rows.
export async function GET(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { dsId } = await params;
    const limit = Math.min(200, Number(new URL(req.url).searchParams.get('preview') ?? 25));
    const data = await maybeOne<any>('select * from report_datasets where id = $1', [dsId]);
    if (!data) return bad('Dataset not found', 404);
    const rows = await loadRows(dsId);
    return ok({
      ...data,
      fields: fieldSpecs(data.role as InputRole),
      preview: rows.main.slice(0, limit),
      session_preview: rows.session.slice(0, 5),
    });
  });
}

// PATCH /api/calling-reports/datasets/[dsId]  { mapping?, options?, role?, remember? }
// Confirming a mapping saves it against this client + header layout, so the
// same export next month maps itself.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { dsId } = await params;
    const body = await req.json();

    const ds = await maybeOne<any>('select * from report_datasets where id = $1', [dsId]);
    if (!ds) return bad('Dataset not found', 404);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.mapping) patch.mapping = jsonb(body.mapping);
    if (body.options) patch.options = jsonb(body.options);
    if (body.role) patch.role = body.role;

    const data = await updateById('report_datasets', dsId, patch);
    if (!data) return bad('Dataset not found', 404);

    if (body.remember !== false && body.mapping) {
      const headers = (ds.headers ?? []) as string[];
      await rememberMapping(
        ds.client_id,
        (body.role ?? ds.role) as InputRole,
        headerSignature(headers),
        body.mapping,
        (body.options ?? ds.options) ?? {}
      );
    }

    // Any mapping change invalidates a previous run and its sign-off.
    if (ds.report_id) {
      await updateById('calling_reports', ds.report_id, {
        status: 'draft',
        quality_ack_at: null,
        quality_ack_hash: null,
        updated_at: new Date().toISOString(),
      });
    }
    return ok(data);
  });
}

// DELETE /api/calling-reports/datasets/[dsId]
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { dsId } = await params;
    const ds = await maybeOne<{ report_id: string | null }>(
      'select report_id from report_datasets where id = $1',
      [dsId]
    );
    await deleteById('report_datasets', dsId);
    if (ds?.report_id) {
      await updateById('calling_reports', ds.report_id, {
        status: 'draft',
        quality_ack_at: null,
        quality_ack_hash: null,
      });
    }
    return ok({ deleted: true });
  });
}
