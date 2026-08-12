#!/usr/bin/env node
// End-to-end test for the OpenAI project checker.
//
//   docker compose up -d
//   export DATABASE_URL=postgres://fwai:fwai_local_dev@localhost:5433/fwai
//   npm run migrate
//   OPENAI_API_BASE=http://127.0.0.1:3098 OPENAI_CHECK_MODEL=stub-model npx next build
//   node scripts/test-openai-check.mjs
//
// It runs against `next start`, not `next dev`, for two reasons: Next refuses to
// start a second dev server in a directory that already has one (so this cannot
// stomp on a developer's running app), and a production build is what actually
// ships. The stub therefore listens on a FIXED port that the build is told
// about, since Next may fold a server-side process.env read into the bundle.
//
// No framework, no dependencies beyond `pg` (already required by the app) — the
// same zero-dep style as scripts/migrate.mjs.
//
// WHAT IT ACTUALLY EXERCISES. It boots the real Next server with OPENAI_API_BASE
// pointed at a stub this process controls, then drives the real HTTP API. So the
// classification, the encryption, the WhatsApp path and the duplicate-alert rule
// are all tested through the code that runs in production, not a reimplementation
// of it. AI Sensy is pointed at the same stub, so an out-of-credit run sends a
// real HTTP request the test can count.
//
// The stub is also why no live OpenAI key or exhausted account is needed to test
// insufficient_quota — the one case that is otherwise impossible to reproduce on
// demand.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import pg from 'pg';

const DB = process.env.DATABASE_URL || 'postgres://fwai:fwai_local_dev@localhost:5433/fwai';
const APP_PORT = Number(process.env.TEST_APP_PORT) || 3099;
// Fixed, and must match the OPENAI_API_BASE the build was given.
const STUB_PORT = Number(process.env.TEST_STUB_PORT) || 3098;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const ENC_KEY = 'test-encryption-key-not-a-real-secret-abcdefgh';
// Production mode makes /api/cron/check-all refuse without this, which is the
// behaviour we want to keep exercising rather than work around.
const CRON_SECRET = 'test-cron-secret';

// The plaintext that must never appear in a response body, the database, or a log.
const SECRET_KEY = 'sk-proj-TESTSECRET0000000000000000deadbeef';

