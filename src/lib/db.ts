// Server-only Postgres access layer (node-postgres).
//
// Everything the app does goes through one DATABASE_URL, so moving between
// local Docker, a managed host, and a self-hosted VM is an env-var change and
// nothing more. Never import this into a client component.
//
// Connection sizing: on Vercel each serverless invocation gets its own module
// instance, so a large pool per instance would exhaust the server's
// max_connections. We keep the pool tiny and let the platform scale
// horizontally. Point DATABASE_URL at a pooler (PgBouncer / Neon pooled
// endpoint) in production.

import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// A bare `date` column must stay a 'YYYY-MM-DD' string.
//
// node-postgres would otherwise parse it into a JS Date at LOCAL midnight, so
// session_date '2026-07-25' becomes 2026-07-25T00:00:00+05:30 and serialises
// back to JSON as '2026-07-24T18:30:00Z' — a calendar day earlier. Every report
// keyed on session_date would silently shift. Keeping the raw string also
// matches what the API returned previously, so no client code has to change.
// (1082 = OID of `date`. timestamptz is left as a Date: it round-trips through
// JSON as ISO-8601, exactly as before.)
types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL;

if (!url) {
  // Warned, not thrown, so `next build` succeeds without env vars.
  console.warn(
    '[fwai-tracker] Missing DATABASE_URL. Copy .env.example to .env.local and fill it in.'
  );
}

// A local database never needs TLS; anything else almost always does, and
// managed providers commonly serve certs that a bare Node client will not
// chain-verify. `sslmode=disable` in the URL forces it off explicitly.
function sslConfig(connectionString: string) {
  let host = '';
  let sslmode = '';
  try {
    const u = new URL(connectionString);
    host = u.hostname;
    sslmode = u.searchParams.get('sslmode') ?? '';
  } catch {
    return undefined;
  }
  if (sslmode === 'disable') return undefined;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'db';
  if (isLocal && !sslmode) return undefined;
  return { rejectUnauthorized: false };
}

// Next.js recreates modules on hot reload; without a global the dev server
// leaks a pool per edit until Postgres refuses new connections.
const globalForDb = globalThis as unknown as { __fwaiPool?: Pool };

