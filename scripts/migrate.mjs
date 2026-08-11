#!/usr/bin/env node
// Applies migrations/*.sql in numeric order, once each, tracked in
// schema_migrations. Replaces pasting SQL into a database console by hand.
//
//   npm run migrate                    apply everything pending
//   npm run migrate -- --dry           list what would run, change nothing
//   npm run migrate -- --list          show applied vs pending and exit
//   npm run migrate -- --if-configured apply, but exit 0 when there is no
//                                      DATABASE_URL at all
//
// `--if-configured` is what `npm run build` uses. A deploy is the only moment
// that reliably has both the new .sql files and the production DATABASE_URL in
// one place, so migrations run there rather than depending on someone
// remembering to point a laptop at production — that gap is what left a
// deployed build asking for `openai_accounts` on a database that never got it.
// An absent DATABASE_URL is not an error (a preview build or a bare `next build`
// has none and must still succeed); a DATABASE_URL that is set but unreachable
// or a migration that fails still exits non-zero and fails the build, because
// shipping code ahead of its schema is exactly the failure being fixed.
//
// Each file runs inside a transaction, so a failing migration leaves the
// database exactly as it was. The migrations are written to be idempotent
// anyway (create table if not exists, insert-if-absent seeds), so re-running
// one after clearing its row is safe.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'migrations');

// Load DATABASE_URL from the environment, else .env.local.
function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split(/\r?\n/)) {
        const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function sslConfig(cs) {
  try {
    const u = new URL(cs);
    if (u.searchParams.get('sslmode') === 'disable') return undefined;
    const local = ['localhost', '127.0.0.1', '::1', 'db'].includes(u.hostname);
    if (local && !u.searchParams.get('sslmode')) return undefined;
  } catch {
    return undefined;
  }
  return { rejectUnauthorized: false };
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const listOnly = args.includes('--list');
const ifConfigured = args.includes('--if-configured');

const cs = connectionString();
if (!cs) {
  if (ifConfigured) {
    console.log('[migrate] DATABASE_URL is not set — skipping migrations for this build.');
    process.exit(0);
  }
  console.error('DATABASE_URL is not set. Add it to .env.local or export it.');
  process.exit(1);
}

// Order by the numeric prefix, NOT by name. The base schema is `migration.sql`
// with no number and has to run first, but string collation sorts it after
// `migration_02_*.sql` (ICU de-prioritises the '.' vs '_' difference). An
// unnumbered file is therefore rank 0; anything unrecognised sorts last so a
// stray .sql cannot silently jump the queue.
function rank(f) {
  const m = /^migration(?:_(\d+))?[_.]/.exec(f);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return m[1] ? Number(m[1]) : 0;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

if (!files.length) {
  console.log('No .sql files in migrations/.');
  process.exit(0);
}

const client = new pg.Client({ connectionString: cs, ssl: sslConfig(cs) });

try {
  await client.connect();
} catch (e) {
  console.error(`Cannot connect to Postgres: ${e.message}`);
  console.error('Is the database running?  docker compose up -d');
  process.exit(1);
}

await client.query(`
  create table if not exists public.schema_migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  )
`);

const { rows } = await client.query('select filename from public.schema_migrations');
const applied = new Set(rows.map((r) => r.filename));
const pending = files.filter((f) => !applied.has(f));

if (listOnly) {
  for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'pending'}  ${f}`);
  await client.end();
  process.exit(0);
}

if (!pending.length) {
  console.log(`Up to date — ${files.length} migration(s) already applied.`);
  await client.end();
  process.exit(0);
}

console.log(`${pending.length} pending migration(s):`);
for (const f of pending) console.log(`  ${f}`);

if (dryRun) {
  console.log('\n--dry: nothing was applied.');
  await client.end();
  process.exit(0);
}

for (const f of pending) {
  const text = readFileSync(join(dir, f), 'utf8');
  process.stdout.write(`\napplying ${f} ... `);
  try {
    await client.query('begin');
    await client.query(text);
    await client.query('insert into public.schema_migrations (filename) values ($1)', [f]);
    await client.query('commit');
    console.log('ok');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.log('FAILED');
    console.error(`\n${f}: ${e.message}`);
    if (e.position) {
      // Point at the offending statement — a 260-line migration is otherwise
      // painful to debug from a bare error message.
      const upto = text.slice(0, Number(e.position));
      console.error(`  near line ${upto.split('\n').length}`);
    }
    console.error('\nRolled back. Nothing from this file was applied.');
    await client.end();
    process.exit(1);
  }
}

console.log('\nAll migrations applied.');
await client.end();
