import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { normalisePhones, replaceContacts } from '@/lib/openai-contacts';

export const runtime = 'nodejs';

// A key is stored encrypted and never returned. What the UI gets instead is
// `has_key` plus the non-secret `label` (first 3 + last 4 characters), which is
// enough to tell WHICH key is configured without exposing it.
function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

// The columns the UI needs. Listed explicitly rather than `a.*` so
// credentials_encrypted cannot reach a response by accident. Recipients come
// back as an aggregated array so the list needs no second round trip.
const SELECT_SAFE = `
  select a.id, a.client_id, a.name, a.label, a.status, a.alerted, a.last_alerted_at,
         a.alert_name, a.daily_check_enabled, a.last_checked_at, a.last_check_error, a.created_at,
         a.credentials_encrypted is not null as has_key,
         coalesce(c.name, '—') as client_name,
         c.alert_phone         as client_alert_phone,
         coalesce(
           (select array_agg(k.phone order by k.created_at asc)
              from openai_account_contacts k
             where k.openai_account_id = a.id),
           '{}'
         ) as phones
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
        // Who a message would actually go to, resolved the way the alerter
        // resolves it: the project's own numbers, else the client's one.
        effective_phones: a.phones?.length ? a.phones : a.client_alert_phone ? [a.client_alert_phone] : [],
      }))
    );
  });
}

// POST /api/openai-accounts
//   { client_id, name, api_key, alert_name?, phones?: string[], daily_check_enabled? }
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
    const phones = normalisePhones(body?.phones);
    const dailyCheck = body?.daily_check_enabled === undefined ? true : !!body.daily_check_enabled;

    if (!client_id) return bad('Pick a client.');
    if (!name) return bad('Project name is required.');
    // Required, not optional: the account exists to be checked, and there is
    // nothing to check without a key.
    if (!apiKey) return bad('An OpenAI project API key is required.');

    // A project on the automatic schedule with nowhere to send its alert is a
    // monitor that cannot report, so it is refused at the door — unless the
    // client has a number the alerter can fall back to.
    if (dailyCheck && !phones.length) {
      const client = await sql<{ alert_phone: string | null }>(
        'select alert_phone from clients where id = $1',
        [client_id]
      );
      if (!client[0]?.alert_phone) {
        return bad(
          'Add at least one WhatsApp number, or set an alert number on the client, before turning on automatic checking.'
        );
      }
    }

    const row: Record<string, unknown> = {
      client_id,
      name,
      alert_name: body.alert_name?.trim() || null,
      daily_check_enabled: dailyCheck,
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
    if (phones.length) await replaceContacts(saved.id, phones);
    const { credentials_encrypted, ...safe } = saved;
    return ok({ ...safe, has_key: !!credentials_encrypted, phones }, 201);
  });
}
