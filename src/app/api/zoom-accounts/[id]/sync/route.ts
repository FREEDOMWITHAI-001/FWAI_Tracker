import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { syncZoomAccount, type ZoomAccountRow } from '@/lib/zoom';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/zoom-accounts/[id]/sync -> pull webinars/meetings from Zoom now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const acct = await maybeOne<ZoomAccountRow>(
      'select id, client_id, credentials_encrypted from zoom_accounts where id = $1',
      [id]
    );
    if (!acct) return bad('Zoom account not found', 404);
    try {
      const result = await syncZoomAccount(acct);
      return ok(result);
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'sync failed', 502);
    }
  });
}
