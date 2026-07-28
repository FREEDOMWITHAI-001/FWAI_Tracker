import { maybeOne } from '@/lib/db';
import { bad, guard } from '@/lib/api';
import { renderWorkbook } from '@/lib/reports/xlsx';

export const runtime = 'nodejs';
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

// GET /api/calling-reports/[id]/export -> styled .xlsx
//
// Gated on the data-quality acknowledgement, and the gate is enforced HERE, not
// only in the UI — otherwise the rule is a suggestion.
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const r = await maybeOne<any>(
      `select r.id, r.name, r.status, r.result, r.quality,
              r.quality_ack_at, r.quality_ack_hash,
              coalesce(c.name, 'Client') as client_name
         from calling_reports r
         left join clients c on c.id = r.client_id
        where r.id = $1`,
      [id]
    );
    if (!r) return bad('Report not found', 404);

    if (r.status !== 'ready' || !r.result) return bad('Run the report before exporting it.', 409);
    if (!r.quality_ack_at) {
      return bad('Review and confirm the data-quality panel before exporting. Numbers do not leave here unseen.', 403);
    }
    if (r.quality?.hash && r.quality_ack_hash !== r.quality.hash) {
      return bad('The report was re-run after it was signed off. Review the data-quality panel again.', 403);
    }

    const buf = await renderWorkbook(r.result, r.quality, {
      client_name: r.client_name,
      report_name: r.name,
    });

    const safe = String(r.name).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 60) || 'report';
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
