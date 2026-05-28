import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db.from('integrations').select('*').order('sort_order', { ascending: true });
    if (error) return bad(error.message, 500);
    return ok(data ?? []);
  });
}

export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.name) return bad('name is required');
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('integrations')
      .insert({
        name: body.name,
        detail: body.detail ?? '',
        status: body.status ?? 'healthy',
        sort_order: body.sort_order ?? 99,
      })
      .select()
      .single();
    if (error) return bad(error.message, 500);
    return ok(data, 201);
  });
}