let failures = 0;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok   ${name}`);
  } catch (e) {
    failures++;
    results.push(`  FAIL ${name}\n         ${String(e.message).split('\n').join('\n         ')}`);
  }
}

// --- stub OpenAI + AI Sensy -------------------------------------------------
// One server plays both roles: /aisensy is WhatsApp, everything else is OpenAI.

let nextOpenAi = { status: 200, body: { choices: [{ message: { content: 'pong' } }] } };
let aisensyStatus = 200;
let hangNext = false;
let openAiDelayMs = 0; // widens the window so the concurrency test really races
const sent = [];
/** Destinations the stub should reject, for the partial-failure case. */
const aisensyFailFor = new Set();
let openAiHits = 0;

const stub = createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;

  if (req.url.startsWith('/aisensy')) {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = { unparseable: raw };
    }
    const rejected = aisensyStatus !== 200 || aisensyFailFor.has(body.destination);
    // Only successful deliveries are recorded as "sent" — a rejected one must
    // not count as a message the recipient received.
    if (!rejected) sent.push(body);
    res.writeHead(rejected ? 500 : 200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(rejected ? { error: 'stub failure' } : { success: true }));
  }

  openAiHits++;
  if (hangNext) return; // never respond — exercises the probe timeout
  if (openAiDelayMs) await new Promise((r) => setTimeout(r, openAiDelayMs));
  res.writeHead(nextOpenAi.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(nextOpenAi.body));
});

// --- helpers ----------------------------------------------------------------

async function req(method, path, body, headers) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep the raw text for the assertion message */
  }
  return { status: r.status, text, json };
}

async function waitFor(fn, what, ms = 120_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Wipe the alert episode so each scenario is judged on its own. */
async function resetEpisode(db, id) {
  await db.query('update openai_accounts set alerted = false, last_alerted_at = null where id = $1', [id]);
  await db.query('update openai_account_contacts set alerted_at = null where openai_account_id = $1', [id]);
  await db.query("update alerts set status = 'resolved' where source_kind = 'openai' and source_id = $1", [id]);
}

/** Make a project eligible for the next daily run: due, enabled, unclaimed. */
async function makeDue(db, id) {
  await db.query(
    `update openai_accounts
        set last_checked_at = null, check_claimed_at = null, daily_check_enabled = true
      where id = $1`,
    [id]
  );
}

/** Fire the once-daily scheduled run the way the Vercel cron does. */
const runDaily = () =>
  req('GET', '/api/cron/check-all?openai=daily', undefined, { authorization: `Bearer ${CRON_SECRET}` });

const row1 = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;

async function main() {
  stub.listen(STUB_PORT, '127.0.0.1');
  await once(stub, 'listening');
  const stubBase = `http://127.0.0.1:${STUB_PORT}`;
  console.log(`stub listening on ${stubBase}`);

  const db = new pg.Client({ connectionString: DB });
  await db.connect();

  // ---- schema -------------------------------------------------------------
  const cols = (
    await rows(db, `select column_name from information_schema.columns where table_name = 'openai_accounts'`)
  ).map((r) => r.column_name);

  await check('migration 21 drops every token-tracking column', () => {
    for (const dead of [
      'allocated_tokens',
      'used_tokens',
      'used_source',
      'low_threshold_pct',
      'critical_threshold_pct',
      'org_id',
      'project_id',
      'low_since',
    ]) {
      assert.ok(!cols.includes(dead), `column ${dead} still exists`);
    }
  });

  await check('the columns the checker needs are present', () => {
    for (const need of [
      'client_id',
      'name',
      'label',
      'credentials_encrypted',
      'alert_name',
      'status',
      'alerted',
      'last_alerted_at',
      'last_checked_at',
      'last_check_error',
      // added by migration 22
      'daily_check_enabled',
      'check_claimed_at',
    ]) {
      assert.ok(cols.includes(need), `column ${need} is missing`);
    }
  });

  await check('migration 22 moved recipients out to their own table', async () => {
    assert.ok(
      !cols.includes('alert_phone'),
      'openai_accounts.alert_phone still exists — recipients should live in openai_account_contacts'
    );
    const contactCols = (
      await rows(db, `select column_name from information_schema.columns where table_name = 'openai_account_contacts'`)
    ).map((r) => r.column_name);
    for (const need of ['openai_account_id', 'phone', 'alerted_at', 'created_at', 'updated_at']) {
      assert.ok(contactCols.includes(need), `openai_account_contacts.${need} is missing`);
    }
  });

  await check('the same number cannot be added to one project twice', async () => {
    const acct = await row1(db, 'select id from openai_accounts limit 1');
    if (!acct) return; // nothing seeded yet; the API-level test covers this too
    await assert.rejects(
      () =>
        db.query(
          `insert into openai_account_contacts (openai_account_id, phone)
           values ($1, '+91dupe'), ($1, '+91dupe')`,
          [acct.id]
        ),
      /openai_account_contacts_unique|duplicate key/
    );
  });

  const client = await row1(
    db,
    `insert into clients (name, alert_phone) values ('E2E Test Client', '+910000000001') returning id`
  );

  await check("status rejects the old 'healthy' value", async () => {
    await assert.rejects(
      () =>
        db.query(`insert into openai_accounts (client_id, name, status) values ($1, 'probe', 'healthy')`, [
          client.id,
        ]),
      /openai_accounts_status_check/
    );
  });

  await check('status defaults to CHECK_FAILED for a row inserted without one', async () => {
    const r = await row1(
      db,
      `insert into openai_accounts (client_id, name) values ($1, 'default-probe') returning status`,
      [client.id]
    );
    assert.equal(r.status, 'CHECK_FAILED');
    await db.query(`delete from openai_accounts where client_id = $1 and name = 'default-probe'`, [client.id]);
  });

  // ---- boot the app -------------------------------------------------------
  const server = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: DB,
      APP_ENCRYPTION_KEY: ENC_KEY,
      OPENAI_API_BASE: stubBase,
      OPENAI_CHECK_MODEL: 'stub-model',
      OPENAI_CHECK_TIMEOUT_MS: '3000',
      CRON_SECRET,
      // The in-process scheduler would fire its own checks mid-test and race
      // every assertion about how many messages were sent.
      SCHEDULER_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  try {
    await waitFor(async () => (await fetch(`${BASE}/api/clients`)).ok, 'the dev server');

    // AI Sensy, pointed at the stub. Saved through the app so its key is
    // encrypted with the same APP_ENCRYPTION_KEY the app will decrypt with.
    await req('PUT', '/api/settings/aisensy', {
      enabled: true,
      api_url: `${stubBase}/aisensy`,
      campaign: 'test_downtime',
      credits_campaign: 'test_credits',
      username: 'FWAI Test',
      threshold_min: 15,
      recovery: true,
      api_key: 'stub-aisensy-key',
    });

    // ---- create -----------------------------------------------------------
    const created = await req('POST', '/api/openai-accounts', {
      client_id: client.id,
      name: 'ABC Production',
      api_key: SECRET_KEY,
      alert_name: 'Ops Person',
      phones: ['+910000000002'],
    });

    await check('POST /api/openai-accounts creates the project', () => {
      assert.equal(created.status, 201, `got ${created.status}: ${created.text}`);
      assert.equal(created.json.name, 'ABC Production');
      assert.equal(created.json.has_key, true);
      assert.equal(created.json.status, 'CHECK_FAILED', 'a new project must start unchecked');
      assert.equal(created.json.daily_check_enabled, true, 'a new project must default to daily checking ON');
    });
    const id = created.json.id;
    assert.ok(id, 'no account was created — the rest of the test cannot run');

    // Every other project in this database is taken off the daily schedule, so
    // the OpenAI request counts below measure only the project under test. The
    // pre-migration "Legacy Project" in particular is enabled and has a
    // recipient, and would otherwise be claimed by every daily run here.
    await db.query('update openai_accounts set daily_check_enabled = false where id <> $1', [id]);

    await check('the create response exposes only a masked key hint', () => {
      assert.ok(!created.text.includes(SECRET_KEY), 'the raw key appeared in the create response');
      assert.ok(!created.text.includes('credentials_encrypted'), 'the ciphertext field was returned');
      assert.equal(created.json.label, 'sk-…beef');
    });

    await check('POST rejects a missing API key', async () => {
      const r = await req('POST', '/api/openai-accounts', { client_id: client.id, name: 'No key' });
      assert.equal(r.status, 400, `got ${r.status}: ${r.text}`);
      assert.match(r.json.error, /api key is required/i);
    });

    await check('the key is stored as ciphertext, not plaintext', async () => {
      const s = await row1(db, 'select credentials_encrypted from openai_accounts where id = $1', [id]);
      assert.ok(s.credentials_encrypted, 'nothing was stored');
      assert.ok(!s.credentials_encrypted.includes(SECRET_KEY), 'the key is in the database in plaintext');
      assert.match(s.credentials_encrypted, /^[A-Za-z0-9+/=]+$/, 'expected base64 ciphertext');
    });

    // ---- classification ---------------------------------------------------
    // The point of the feature: an HTTP status is not a verdict. 429 in
    // particular means two unrelated things.
    const cases = [
      ['2xx → CREDIT_AVAILABLE', { status: 200, body: { choices: [] } }, 'CREDIT_AVAILABLE', null],
      [
        '429 insufficient_quota → NO_CREDIT',
        { status: 429, body: { error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You exceeded your current quota' } } },
        'NO_CREDIT',
        /quota/i,
      ],
      [
        '429 rate_limit_exceeded → CHECK_FAILED, NOT NO_CREDIT',
        { status: 429, body: { error: { code: 'rate_limit_exceeded', type: 'requests', message: 'Rate limit reached for gpt-4o-mini' } } },
        'CHECK_FAILED',
        /rate limited.*not a credit problem/i,
      ],
      [
        '404 model_not_found → CHECK_FAILED naming OPENAI_CHECK_MODEL',
        { status: 404, body: { error: { code: 'model_not_found', message: 'The model does not exist or you do not have access to it' } } },
        'CHECK_FAILED',
        /OPENAI_CHECK_MODEL/,
      ],
      [
        '403 model permission denied → CHECK_FAILED, NOT NO_CREDIT',
        { status: 403, body: { error: { code: 'model_not_supported', message: 'Project does not have access to model' } } },
        'CHECK_FAILED',
        /OPENAI_CHECK_MODEL|not permitted/i,
      ],
      [
        '401 invalid_api_key → INVALID_KEY',
        { status: 401, body: { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } } },
        'INVALID_KEY',
        /incorrect api key/i,
      ],
      [
        '401 with no error code is still INVALID_KEY',
        { status: 401, body: {} },
        'INVALID_KEY',
        /HTTP 401/,
      ],
      ['500 → CHECK_FAILED', { status: 500, body: { error: { message: 'server had an error' } } }, 'CHECK_FAILED', /server had an error/],
      [
        'a quota-shaped MESSAGE without the code is NOT NO_CREDIT',
        { status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached, quota resets in 60s' } } },
        'CHECK_FAILED',
        /rate limited/i,
      ],
    ];

    for (const [name, stubResponse, expected, errPattern] of cases) {
      nextOpenAi = stubResponse;
      await resetEpisode(db, id);
      const r = await req('POST', `/api/openai-accounts/${id}/check`);
      const row = await row1(db, 'select status, last_check_error, last_checked_at from openai_accounts where id = $1', [id]);
      await check(name, () => {
        assert.equal(r.status, 200, `HTTP ${r.status}: ${r.text}`);
        assert.equal(r.json.status, expected, `response said ${r.json.status}`);
        assert.equal(row.status, expected, `database said ${row.status}`);
        assert.ok(row.last_checked_at, 'last_checked_at was not stamped');
        if (errPattern) assert.match(row.last_check_error ?? '', errPattern);
        else assert.equal(row.last_check_error, null);
        assert.ok(!r.text.includes(SECRET_KEY), 'the key leaked into the check response');
      });
    }

    await check('no response within the timeout → CHECK_FAILED', async () => {
      await resetEpisode(db, id);
      hangNext = true;
      const r = await req('POST', `/api/openai-accounts/${id}/check`);
      hangNext = false;
      assert.equal(r.json.status, 'CHECK_FAILED', `got ${r.json.status}`);
      assert.match(r.json.error ?? '', /no response within/i);
    });

    // ---- WhatsApp + duplicate suppression ---------------------------------
    const quota = {
      status: 429,
      body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } },
    };

    await resetEpisode(db, id);
    sent.length = 0;
    nextOpenAi = quota;
    await req('POST', `/api/openai-accounts/${id}/check`);

    await check('NO_CREDIT sends exactly one WhatsApp to the stored number', () => {
      assert.equal(sent.length, 1, `${sent.length} messages sent`);
      assert.equal(sent[0].destination, '910000000002', 'went to the wrong number');
      assert.equal(sent[0].campaignName, 'test_credits', 'did not use the credits template');
      assert.deepEqual(sent[0].templateParams.slice(0, 3), ['ABC Production', 'E2E Test Client', 'NO CREDIT']);
    });

    await check('the incident is logged and the episode is latched', async () => {
      const row = await row1(db, 'select alerted, last_alerted_at from openai_accounts where id = $1', [id]);
      const open = await rows(
        db,
        "select severity from alerts where source_kind = 'openai' and source_id = $1 and status = 'active'",
        [id]
      );
      assert.equal(row.alerted, true);
      assert.ok(row.last_alerted_at, 'last_alerted_at was not stamped');
      assert.equal(open.length, 1, `expected 1 active incident, got ${open.length}`);
      assert.equal(open[0].severity, 'critical');
    });

    await check('staying NO_CREDIT sends nothing further', async () => {
      await req('POST', `/api/openai-accounts/${id}/check`);
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 1, `${sent.length} messages after three consecutive NO_CREDIT checks`);
    });

    // NO_CREDIT -> CREDIT_AVAILABLE. Resolves and unlatches, and — unlike the VM
    // "BACK UP" path in src/lib/alerts.ts — sends NOTHING. Settings → recovery is
    // ON for this whole run (see the aisensy PUT above), so this also proves the
    // suppression is unconditional rather than an artefact of the config.
    await check('recovery resolves the incident and clears the episode', async () => {
      nextOpenAi = { status: 200, body: { choices: [] } };
      await req('POST', `/api/openai-accounts/${id}/check`);
      const row = await row1(db, 'select status, alerted, last_alerted_at from openai_accounts where id = $1', [id]);
      const open = await rows(
        db,
        "select 1 from alerts where source_kind = 'openai' and source_id = $1 and status = 'active'",
        [id]
      );
      assert.equal(row.status, 'CREDIT_AVAILABLE');
      assert.equal(row.alerted, false, 'alerted was not cleared');
      assert.equal(row.last_alerted_at, null);
      assert.equal(open.length, 0, 'the incident is still active');
    });

    const afterRecovery = sent.length;
    await check('NO_CREDIT → CREDIT_AVAILABLE sends NO recovery WhatsApp', () => {
      assert.equal(
        afterRecovery,
        1,
        `only the single NO_CREDIT alert should ever have been sent, got ${afterRecovery}: ` +
          JSON.stringify(sent.map((m) => m.templateParams?.[2]))
      );
      assert.ok(
        !sent.some((m) => m.templateParams?.[2] === 'CREDIT OK'),
        'a recovery message was sent despite suppression'
      );
    });

    await check('repeated CREDIT_AVAILABLE checks send nothing', async () => {
      nextOpenAi = { status: 200, body: { choices: [] } };
      await req('POST', `/api/openai-accounts/${id}/check`);
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, afterRecovery, 'a healthy project sent a WhatsApp');
    });

    await check('CREDIT_AVAILABLE → NO_CREDIT sends exactly one WhatsApp', async () => {
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, afterRecovery + 1, 'expected exactly one new message on relapse');
      assert.deepEqual(sent[sent.length - 1].templateParams.slice(0, 3), [
        'ABC Production',
        'E2E Test Client',
        'NO CREDIT',
      ]);
      // And it stays at one while it remains NO_CREDIT.
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, afterRecovery + 1, 'the relapse alert repeated');
    });

    await check('VM/app recovery messaging is untouched by the suppression', async () => {
      const src = await readFile('src/lib/alerts.ts', 'utf8');
      assert.match(
        src,
        /cfg\.recovery && phone\s*\?\s*await sendWhatsApp\(cfg, phone, who, \[t\.name, clientName, 'BACK UP', '0'\]\)/,
        'the VM/app "BACK UP" recovery send is no longer intact in src/lib/alerts.ts'
      );
    });

    await check('INVALID_KEY messages nobody', async () => {
      await resetEpisode(db, id);
      const before = sent.length;
      nextOpenAi = { status: 401, body: { error: { code: 'invalid_api_key', message: 'Incorrect API key' } } };
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, before, 'an invalid key sent a WhatsApp');
    });

    await check('CHECK_FAILED messages nobody', async () => {
      await resetEpisode(db, id);
      const before = sent.length;
      nextOpenAi = { status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'slow down' } } };
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, before, 'a failed check sent a WhatsApp');
    });

    // A failed delivery must NOT latch `alerted` — otherwise one bad minute at
    // AI Sensy silences the outage permanently.
    await check('a failed WhatsApp does not latch the episode', async () => {
      await resetEpisode(db, id);
      nextOpenAi = quota;
      aisensyStatus = 500;
      await req('POST', `/api/openai-accounts/${id}/check`);
      aisensyStatus = 200;
      const row = await row1(db, 'select alerted from openai_accounts where id = $1', [id]);
      const open = await rows(
        db,
        "select whatsapp_sent, whatsapp_error from alerts where source_kind = 'openai' and source_id = $1 and status = 'active'",
        [id]
      );
      assert.equal(row.alerted, false, 'alerted latched despite a failed send');
      assert.equal(open.length, 1, 'the incident was not recorded');
      assert.equal(open[0].whatsapp_sent, false);
      assert.ok(open[0].whatsapp_error, 'the delivery failure was not recorded on the row');
    });

    await check('the next cycle retries a failed delivery', async () => {
      const before = sent.length;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, before + 1, 'no retry after a failed send');
    });

    // ---- key never leaks ----------------------------------------------------
    await check('the API key appears in no response body', async () => {
      const list = await req('GET', '/api/openai-accounts');
      const one = await req('GET', `/api/openai-accounts/${id}`);
      const patched = await req('PATCH', `/api/openai-accounts/${id}`, { alert_name: 'Someone Else' });
      for (const [what, r] of [
        ['list', list],
        ['detail', one],
        ['patch', patched],
      ]) {
        assert.ok(!r.text.includes(SECRET_KEY), `the key leaked from the ${what} response`);
        assert.ok(!r.text.includes('credentials_encrypted'), `the ciphertext leaked from the ${what} response`);
      }
      assert.equal(list.json[0].has_key, true, 'has_key should still tell the UI a key is configured');
    });

    await check('the API key never reaches the server log', () => {
      assert.ok(!serverLog.includes(SECRET_KEY), 'the key was written to stdout/stderr');
    });

    // ---- unrelated functionality --------------------------------------------
    await check('the cron endpoint still rejects an unauthenticated caller', async () => {
      const r = await req('GET', '/api/cron/check-all');
      assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.text.slice(0, 200)}`);
    });

    await check('the shared cron endpoint still runs VM/app checks and the OpenAI pass', async () => {
      const r = await req('GET', '/api/cron/check-all', undefined, {
        authorization: `Bearer ${CRON_SECRET}`,
      });
      assert.equal(r.status, 200, `HTTP ${r.status}: ${r.text}`);
      assert.equal(r.json.alerts_evaluated, true, 'VM/app alert evaluation did not run');
      assert.equal(r.json.openai_ok, true, `openai pass failed: ${r.text}`);
      assert.ok('vms_checked' in r.json && 'apps_checked' in r.json, 'VM/app probing disappeared');
    });

    for (const path of ['/api/clients', '/api/vms', '/api/apps', '/api/alerts', '/api/uptime', '/api/settings']) {
      await check(`unrelated endpoint ${path} still returns 200`, async () => {
        const r = await req('GET', path);
        assert.equal(r.status, 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      });
    }

    // ---- multiple recipients ------------------------------------------------
    const THREE = ['+910000000002', '+910000000003', '+910000000004'];

    await check('a project can hold several numbers', async () => {
      const r = await req('PATCH', `/api/openai-accounts/${id}`, { phones: THREE });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json.phones, THREE);
      const list = await req('GET', '/api/openai-accounts');
      assert.deepEqual(list.json.find((a) => a.id === id).phones, THREE);
    });

    await check('NO_CREDIT messages every configured number exactly once', async () => {
      await resetEpisode(db, id);
      sent.length = 0;
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 3, `expected 3 messages, got ${sent.length}`);
      assert.deepEqual(
        sent.map((m) => m.destination).sort(),
        ['910000000002', '910000000003', '910000000004'],
        'the three configured numbers were not the ones messaged'
      );
      for (const m of sent) assert.equal(m.templateParams[2], 'NO CREDIT');
    });

    await check('staying NO_CREDIT re-messages nobody', async () => {
      await req('POST', `/api/openai-accounts/${id}/check`);
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 3, `${sent.length} messages after three consecutive NO_CREDIT checks`);
    });

    await check('recovery clears every recipient latch and sends nothing', async () => {
      nextOpenAi = { status: 200, body: { choices: [] } };
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 3, 'a recovery message was sent');
      const latched = await rows(
        db,
        'select 1 from openai_account_contacts where openai_account_id = $1 and alerted_at is not null',
        [id]
      );
      assert.equal(latched.length, 0, 'a recipient latch survived the recovery');
    });

    await check('a relapse messages all three again, once each', async () => {
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 6, `expected 3 more messages, total 6, got ${sent.length}`);
      assert.deepEqual(
        sent.slice(3).map((m) => m.destination).sort(),
        ['910000000002', '910000000003', '910000000004']
      );
    });

    await check('a removed number is not messaged again', async () => {
      await req('PATCH', `/api/openai-accounts/${id}`, { phones: THREE.slice(0, 2) });
      await resetEpisode(db, id);
      sent.length = 0;
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 2, `expected 2 messages after removing one number, got ${sent.length}`);
      assert.ok(
        !sent.some((m) => m.destination === '910000000004'),
        'the removed number was still messaged'
      );
      await req('PATCH', `/api/openai-accounts/${id}`, { phones: THREE }); // restore
    });

    await check('one failed delivery does not mark the episode done for everyone', async () => {
      await resetEpisode(db, id);
      sent.length = 0;
      aisensyFailFor.add('910000000003');
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`);

      assert.equal(sent.length, 2, `expected 2 delivered, got ${sent.length}`);
      const stillOwed = await rows(
        db,
        `select phone from openai_account_contacts
          where openai_account_id = $1 and alerted_at is null`,
        [id]
      );
      assert.deepEqual(
        stillOwed.map((r) => r.phone),
        ['+910000000003'],
        'the failed recipient should be the only one still owed a message'
      );
      const incident = await rows(
        db,
        "select whatsapp_sent, whatsapp_error from alerts where source_kind='openai' and source_id=$1 and status='active'",
        [id]
      );
      assert.equal(incident[0].whatsapp_sent, true, 'two recipients did receive it');
      assert.match(incident[0].whatsapp_error ?? '', /910000000003/, 'the failure was not recorded');
    });

    await check('the next check retries only the recipient that failed', async () => {
      aisensyFailFor.clear();
      sent.length = 0;
      await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(sent.length, 1, `expected only the failed recipient to be retried, got ${sent.length}`);
      assert.equal(sent[0].destination, '910000000003');
    });

    await check('a project keeps the number migrated from its old alert_phone', async () => {
      const legacy = await row1(
        db,
        `select a.id, k.phone from openai_accounts a
           join openai_account_contacts k on k.openai_account_id = a.id
          where a.name = 'Legacy Project'`
      );
      assert.ok(legacy, 'the pre-migration project lost its recipient');
      assert.equal(legacy.phone, '+919111100000');
    });

    // ---- daily-check toggle -------------------------------------------------
    await check('the daily run checks an enabled, due project', async () => {
      await resetEpisode(db, id);
      await makeDue(db, id);
      nextOpenAi = { status: 200, body: { choices: [] } };
      const r = await runDaily();
      assert.equal(r.json.openai_daily, true);
      assert.ok(r.json.openai_claimed >= 1, `nothing was claimed: ${r.text}`);
      const row = await row1(db, 'select status, last_checked_at from openai_accounts where id = $1', [id]);
      assert.equal(row.status, 'CREDIT_AVAILABLE');
      assert.ok(row.last_checked_at, 'last_checked_at was not stamped by the daily run');
    });

    await check('an already-checked project is not checked twice the same day', async () => {
      const before = openAiHits;
      await runDaily();
      assert.equal(openAiHits, before, 'a second daily run re-probed a project checked today');
    });

    await check('a disabled project is skipped by the daily run and never sent to OpenAI', async () => {
      await makeDue(db, id);
      await req('PATCH', `/api/openai-accounts/${id}`, { daily_check_enabled: false });
      sent.length = 0;
      const before = openAiHits;
      nextOpenAi = quota; // would alert loudly if it were checked
      const r = await runDaily();
      assert.equal(openAiHits, before, 'a disabled project was sent to OpenAI by the scheduled run');
      assert.equal(r.json.openai_claimed, 0, 'a disabled project was claimed');
      assert.equal(sent.length, 0, 'a disabled project produced a scheduled WhatsApp');
      const row = await row1(db, 'select status from openai_accounts where id = $1', [id]);
      assert.notEqual(row.status, 'NO_CREDIT', 'the disabled project’s status was changed by the scheduler');
    });

    await check('manual "Check now" still works on a disabled project', async () => {
      const before = openAiHits;
      nextOpenAi = { status: 200, body: { choices: [] } };
      const r = await req('POST', `/api/openai-accounts/${id}/check`);
      assert.equal(r.json.status, 'CREDIT_AVAILABLE', `manual check refused: ${r.text}`);
      assert.equal(openAiHits, before + 1, 'the manual check did not reach OpenAI');
      await req('PATCH', `/api/openai-accounts/${id}`, { daily_check_enabled: true }); // restore
    });

    // ---- schedule configuration --------------------------------------------
    await check('vercel.json declares exactly one daily cron at 09:00 Asia/Kolkata', async () => {
      const cfg = JSON.parse(await readFile('vercel.json', 'utf8'));
      assert.equal(cfg.crons.length, 1, `expected 1 cron entry, found ${cfg.crons.length}`);
      const [entry] = cfg.crons;
      assert.equal(entry.schedule, '30 3 * * *', `expected 03:30 UTC, got "${entry.schedule}"`);

      // Convert the expression to IST rather than trusting the comment.
      const [min, hour] = entry.schedule.split(' ');
      const istMinutes = Number(hour) * 60 + Number(min) + 330; // Asia/Kolkata = UTC+05:30
      assert.equal(
        `${String(Math.floor(istMinutes / 60)).padStart(2, '0')}:${String(istMinutes % 60).padStart(2, '0')}`,
        '09:00',
        'the cron expression does not land on 09:00 IST'
      );
      assert.match(entry.path, /openai=daily/, 'the daily cron does not carry the OpenAI trigger flag');
    });

    await check('the 5-minute Actions workflow cannot trigger an OpenAI check', async () => {
      const wf = await readFile('.github/workflows/monitor-cron.yml', 'utf8');
      assert.ok(
        !wf.includes('openai=daily'),
        'the 5-minute workflow now carries the daily-trigger flag, making it a second trigger'
      );

      // The bare path is exactly what that workflow calls.
      await makeDue(db, id);
      const before = openAiHits;
      const r = await req('GET', '/api/cron/check-all', undefined, {
        authorization: `Bearer ${CRON_SECRET}`,
      });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.openai_daily, false, 'the bare path claimed to be the daily trigger');
      assert.equal(openAiHits, before, 'the 5-minute poll sent a request to OpenAI');
      assert.ok('vms_checked' in r.json, 'the bare path stopped doing its VM work');
    });

    await check('due_since is the most recent 09:00 IST boundary', async () => {
      const r = await runDaily();
      const due = new Date(r.json.openai_due_since);
      assert.equal(due.getUTCHours(), 3, `expected 03:30 UTC, got ${due.toISOString()}`);
      assert.equal(due.getUTCMinutes(), 30);
      assert.ok(due.getTime() <= Date.now(), 'the boundary is in the future');
      assert.ok(Date.now() - due.getTime() < 86_400_000, 'the boundary is more than a day old');
    });

    await check('a project checked after the boundary is not due; before it, is', async () => {
      const { openai_due_since } = (await runDaily()).json;
      const boundary = new Date(openai_due_since).getTime();

      await db.query(
        'update openai_accounts set last_checked_at = $2, check_claimed_at = null where id = $1',
        [id, new Date(boundary + 60_000).toISOString()]
      );
      let before = openAiHits;
      await runDaily();
      assert.equal(openAiHits, before, 'a project checked after the boundary was re-checked');

      await db.query(
        'update openai_accounts set last_checked_at = $2, check_claimed_at = null where id = $1',
        [id, new Date(boundary - 60_000).toISOString()]
      );
      before = openAiHits;
      nextOpenAi = { status: 200, body: { choices: [] } };
      await runDaily();
      assert.equal(openAiHits, before + 1, 'a project last checked before the boundary was not re-checked');
    });

    // ---- concurrency --------------------------------------------------------
    await check('two simultaneous daily runs check the project only once', async () => {
      await resetEpisode(db, id);
      await makeDue(db, id);
      sent.length = 0;
      nextOpenAi = quota; // out of credit, so a double-check would double-alert too
      openAiDelayMs = 400; // hold the first probe open so the runs really overlap

      const before = openAiHits;
      const [a, b] = await Promise.all([runDaily(), runDaily()]);
      openAiDelayMs = 0;

      assert.equal(
        openAiHits - before,
        1,
        `the project was sent to OpenAI ${openAiHits - before} times by two concurrent runs`
      );
      assert.equal(
        (a.json.openai_claimed ?? 0) + (b.json.openai_claimed ?? 0),
        1,
        `exactly one invocation should have claimed it — got ${a.json.openai_claimed} and ${b.json.openai_claimed}`
      );
      assert.equal(sent.length, 3, `expected one message per recipient, got ${sent.length}`);
    });

    await check('an expired claim is reclaimed, so a crashed run loses nothing', async () => {
      await resetEpisode(db, id);
      await makeDue(db, id);
      // Simulate an invocation that claimed the project and then died: the claim
      // is present but older than the 10-minute lease.
      await db.query(
        "update openai_accounts set check_claimed_at = now() - interval '11 minutes' where id = $1",
        [id]
      );
      const before = openAiHits;
      nextOpenAi = { status: 200, body: { choices: [] } };
      await runDaily();
      assert.equal(openAiHits, before + 1, 'a project whose claim had expired was never retried');
    });

    await check('a live claim is respected', async () => {
      await makeDue(db, id);
      await db.query('update openai_accounts set check_claimed_at = now() where id = $1', [id]);
      const before = openAiHits;
      await runDaily();
      assert.equal(openAiHits, before, 'a project claimed seconds ago was checked by another run');
    });

    await check('deleting the project closes its incident', async () => {
      await resetEpisode(db, id);
      nextOpenAi = quota;
      await req('POST', `/api/openai-accounts/${id}/check`); // reopen one
      await req('DELETE', `/api/openai-accounts/${id}`);
      const stranded = await rows(
        db,
        "select 1 from alerts where source_kind = 'openai' and source_id = $1 and status = 'active'",
        [id]
      );
      assert.equal(stranded.length, 0, 'an active incident was left behind for a deleted project');
    });
  } finally {
    console.log('\n' + results.join('\n'));
    server.kill('SIGTERM');
    await db.query('delete from clients where id = $1', [client.id]).catch(() => {});
    await db.end().catch(() => {});
    stub.close();
  }

  console.log(`\n${results.length - failures}/${results.length} passed`);
  if (failures) {
    console.error(`${failures} FAILED`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
