import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { renderWorkbook } from '@/lib/reports/xlsx';

export const runtime = 'nodejs';
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string; version: string }> };

// GET /api/calling-reports/[id]/versions/[version]          -> the full snapshot
// GET /api/calling-reports/[id]/versions/[version]?export=1 -> that version as .xlsx
//
// An old version is a historical record: it was signed off when it was current,
// so it stays exportable without re-acknowledging. The live export route keeps
// its own gate for the CURRENT numbers — that is the one that could still be
// re-run out from under the operator.
export async function GET(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id, version } = await params;
    const n = Number(version);
    if (!Number.isInteger(n) || n < 1) return bad('version must be a positive integer');

    const v = await maybeOne<any>(
      `select v.*, coalesce(c.name, 'Client') as client_name, r.name as report_name
         from report_versions v
         join calling_reports r on r.id = v.report_id
         left join clients c on c.id = r.client_id
        where v.report_id = $1 and v.version = $2`,
      [id, n]
    );
    if (!v) return bad(`Version ${n} not found for this report`, 404);

    if (new URL(req.url).searchParams.get('export') !== '1') {
      return ok(v);
    }

    if (!v.result) return bad('This version has no stored result to export.', 409);
    const buf = await renderWorkbook(v.result, v.quality, {
      client_name: v.client_name,
      report_name: `${v.report_name} (v${n})`,
    });
    const safe =
      String(`${v.report_name}_v${n}`).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60) || 'report';
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safe}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
