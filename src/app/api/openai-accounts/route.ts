import { insertOne, sql } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { encrypt } from '@/lib/crypto';
import { creditState } from '@/lib/openai-credits';

export const runtime = 'nodejs';

// A key is stored encrypted and never returned. What the UI gets instead is
// `has_key` plus the non-secret `label` (last 4 characters), which is enough to
// tell WHICH key is configured without exposing it.
function keyLabel(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

// GET /api/openai-accounts -> accounts WITHOUT the key, plus client name and the
// derived credit state so the list needs no second round trip.
export async function GET() {
  return guard(async () => {
    const rows = await sql<any>(
      `select a.id, a.client_id, a.name, a.label, a.org_id, a.project_id,
              a.allocated_tokens, a.used_tokens, a.used_source,
              a.low_threshold_pct, a.critical_threshold_pct,
              a.status, a.alerted, a.last_alerted_at, a.low_since,
              a.alert_name, a.alert_phone,
              a.last_checked_at, a.last_check_error, a.created_at,
              a.credentials_encrypted is not null as has_key,
              coalesce(c.name, '—')  as client_name,
              c.alert_phone          as client_alert_phone
         from openai_accounts a
         left join clients c on c.id = a.client_id
        order by a.created_at desc`
    );
    return ok(
      rows.map((a) => {
        const s = creditState(a);
        return {
          ...a,
          allocated_tokens: Number(a.allocated_tokens),
          used_tokens: Number(a.used_tokens),
          remaining_tokens: s.remaining_tokens,
          remaining_pct: s.remaining_pct,
          budgeted: s.budgeted,
          // The number a message would actually go to, resolved the same way the
          // alerter resolves it: the account's own, else the client's.
          effective_phone: a.alert_phone || a.client_alert_phone || null,
        };
      })
    );
  });
}

// POST /api/openai-accounts
//   { client_id, name, api_key?, org_id?, project_id?, allocated_tokens?,
//     used_tokens?, low_threshold_pct?, critical_threshold_pct?,
//     alert_name?, alert_phone? }
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const { client_id, name } = body ?? {};
    if (!client_id || !name) return bad('client_id and name are required');

    const low = body.low_threshold_pct === undefined ? 25 : Number(body.low_threshold_pct);
    const critical = body.critical_threshold_pct === undefined ? 10 : Number(body.critical_threshold_pct);
    if (!Number.isFinite(low) || low < 0 || low > 100) return bad('low_threshold_pct must be between 0 and 100');
    if (!Number.isFinite(critical) || critical < 0 || critical > 100) {
      return bad('critical_threshold_pct must be between 0 and 100');
    }
    // Enforced here rather than only in the form: a critical threshold above the
    // low one would make the warning state unreachable.
    if (critical > low) return bad('critical_threshold_pct must be less than or equal to low_threshold_pct');

    const allocated = Number(body.allocated_tokens ?? 0);
    const used = Number(body.used_tokens ?? 0);
    if (!Number.isFinite(allocated) || allocated < 0) return bad('allocated_tokens must be 0 or more');
    if (!Number.isFinite(used) || used < 0) return bad('used_tokens must be 0 or more');

    const row: Record<string, unknown> = {
      client_id,
      name: String(name).trim(),
      org_id: body.org_id?.trim() || null,
      project_id: body.project_id?.trim() || null,
      allocated_tokens: Math.round(allocated),
      used_tokens: Math.round(used),
      low_threshold_pct: Math.round(low),
      critical_threshold_pct: Math.round(critical),
      alert_name: body.alert_name?.trim() || null,
      alert_phone: body.alert_phone?.trim() || null,
    };
    // Derive the status up front so an account added with usage already past a
    // threshold does not sit as Healthy until the first check runs.
    row.status = creditState({
      allocated_tokens: allocated,
      used_tokens: used,
      low_threshold_pct: low,
      critical_threshold_pct: critical,
    }).status;

    if (body.api_key && String(body.api_key).trim()) {
      const key = String(body.api_key).trim();
      try {
        row.credentials_encrypted = encrypt(key);
      } catch (e) {
        return bad(e instanceof Error ? e.message : 'encryption failed', 500);
      }
      row.label = keyLabel(key);
      // A stored key means usage can be pulled; the first check flips this to
      // 'api' on success and leaves it alone on failure.
      row.used_source = 'manual';
    }

    const saved = await insertOne<any>('openai_accounts', row);
    const { credentials_encrypted, ...safe } = saved;
    const state = creditState(safe);
    // bigint columns come back from node-postgres as strings; the client type
    // says number, so convert here exactly as GET does.
    return ok(
      {
        ...safe,
        allocated_tokens: Number(safe.allocated_tokens),
        used_tokens: Number(safe.used_tokens),
        has_key: !!credentials_encrypted,
        remaining_tokens: state.remaining_tokens,
        remaining_pct: state.remaining_pct,
        budgeted: state.budgeted,
      },
      201
    );
  });
}
