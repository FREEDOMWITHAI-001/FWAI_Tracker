import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';

// Daily uptime % computed from the real check history (vm_metrics + app_metrics).
// uptime% for a day = checks that were reachable (status != 'down') / total checks.
// GET /api/uptime            -> fleet-wide (all VMs + apps)
// GET /api/uptime?client_id= -> only that client's VMs + apps
//
// The grouping happens in Postgres rather than in JS: the previous version
// pulled up to 50k raw sample rows per table just to bucket them by day, and
// silently truncated beyond that. Days are bucketed in UTC to match the
// timestamps the samples were written with.
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const days = Number(url.searchParams.get('days')) || 14;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    const params: unknown[] = [cutoff];
    let vmScope = '';
    let appScope = '';
    if (clientId) {
      params.push(clientId);
      vmScope = `and m.vm_id in (select id from vms where client_id = $2)`;
      appScope = `and m.app_id in (select id from apps where client_id = $2)`;
    }

    const rows = await sql<{ day: string; up: string; total: string }>(
      `select to_char(m.checked_at at time zone 'UTC', 'YYYY-MM-DD') as day,
              count(*)                                    as total,
              count(*) filter (where m.status <> 'down')   as up
         from (
              select checked_at, status, vm_id, null::uuid as app_id
                from vm_metrics m
               where checked_at >= $1 ${vmScope}
               union all
              select checked_at, status, null::uuid as vm_id, app_id
                from app_metrics m
               where checked_at >= $1 ${appScope}
         ) m
        group by 1
        order by 1`,
      params
    );

    // one decimal place, same as before
    const series = rows.map((r) => Math.round((Number(r.up) / Number(r.total)) * 1000) / 10);
    return ok(series);
  });
}
