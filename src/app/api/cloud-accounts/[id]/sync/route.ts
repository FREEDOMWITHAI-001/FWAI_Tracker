import { maybeOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { syncCloudAccount, type CloudAccountRow } from '@/lib/cloud-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/cloud-accounts/[id]/sync -> pull instances from the provider now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const acct = await maybeOne<CloudAccountRow>(
      'select id, client_id, provider, credentials_encrypted from cloud_accounts where id = $1',
      [id]
    );
    if (!acct) return bad('Cloud account not found', 404);
    try {
      const result = await syncCloudAccount(acct);
      return ok(result);
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'sync failed', 502);
    }
  });
}
