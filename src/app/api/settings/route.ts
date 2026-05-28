import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

// GET /api/settings -> { [key]: value }
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db.from('app_settings').select('*');
    if (error) return bad(error.message, 500);
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[(row as any).key] = (row as any).value;
    return ok(map);
  });
}

// PUT /api/settings  { key, value }  (upsert)
export async function PUT(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.key) return bad('key is required');
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('app_settings')
      .upsert({ key: body.key, value: body.value ?? {}, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return bad(error.message, 500);
    return ok(data);
  });
}
