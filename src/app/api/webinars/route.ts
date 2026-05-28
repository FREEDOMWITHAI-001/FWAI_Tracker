import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

interface StageInput {
  stage: string;
  triggered?: number;
  succeeded?: number;
  failed?: number;
}

// GET /api/webinars -> webinars with stages + client name, newest first
export async function GET() {
  return guard(async () => {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('webinars')
      .select('*, clients(name), webinar_stages(*)')
      .order('webinar_date', { ascending: false, nullsFirst: false });
    if (error) return bad(error.message, 500);
    const rows = (data ?? []).map((w: any) => ({
      ...w,
      client_name: w.clients?.name ?? '—',
      webinar_stages: (w.webinar_stages ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order),
    }));
    return ok(rows);
  });
}

// POST /api/webinars  { client_id, name, ..., stages: [{stage, triggered, succeeded, failed}] }
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.client_id) return bad('client_id is required');
    if (!body?.name) return bad('name is required');
    const db = supabaseAdmin();

    const { data: webinar, error } = await db
      .from('webinars')
      .insert({
        client_id: body.client_id,
        name: body.name,
        participants: body.participants ?? 0,
        reminders: body.reminders ?? 0,
        attendance: body.attendance ?? 0,
        webinar_date: body.webinar_date || null,
        status: body.status ?? 'healthy',
      })
      .select()
      .single();
    if (error) return bad(error.message, 500);

    const stages: StageInput[] = Array.isArray(body.stages) ? body.stages : [];
    if (stages.length) {
      const rows = stages
        .filter((s) => s.stage?.trim())
        .map((s, i) => ({
          webinar_id: webinar.id,
          stage: s.stage,
          triggered: Number(s.triggered) || 0,
          succeeded: Number(s.succeeded) || 0,
          failed: Number(s.failed) || 0,
          sort_order: i,
        }));
      if (rows.length) {
        const { error: se } = await db.from('webinar_stages').insert(rows);
        if (se) return bad(se.message, 500);
      }
    }
    return ok(webinar, 201);
  });
}
