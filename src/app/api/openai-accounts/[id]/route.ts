import { deleteById, maybeOne, sql, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { closeOrphanedIncidents } from '@/lib/alerts';
import { normalisePhones, replaceContacts } from '@/lib/openai-contacts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// Fields an operator may edit — the same short list the add form collects.
// status / alerted / last_alerted_at / last_checked_at / check_claimed_at are
// NOT editable: they are owned by the checker in src/lib/openai-check.ts.
// Recipients are not here either; they live in their own table and go through
// replaceContacts below.
const FIELDS = ['name', 'alert_name', 'client_id', 'daily_check_enabled'] as const;

function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/** Drop the ciphertext and say only whether a key is stored. */
function sanitize(row: any) {
  const { credentials_encrypted, ...rest } = row;
  return { ...rest, has_key: !!credentials_encrypted };
}

async function phonesFor(id: string): Promise<string[]> {
  const rows = await sql<{ phone: string }>(
    'select phone from openai_account_contacts where openai_account_id = $1 order by created_at asc',
    [id]
  );
  return rows.map((r) => r.phone);
}

// GET /api/openai-accounts/[id] -> one account (no key), with its client name
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const row = await maybeOne<any>(
      `select a.*, coalesce(c.name, '—') as client_name, c.alert_phone as client_alert_phone
         from openai_accounts a
         left join clients c on c.id = a.client_id
        where a.id = $1`,
      [id]
    );
    if (!row) return bad('OpenAI account not found', 404);
    const phones = await phonesFor(id);
    return ok({
      ...sanitize(row),
      phones,
      effective_phones: phones.length ? phones : row.client_alert_phone ? [row.client_alert_phone] : [],
    });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (body[f] === undefined) continue;
      if (f === 'name') {
        if (!String(body[f]).trim()) return bad('Project name cannot be empty.');
        patch[f] = String(body[f]).trim();
      } else if (f === 'daily_check_enabled') {
        patch[f] = !!body[f];
      } else {
        const v = body[f];
        patch[f] = typeof v === 'string' ? v.trim() || null : v;
      }
    }

    // Recipients, when the caller sent a list at all. Omitting `phones` leaves
    // them untouched, so the row-level daily-check toggle can PATCH on its own.
    const phones = body.phones === undefined ? null : normalisePhones(body.phones);

    // Same rule as create, evaluated against what the row will BE after this
    // patch rather than what this request happened to mention.
    const existing = await maybeOne<any>(
      `select a.client_id, a.daily_check_enabled, c.alert_phone as client_alert_phone,
              (select count(*) from openai_account_contacts k where k.openai_account_id = a.id) as contact_count
         from openai_accounts a
         left join clients c on c.id = a.client_id
        where a.id = $1`,
      [id]
    );
    if (!existing) return bad('OpenAI account not found', 404);

    const willBeEnabled =
      patch.daily_check_enabled === undefined ? existing.daily_check_enabled : !!patch.daily_check_enabled;
    const willHavePhones = phones === null ? Number(existing.contact_count) > 0 : phones.length > 0;
    if (willBeEnabled && !willHavePhones && !existing.client_alert_phone) {
      return bad(
        'Add at least one WhatsApp number, or set an alert number on the client, before turning on daily checking.'
      );
    }

    // Only re-encrypt when a new key is actually supplied, so "leave blank to
    // keep the saved one" works — the same rule the VM editor uses for .pem
    // keys. There is no way to CLEAR the key: an account with no key cannot be
    // checked, which is the only thing an account is for. Remove it instead.
    const newKey = String(body.api_key ?? '').trim();
    if (newKey) {
      patch.credentials_encrypted = encrypt(newKey);
      patch.label = keyLabel(newKey);
      // A replaced key invalidates the last verdict — it was reached with a
      // different credential. Reset to unchecked and clear the alert state so a
      // new key that is also out of credit alerts again rather than being
      // suppressed by the old key's episode.
      patch.status = 'CHECK_FAILED';
      patch.last_checked_at = null;
      patch.last_check_error = null;
      patch.alerted = false;
      patch.last_alerted_at = null;
    }

    if (!Object.keys(patch).length && phones === null) return bad('Nothing to update.');

    if (phones !== null) await replaceContacts(id, phones);

    if (!Object.keys(patch).length) {
      // A recipients-only edit; nothing on the account row itself changed.
      const row = await maybeOne<any>('select * from openai_accounts where id = $1', [id]);
      return ok({ ...sanitize(row), phones });
    }

    patch.updated_at = new Date().toISOString();
    const saved = await updateById<any>('openai_accounts', id, patch);
    if (!saved) return bad('OpenAI account not found', 404);
    return ok({ ...sanitize(saved), phones: phones ?? (await phonesFor(id)) });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    await deleteById('openai_accounts', id);
    // Close its open incident now rather than leaving it stranded on the Alerts
    // page until the next scheduler pass sweeps it.
    await closeOrphanedIncidents();
    return ok({ deleted: true });
  });
}
