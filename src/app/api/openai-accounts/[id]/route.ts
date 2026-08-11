import { deleteById, maybeOne, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { creditState } from '@/lib/openai-credits';
import { closeOrphanedIncidents } from '@/lib/alerts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

// Fields an operator may edit. `used_tokens` is here on purpose: an account
// without an admin key tracks usage by hand, which is what used_source='manual'
// means. status / alerted / last_alerted_at are NOT editable — they are derived
// and owned by the checker and the alerter.
const FIELDS = [
  'name',
  'org_id',
  'project_id',
  'allocated_tokens',
  'used_tokens',
  'low_threshold_pct',
  'critical_threshold_pct',
  'alert_name',
  'alert_phone',
  'client_id',
] as const;

function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

function sanitize(row: any) {
  const { credentials_encrypted, ...rest } = row;
  const s = creditState(rest);
  return {
    ...rest,
    allocated_tokens: Number(rest.allocated_tokens),
    used_tokens: Number(rest.used_tokens),
    has_key: !!credentials_encrypted,
    remaining_tokens: s.remaining_tokens,
    remaining_pct: s.remaining_pct,
    budgeted: s.budgeted,
  };
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
      if (f === 'allocated_tokens' || f === 'used_tokens') {
        const n = Number(body[f]);
        if (!Number.isFinite(n) || n < 0) return bad(`${f} must be 0 or more`);
        patch[f] = Math.round(n);
      } else if (f === 'low_threshold_pct' || f === 'critical_threshold_pct') {
        const n = Number(body[f]);
        if (!Number.isFinite(n) || n < 0 || n > 100) return bad(`${f} must be between 0 and 100`);
        patch[f] = Math.round(n);
      } else if (f === 'name') {
        if (!String(body[f]).trim()) return bad('name cannot be empty');
        patch[f] = String(body[f]).trim();
      } else {
        const v = body[f];
        patch[f] = typeof v === 'string' ? v.trim() || null : v;
      }
    }

    // Validate and recompute against whatever the row will end up with, not just
    // what this request happened to include.
    const current = await maybeOne<any>(
      `select allocated_tokens, used_tokens, low_threshold_pct, critical_threshold_pct, project_id,
              credentials_encrypted is not null as has_key
         from openai_accounts where id = $1`,
      [id]
    );
    if (!current) return bad('OpenAI account not found', 404);
    const low = Number(patch.low_threshold_pct ?? current.low_threshold_pct);
    const critical = Number(patch.critical_threshold_pct ?? current.critical_threshold_pct);
    if (critical > low) return bad('Critical threshold must be less than or equal to the low threshold');

    // Same rule as POST, evaluated against what the row will BE after this patch
    // rather than what this request happened to mention: a stored admin key must
    // always be paired with a project id, or the usage pull silently becomes
    // organization-wide and stops being this account's number.
    const newKey = body.api_key === undefined ? '' : String(body.api_key ?? '').trim();
    const willHaveKey = newKey ? true : body.clear_api_key ? false : !!current.has_key;
    const willHaveProject =
      'project_id' in patch ? !!patch.project_id : !!current.project_id;
    if (willHaveKey && !willHaveProject) {
      return bad('An OpenAI project ID is required while an admin key is stored — usage is scoped per project.');
    }

    // `status` is a pure function of allocation, usage and the thresholds, so any
    // edit to those has to recompute it here. Leaving it to the next check would
    // show an account as Healthy while its own numbers say otherwise. The usage
    // *pull* remains the checker's job — this only re-derives from stored values.
    patch.status = creditState({
      allocated_tokens: patch.allocated_tokens ?? current.allocated_tokens,
      used_tokens: patch.used_tokens ?? current.used_tokens,
      low_threshold_pct: low,
      critical_threshold_pct: critical,
    }).status;

    // Only re-encrypt when a new key is actually supplied — the same rule the VM
    // editor uses for .pem keys, so "leave blank to keep" works here too.
    if (body.api_key !== undefined) {
      const key = newKey;
      if (key) {
        patch.credentials_encrypted = encrypt(key);
        patch.label = keyLabel(key);
        // A replaced key invalidates the provenance of the current figure: it was
        // read with the old credential (or typed by hand). It reverts to 'manual'
        // until the next successful pull proves otherwise.
        patch.used_source = 'manual';
      } else if (body.clear_api_key) {
        // Explicit removal: usage can no longer be pulled, so it reverts to manual.
        patch.credentials_encrypted = null;
        patch.label = null;
        patch.used_source = 'manual';
      }
    }

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
