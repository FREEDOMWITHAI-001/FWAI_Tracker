import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };
const FIELDS = ['name', 'participants', 'reminders', 'attendance', 'webinar_date', 'status'] as const;

// PATCH /api/webinars/[id] — edits the webinar; if `stages` is provided,
// replaces the full stage set.
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const db = supabaseAdmin();

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f] === '' && f === 'webinar_date' ? null : body[f];
    if (Object.keys(patch).length) {
      const { error } = await db.from('webinars').update(patch).eq('id', id);
      if (error) return bad(error.message, 500);
    }

    if (Array.isArray(body.stages)) {
      await db.from('webinar_stages').delete().eq('webinar_id', id);
      const rows = body.stages
        .filter((s: any) => s.stage?.trim())
        .map((s: any, i: number) => ({
          webinar_id: id,
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
    return ok({ updated: true });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const db = supabaseAdmin();
    const { error } = await db.from('webinars').delete().eq('id', id);
    if (error) return bad(error.message, 500);
    return ok({ deleted: true });
  });
}
