import { NextResponse } from 'next/server';

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
