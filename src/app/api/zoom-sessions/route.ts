import { sql } from '@/lib/db';
import { ok, guard } from '@/lib/api';

export const runtime = 'nodejs';

// GET /api/zoom-sessions?client_id=&account_id=&kind=
// Synced Zoom webinars/meetings, newest first, with client name.
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const accountId = url.searchParams.get('account_id');
    const kind = url.searchParams.get('kind');

    const params: unknown[] = [];
    const where: string[] = [];
    if (clientId) {
      params.push(clientId);
      where.push(`s.client_id = $${params.length}`);
    }
    if (accountId) {
      params.push(accountId);
      where.push(`s.zoom_account_id = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      where.push(`s.kind = $${params.length}`);
    }

    const rows = await sql(
      `select s.*, coalesce(c.name, '—') as client_name
         from zoom_sessions s
         left join clients c on c.id = s.client_id
         ${where.length ? `where ${where.join(' and ')}` : ''}
        order by s.start_time desc nulls last
        limit 500`,
      params
    );
    return ok(rows);
  });
}
