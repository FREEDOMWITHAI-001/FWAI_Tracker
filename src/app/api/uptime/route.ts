import { supabaseAdmin } from '@/lib/supabase';
import { ok, bad, guard } from '@/lib/api';

// Daily uptime % computed from the real check history (vm_metrics + app_metrics).
// uptime% for a day = checks that were reachable (status != 'down') / total checks.
// GET /api/uptime            -> fleet-wide (all VMs + apps)
// GET /api/uptime?client_id= -> only that client's VMs + apps
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const days = Number(url.searchParams.get('days')) || 14;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const db = supabaseAdmin();

    let vmq = db.from('vm_metrics').select('checked_at,status').gte('checked_at', cutoff).limit(50000);
    let apq = db.from('app_metrics').select('checked_at,status').gte('checked_at', cutoff).limit(50000);

    if (clientId) {
      const [{ data: vms }, { data: apps }] = await Promise.all([
        db.from('vms').select('id').eq('client_id', clientId),
        db.from('apps').select('id').eq('client_id', clientId),
      ]);
      const vmIds = (vms ?? []).map((v: any) => v.id);
      const appIds = (apps ?? []).map((a: any) => a.id);
      const none = '00000000-0000-0000-0000-000000000000';
      vmq = vmq.in('vm_id', vmIds.length ? vmIds : [none]);
      apq = apq.in('app_id', appIds.length ? appIds : [none]);
    }

    const [{ data: vm, error: e1 }, { data: ap, error: e2 }] = await Promise.all([vmq, apq]);
    if (e1) return bad(e1.message, 500);
    if (e2) return bad(e2.message, 500);

    const rows = [...(vm ?? []), ...(ap ?? [])] as { checked_at: string; status: string }[];

    const byDay = new Map<string, { up: number; total: number }>();
    for (const r of rows) {
      const day = r.checked_at.slice(0, 10);
      const e = byDay.get(day) ?? { up: 0, total: 0 };
      e.total++;
      if (r.status !== 'down') e.up++;
      byDay.set(day, e);
    }

    const series = [...byDay.keys()]
      .sort()
      .map((d) => {
        const e = byDay.get(d)!;
        return Math.round((e.up / e.total) * 1000) / 10; // one decimal place
      });

    return ok(series);
  });
}