export function pool(): Pool {
  if (!url) {
    throw new Error('Postgres is not configured. Set DATABASE_URL in .env.local.');
  }
  if (!globalForDb.__fwaiPool) {
    globalForDb.__fwaiPool = new Pool({
      connectionString: url,
      ssl: sslConfig(url),
      max: Number(process.env.PGPOOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    // An idle client erroring out (server restart, pooler drop) must not take
    // the process down — the pool discards it and the next query reconnects.
    globalForDb.__fwaiPool.on('error', (e) => {
      console.error('[fwai-tracker] idle postgres client error:', e.message);
    });
  }
  return globalForDb.__fwaiPool;
}

// --- query helpers ---------------------------------------------------------

/** Run a query and return all rows. */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool().query<T>(text, params as never[]);
  return res.rows;
}

/** Exactly one row expected; throws when the query matched nothing. */
export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T> {
  const rows = await sql<T>(text, params);
  if (!rows.length) throw new Error('Not found');
  return rows[0];
}

/** Zero or one row; null when nothing matched. */
export async function maybeOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows.length ? rows[0] : null;
}

/** Run a statement and return the number of rows affected. */
export async function exec(text: string, params: unknown[] = []): Promise<number> {
  const res = await pool().query(text, params as never[]);
  return res.rowCount ?? 0;
}

/**
 * Run `fn` inside a transaction on a single dedicated client. Commits on
 * return, rolls back on throw. Use the passed client's `query` directly — the
 * module-level helpers above take their own connection from the pool and would
 * therefore run OUTSIDE the transaction.
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw e;
  } finally {
    client.release();
  }
}

// --- jsonb -----------------------------------------------------------------

/**
 * Wrap a value bound for a `jsonb` column.
 *
 * This is not optional sugar. node-postgres serialises a JS array into a
 * Postgres ARRAY literal (`{a,b}`), which a jsonb column rejects — so a bare
 * `['a','b']` bound to `headers jsonb` fails at runtime, while a plain object
 * happens to work. Passing every jsonb value through here removes that
 * asymmetry: Postgres casts the resulting text to jsonb from the column type.
 */
export function jsonb(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// --- identifier safety -----------------------------------------------------

// Table and column names cannot be parameterised, so anything interpolated
// into SQL text is checked against a strict allowlist pattern first. Every
// caller in this app passes literals, but a typo becoming an injection point
// is not a risk worth carrying.
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

// --- generic row builders --------------------------------------------------
//
// The overwhelming majority of writes in this app are a flat insert, a patch
// by id, or a delete by id. These three helpers keep that boilerplate out of
// the route handlers; anything with a WHERE clause worth reading is written as
// explicit SQL at the call site instead.

/** INSERT one row from an object, returning the inserted row. */
export async function insertOne<T extends QueryResultRow = QueryResultRow>(
  table: string,
  values: Record<string, unknown>
): Promise<T> {
  const cols = Object.keys(values);
  if (!cols.length) throw new Error(`insertOne(${table}) called with no columns`);
  const text =
    `insert into ${ident(table)} (${cols.map(ident).join(', ')}) ` +
    `values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  return one<T>(
    text,
    cols.map((c) => values[c])
  );
}

/** INSERT many rows sharing one column set, in a single statement. */
export async function insertMany(
  table: string,
  rows: Record<string, unknown>[],
  cols?: string[]
): Promise<number> {
  if (!rows.length) return 0;
  const columns = cols ?? Object.keys(rows[0]);
  if (!columns.length) throw new Error(`insertMany(${table}) called with no columns`);
  const params: unknown[] = [];
  const tuples = rows.map((r) => {
    const slots = columns.map((c) => {
      params.push(r[c] ?? null);
      return `$${params.length}`;
    });
    return `(${slots.join(', ')})`;
  });
  const text =
    `insert into ${ident(table)} (${columns.map(ident).join(', ')}) values ${tuples.join(', ')}`;
  return exec(text, params);
}

/** UPDATE one row by id from a patch object; null when the id does not exist. */
export async function updateById<T extends QueryResultRow = QueryResultRow>(
  table: string,
  id: string,
  patch: Record<string, unknown>
): Promise<T | null> {
  const cols = Object.keys(patch);
  if (!cols.length) return maybeOne<T>(`select * from ${ident(table)} where id = $1`, [id]);
  const sets = cols.map((c, i) => `${ident(c)} = $${i + 2}`);
  const text =
    `update ${ident(table)} set ${sets.join(', ')} where id = $1 returning *`;
  return maybeOne<T>(text, [id, ...cols.map((c) => patch[c])]);
}

/** DELETE one row by id; returns whether anything was removed. */
export async function deleteById(table: string, id: string): Promise<boolean> {
  const n = await exec(`delete from ${ident(table)} where id = $1`, [id]);
  return n > 0;
}

/**
 * INSERT ... ON CONFLICT (conflictCols) DO UPDATE, i.e. Supabase's `upsert`.
 * Pass `ignoreDuplicates` for DO NOTHING semantics. Returns the affected row,
 * which is null only for an ignored duplicate.
 */
export async function upsertOne<T extends QueryResultRow = QueryResultRow>(
  table: string,
  values: Record<string, unknown>,
  conflictCols: string[],
  opts: { ignoreDuplicates?: boolean } = {}
): Promise<T | null> {
  const cols = Object.keys(values);
  if (!cols.length) throw new Error(`upsertOne(${table}) called with no columns`);
  const updatable = cols.filter((c) => !conflictCols.includes(c));
  const action =
    opts.ignoreDuplicates || !updatable.length
      ? 'do nothing'
      : `do update set ${updatable.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
  const text =
    `insert into ${ident(table)} (${cols.map(ident).join(', ')}) ` +
    `values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ` +
    `on conflict (${conflictCols.map(ident).join(', ')}) ${action} returning *`;
  return maybeOne<T>(
    text,
    cols.map((c) => values[c])
  );
}

/** upsertOne for a batch of rows sharing one column set. */
export async function upsertMany(
  table: string,
  rows: Record<string, unknown>[],
  conflictCols: string[],
  opts: { ignoreDuplicates?: boolean } = {}
): Promise<number> {
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]);
  const updatable = columns.filter((c) => !conflictCols.includes(c));
  const action =
    opts.ignoreDuplicates || !updatable.length
      ? 'do nothing'
      : `do update set ${updatable.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
  const params: unknown[] = [];
  const tuples = rows.map((r) => {
    const slots = columns.map((c) => {
      params.push(r[c] ?? null);
      return `$${params.length}`;
    });
    return `(${slots.join(', ')})`;
  });
  const text =
    `insert into ${ident(table)} (${columns.map(ident).join(', ')}) values ${tuples.join(', ')} ` +
    `on conflict (${conflictCols.map(ident).join(', ')}) ${action}`;
  return exec(text, params);
}
