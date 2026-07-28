#!/usr/bin/env node
// One-off data migration: Supabase REST -> the DATABASE_URL Postgres.
//
//   npm run db:import                 copy everything
//   npm run db:import -- --skip-metrics   skip vm_metrics/app_metrics history
//   npm run db:import -- --dry        report source/target counts, write nothing
//
// Safe to re-run: every insert is ON CONFLICT (pk) DO NOTHING, so rows already
// present are left untouched and nothing is duplicated.
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (still in
// .env.local) alongside DATABASE_URL. Run `npm run migrate` first so the target
// schema exists.
//
// Encrypted credential blobs are copied verbatim, so they keep working as long
// as APP_ENCRYPTION_KEY is unchanged.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function env(name) {
  if (process.env[name]) return process.env[name];
  for (const f of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split(/\r?\n/)) {
        const m = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`).exec(line);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = env('DATABASE_URL');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const skipMetrics = args.includes('--skip-metrics');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot read the source.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL — cannot reach the target.');
  process.exit(1);
}

// Parent-before-child, so every foreign key resolves as we go.
// `seq` marks a bigserial primary key whose sequence must be bumped afterwards.
const TABLES = [
  { name: 'clients', pk: 'id' },
  { name: 'integrations', pk: 'id' },
  { name: 'app_settings', pk: 'key' },
  { name: 'cloud_accounts', pk: 'id' },
  { name: 'zoom_accounts', pk: 'id' },
  { name: 'vms', pk: 'id' },
  { name: 'apps', pk: 'id' },
  { name: 'alerts', pk: 'id' },
  { name: 'webinars', pk: 'id' },
  { name: 'webinar_stages', pk: 'id' },
  { name: 'zoom_sessions', pk: 'id' },
  { name: 'vm_metrics', pk: 'id', seq: true, metrics: true },
  { name: 'app_metrics', pk: 'id', seq: true, metrics: true },
];

const PAGE = 1000; // PostgREST's default ceiling per request

async function fetchPage(table, from, to) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Range: `${from}-${to}`,
      'Range-Unit': 'items',
    },
  });
  if (res.status === 404 || res.status === 400) return null; // table absent in source
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: (() => {
    try {
      const u = new URL(DATABASE_URL);
      if (u.searchParams.get('sslmode') === 'disable') return undefined;
      if (['localhost', '127.0.0.1', '::1', 'db'].includes(u.hostname)) return undefined;
    } catch {
      return undefined;
    }
    return { rejectUnauthorized: false };
  })(),
});

try {
  await client.connect();
} catch (e) {
  console.error(`Cannot connect to the target Postgres: ${e.message}`);
  console.error('Is it running?  docker compose up -d');
  process.exit(1);
}

// Which columns exist in the target, and which of them are jsonb / arrays.
// Copying only the intersection means a source column dropped by a later
// migration is ignored instead of blowing up the insert.
async function targetColumns(table) {
  const { rows } = await client.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table]
  );
  const cols = new Map();
  for (const r of rows) cols.set(r.column_name, r.data_type);
  return cols;
}

let grandTotal = 0;
const summary = [];

for (const spec of TABLES) {
  if (spec.metrics && skipMetrics) {
    summary.push(`${spec.name}: skipped (--skip-metrics)`);
    continue;
  }

  const cols = await targetColumns(spec.name);
  if (!cols.size) {
    summary.push(`${spec.name}: no such table in target — skipped`);
    continue;
  }

  let offset = 0;
  let copied = 0;
  let sourceCount = 0;

  for (;;) {
    const page = await fetchPage(spec.name, offset, offset + PAGE - 1);
    if (page === null) {
      summary.push(`${spec.name}: not present in source — skipped`);
      break;
    }
    if (!page.length) break;
    sourceCount += page.length;

    if (!dryRun) {
      // Column set comes from the first row; PostgREST returns every column on
      // select=*, so it is stable across pages of the same table.
      const keys = Object.keys(page[0]).filter((k) => cols.has(k));
      const params = [];
      const tuples = page.map((row) => {
        const slots = keys.map((k) => {
          let v = row[k];
          const type = cols.get(k);
          // jsonb must be sent as text and cast; a bare JS array would
          // otherwise be serialised as a Postgres array literal and rejected.
          if ((type === 'jsonb' || type === 'json') && v !== null && typeof v === 'object') {
            v = JSON.stringify(v);
          }
          params.push(v ?? null);
          return `$${params.length}`;
        });
        return `(${slots.join(', ')})`;
      });
      const text =
        `insert into "${spec.name}" (${keys.map((k) => `"${k}"`).join(', ')}) ` +
        `values ${tuples.join(', ')} on conflict ("${spec.pk}") do nothing`;
      const res = await client.query(text, params);
      copied += res.rowCount ?? 0;
    }

    offset += page.length;
    if (page.length < PAGE) break;
    process.stdout.write(`\r  ${spec.name}: read ${offset}…`);
  }

  if (sourceCount) {
    process.stdout.write('\r');
    summary.push(
      dryRun
        ? `${spec.name}: ${sourceCount} row(s) in source`
        : `${spec.name}: ${copied} inserted / ${sourceCount} read`
    );
    grandTotal += copied;
  } else if (!summary.some((s) => s.startsWith(`${spec.name}:`))) {
    summary.push(`${spec.name}: empty`);
  }
}

// A bigserial sequence still points at 1 after explicit ids were inserted, so
// the next natural insert would collide. Realign it with the data.
if (!dryRun) {
  for (const spec of TABLES) {
    if (!spec.seq) continue;
    if (spec.metrics && skipMetrics) continue;
    await client
      .query(
        `select setval(pg_get_serial_sequence('public.${spec.name}', '${spec.pk}'),
                       coalesce((select max(${spec.pk}) from public.${spec.name}), 1))`
      )
      .catch(() => {}); // table may not exist / not actually serial
  }
}

console.log('\n' + summary.join('\n'));
console.log(dryRun ? '\n--dry: nothing was written.' : `\nDone — ${grandTotal} row(s) inserted.`);
await client.end();
