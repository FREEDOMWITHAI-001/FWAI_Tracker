import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { syncCloudAccount } from '@/lib/cloud-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/cloud-accounts/[id]/sync -> pull instances from the provider now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: acct, error } = await db
      .from('cloud_accounts')
      .select('id, client_id, provider, credentials_encrypted')
      .eq('id', id)
      .single();
    if (error) return bad(error.message, 404);
    try {
      const result = await syncCloudAccount(db, acct as any);
      return ok(result);
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'sync failed', 502);
    }
  });
}
