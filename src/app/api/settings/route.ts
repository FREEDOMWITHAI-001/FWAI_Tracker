import { jsonb, sql, upsertOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';

// GET /api/settings -> { [key]: value }
export async function GET() {
  return guard(async () => {
    const rows = await sql<{ key: string; value: unknown }>('select * from app_settings');
    const map: Record<string, unknown> = {};
    for (const row of rows) map[row.key] = row.value;
    return ok(map);
  });
}

// PUT /api/settings  { key, value }  (upsert)
export async function PUT(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.key) return bad('key is required');
    const data = await upsertOne(
      'app_settings',
      { key: body.key, value: jsonb(body.value ?? {}), updated_at: new Date().toISOString() },
      ['key']
    );
    return ok(data);
  });
}
