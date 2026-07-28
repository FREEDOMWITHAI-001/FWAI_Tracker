import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';
import { syncCloudAccount, type CloudAccountRow } from '@/lib/cloud-sync';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/cloud-accounts/sync-all -> sync every account (GET also works, for cron)
export async function POST() {
  return guard(async () => {
    const accts = await sql<CloudAccountRow>(
      'select id, client_id, provider, credentials_encrypted from cloud_accounts'
    );

    let imported = 0;
    const errors: { id: string; error: string }[] = [];
    for (const a of accts) {
      try {
        const r = await syncCloudAccount(a);
        imported += r.imported;
      } catch (e) {
        errors.push({ id: a.id, error: e instanceof Error ? e.message : 'sync failed' });
      }
    }
    return ok({ accounts: accts.length, imported, errors });
  });
}

export const GET = POST;
