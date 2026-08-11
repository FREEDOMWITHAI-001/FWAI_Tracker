import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

// A key is stored encrypted and never returned. What the UI gets instead is
// `has_key` plus the non-secret `label` (first 3 + last 4 characters), which is
// enough to tell WHICH key is configured without exposing it.
function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

// The columns the UI needs. Listed explicitly rather than `a.*` so
// credentials_encrypted cannot reach a response by accident.
const SELECT_SAFE = `
  select a.id, a.client_id, a.name, a.label, a.status, a.alerted, a.last_alerted_at,
         a.alert_name, a.alert_phone, a.last_checked_at, a.last_check_error, a.created_at,
         a.credentials_encrypted is not null as has_key,
         coalesce(c.name, '—') as client_name,
         c.alert_phone         as client_alert_phone
    from openai_accounts a
    left join clients c on c.id = a.client_id
`;

// GET /api/openai-accounts -> accounts WITHOUT the key, plus client name.
export async function GET() {
  return guard(async () => {
    const rows = await sql<any>(`${SELECT_SAFE} order by a.created_at desc`);
    return ok(
      rows.map((a) => ({
        ...a,
        // The number a message would actually go to, resolved the same way the
        // alerter resolves it: the account's own, else the client's.
        effective_phone: a.alert_phone || a.client_alert_phone || null,
      }))
    );
  });
}

// POST /api/openai-accounts
//   { client_id, name, api_key, alert_name?, alert_phone? }
//
// That is the whole form. No admin key, organization ID, OpenAI project ID,
// token allocation or threshold percentages — see migration 21 for why those
// were removed rather than made optional.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const client_id = body?.client_id;
    const name = String(body?.name ?? '').trim();
    const apiKey = String(body?.api_key ?? '').trim();

    if (!client_id) return bad('Pick a client.');
    if (!name) return bad('Project name is required.');
    // Required, not optional: the account exists to be checked, and there is
    // nothing to check without a key.
    if (!apiKey) return bad('An OpenAI project API key is required.');

    const row: Record<string, unknown> = {
      client_id,
      name,
      alert_name: body.alert_name?.trim() || null,
      alert_phone: body.alert_phone?.trim() || null,
      label: keyLabel(apiKey),
      // Unchecked until the first probe runs. `status` defaults to this in the
      // schema too; set explicitly so the row the client gets back says so.
      status: 'CHECK_FAILED',
    };

    try {
      row.credentials_encrypted = encrypt(apiKey);
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'encryption failed', 500);
    }

    const saved = await insertOne<any>('openai_accounts', row);
    const { credentials_encrypted, ...safe } = saved;
    return ok({ ...safe, has_key: !!credentials_encrypted }, 201);
  });
}
