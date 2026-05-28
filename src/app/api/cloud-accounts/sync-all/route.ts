import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { syncCloudAccount } from '@/lib/cloud-sync';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/cloud-accounts/sync-all -> sync every account (GET also works, for cron)
export async function POST() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data: accts, error } = await db
      .from('cloud_accounts')
      .select('id, client_id, provider, credentials_encrypted');
    if (error) return bad(error.message, 500);

    let imported = 0;
    const errors: { id: string; error: string }[] = [];
    for (const a of accts ?? []) {
      try {
        const r = await syncCloudAccount(db, a as any);
        imported += r.imported;
      } catch (e) {
        errors.push({ id: (a as any).id, error: e instanceof Error ? e.message : 'sync failed' });
      }
    }
    return ok({ accounts: accts?.length ?? 0, imported, errors });
  });
}

export const GET = POST;
