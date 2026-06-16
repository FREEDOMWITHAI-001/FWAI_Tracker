import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';
import { syncZoomAccount } from '@/lib/zoom';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/zoom-accounts/[id]/sync -> pull webinars/meetings from Zoom now
export async function POST(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: acct, error } = await db
      .from('zoom_accounts')
      .select('id, client_id, credentials_encrypted')
      .eq('id', id)
      .single();
    if (error) return bad(error.message, 404);
    try {
      const result = await syncZoomAccount(db, acct as any);
      return ok(result);
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'sync failed', 502);
    }
  });
}
