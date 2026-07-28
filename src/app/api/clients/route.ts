import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { rollupStatus, type Status, type ClientSummary } from '@/lib/types';

// GET /api/clients -> client list with derived status + project counts
export async function GET() {
  return guard(async () => {
    const data = await sql<any>(
      `select c.*,
              coalesce((select json_agg(json_build_object('status', a.status, 'uptime', a.uptime))
                          from apps a where a.client_id = c.id), '[]'::json) as apps
         from clients c
        order by c.name asc`
    );

    const summaries: ClientSummary[] = data.map((c: any) => {
      const apps = (c.apps ?? []) as { status: Status; uptime: number }[];
      const statuses = apps.map((a) => a.status);
      const healthy = statuses.filter((s) => s === 'healthy').length;
      const issues = apps.length - healthy;
      const avg =
        apps.length > 0
          ? Math.round((apps.reduce((s, a) => s + Number(a.uptime), 0) / apps.length) * 10) / 10
          : 0;
      const { apps: _drop, ...rest } = c;
      return {
        ...rest,
        project_count: apps.length,
        healthy_count: healthy,
        issue_count: issues,
        overall_status: apps.length ? rollupStatus(statuses) : 'healthy',
        avg_uptime: avg,
      };
    });
    return ok(summaries);
  });
}

// POST /api/clients -> create a client
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.name) return bad('Name is required');
    const data = await insertOne('clients', {
      name: body.name,
      industry: body.industry ?? null,
      alert_name: body.alert_name ?? null,
      alert_phone: body.alert_phone ?? null,
    });
    return ok(data, 201);
  });
}
