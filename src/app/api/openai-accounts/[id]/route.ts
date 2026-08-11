import { deleteById, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { closeOrphanedIncidents } from '@/lib/alerts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// Fields an operator may edit — the same short list the add form collects.
// status / alerted / last_alerted_at / last_checked_at are NOT editable: they
// are owned by the checker in src/lib/openai-check.ts.
const FIELDS = ['name', 'alert_name', 'alert_phone', 'client_id'] as const;

function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/** Drop the ciphertext and say only whether a key is stored. */
function sanitize(row: any) {
  const { credentials_encrypted, ...rest } = row;
  return { ...rest, has_key: !!credentials_encrypted };
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
    return ok({ ...sanitize(row), effective_phone: row.alert_phone || row.client_alert_phone || null });
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
      } else {
        const v = body[f];
        patch[f] = typeof v === 'string' ? v.trim() || null : v;
      }
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

    if (!Object.keys(patch).length) return bad('Nothing to update.');

    patch.updated_at = new Date().toISOString();
    const saved = await updateById<any>('openai_accounts', id, patch);
    if (!saved) return bad('OpenAI account not found', 404);
    return ok(sanitize(saved));
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
