import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Constant-time string comparison, so a caller cannot recover the secret by
 * measuring how long a wrong guess takes to be rejected. Length is compared
 * first because timingSafeEqual throws on a length mismatch; that leaks only the
 * length, which is not the secret.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authenticate a scheduled caller. Returns a response to send back when the
 * request must be refused, or null when the handler may proceed.
 *
 * SHARED BY EVERY /api/cron/* ROUTE, deliberately. There are two of them now —
 * the 5-minute VM/app tick and the OpenAI credit check — and both probe
 * infrastructure, send WhatsApp messages or spend OpenAI quota. Copying this
 * guard into each one is how the two drift until only one of them is safe.
 *
 * FAILS CLOSED in production. This logic once read `if (secret) { ...check... }`,
 * so forgetting to set CRON_SECRET did not merely weaken the endpoint — it
 * removed the check entirely and left the route open to anonymous callers. An
 * unset secret is now a 503 rather than an open door. Development is exempt so
 * `npm run dev` and local curl testing keep working without ceremony.
 */
export function requireCronSecret(req: Request, label: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[${label}] refused: CRON_SECRET is not set in this environment`);
      return bad('This endpoint requires CRON_SECRET to be configured on the server.', 503);
    }
    console.warn(`[${label}] CRON_SECRET is not set — running unauthenticated (development only)`);
    return null;
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !secretMatches(token, secret)) return bad('Unauthorized', 401);
  return null;
}

/**
 * Turn a thrown value into a message worth showing someone.
 *
 * `e.message` alone is not enough. Node wraps a failed connection attempt in an
 * AggregateError (one error per resolved address, IPv4 and IPv6) whose own
 * message is the EMPTY STRING — so a database that is simply not running used to
 * surface as `{"error":""}` on every endpoint, which tells an operator nothing
 * at all. The underlying causes carry the real text, so unwrap them.
 */
function messageOf(e: unknown): string {
  if (!(e instanceof Error)) return 'Unexpected error';
  // 42P01 = undefined_table. Postgres says only `relation "x" does not exist`,
  // which reads as a code bug; it is almost always code deployed ahead of its
  // schema, so the message says what to actually do about it.
  if ((e as { code?: string }).code === '42P01') {
    return `${e.message} — the database is missing this table. Run \`npm run migrate\` against it (a deploy now does this automatically).`;
  }
  if (e.message) return e.message;

  const nested = (e as AggregateError).errors;
  if (Array.isArray(nested)) {
    // Distinct causes only: an IPv4 and an IPv6 ECONNREFUSED are one fact.
    const seen = [...new Set(nested.map((x) => (x instanceof Error ? x.message : String(x))).filter(Boolean))];
    if (seen.length) return seen.join('; ');
  }
  if (e.cause instanceof Error && e.cause.message) return e.cause.message;
  return e.name || 'Unexpected error';
}

// Wrap a handler so thrown errors become clean 500s with a message.
export async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    const msg = messageOf(e);
    // Server-side too: a 500 with no trace in the log is just as hard to chase.
    console.error('[api]', msg);
    return bad(msg, 500);
  }
}
