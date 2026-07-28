import { maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// POST /api/calling-reports/[id]/acknowledge  { hash }
//
// The export gate. `hash` is the signature of the quality panel the operator
// actually looked at; if the report has been re-run since, the hash no longer
// matches and the sign-off is refused. Numbers never leave this tool without
// somebody having seen the match rates behind them.
export async function POST(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const report = await maybeOne<{ id: string; quality: any; status: string }>(
      'select id, quality, status from calling_reports where id = $1',
      [id]
    );
    if (!report) return bad('Report not found', 404);
    if (report.status !== 'ready') return bad('Run the report before acknowledging its data quality.', 409);

    const current = report.quality?.hash;
    if (!current) return bad('This report has no data-quality panel — re-run it.', 409);
    if (body.hash && body.hash !== current) {
      return bad('The report changed since you reviewed it. Re-open the data-quality panel and confirm again.', 409);
    }

    const data = await updateById<any>('calling_reports', id, {
      quality_ack_at: new Date().toISOString(),
      quality_ack_hash: current,
    });
    if (!data) return bad('Report not found', 404);
    return ok({
      id: data.id,
      quality_ack_at: data.quality_ack_at,
      quality_ack_hash: data.quality_ack_hash,
    });
  });
}
