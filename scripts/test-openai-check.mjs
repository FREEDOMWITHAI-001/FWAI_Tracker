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

/**
 * Make a project eligible for the next scheduled run: enabled and unclaimed.
 *
 * Clearing the claim is the whole of it, and it is also how the test simulates
 * the passage of time between two of the four daily runs. There is no due-date
 * to reset — last_checked_at gates nothing.
 */
async function makeReady(db, id) {
  await db.query(
    'update openai_accounts set check_claimed_at = null, daily_check_enabled = true where id = $1',
    [id]
  );
}

/**
 * One tick of the 5-minute VM monitoring cron — byte-for-byte the request
 * .github/workflows/monitor-cron.yml makes. It must do NO OpenAI work.
 */
const vmTick = () =>
  req('GET', '/api/cron/check-all', undefined, { authorization: `Bearer ${CRON_SECRET}` });

/**
 * One scheduled OpenAI run — byte-for-byte the request the cron-job.org job
 * makes four times a day (10:00, 13:00, 18:00, 22:00 Asia/Kolkata).
 */
const openaiRun = () =>
  req('GET', '/api/cron/openai', undefined, { authorization: `Bearer ${CRON_SECRET}` });

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
    // Both scheduled endpoints go through the same guard (requireCronSecret in
    // src/lib/api.ts), so both are checked — a route that forgot to call it
    // would be an open door onto billable work.
    await check('the VM cron endpoint rejects an unauthenticated caller', async () => {
      const r = await req('GET', '/api/cron/check-all');
      assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.text.slice(0, 200)}`);
    });

    await check('the OpenAI cron endpoint rejects an unauthenticated caller', async () => {
      const r = await req('GET', '/api/cron/openai');
      assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.text.slice(0, 200)}`);
    });

    await check('the OpenAI cron endpoint rejects a wrong secret', async () => {
      const r = await req('GET', '/api/cron/openai', undefined, { authorization: 'Bearer wrong-secret' });
      assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.text.slice(0, 200)}`);
    });

    await check('the VM cron endpoint still runs VM/app checks', async () => {
      const r = await vmTick();
      assert.equal(r.status, 200, `HTTP ${r.status}: ${r.text}`);
      assert.equal(r.json.alerts_evaluated, true, 'VM/app alert evaluation did not run');
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

    // Upgrade path: a project that predates migration 22 must keep its single
    // alert_phone as a recipient. Reproduced by restoring the pre-22 shape and
    // replaying the migration file VERBATIM off disk — the same bytes that run
    // in production — so this stays repeatable rather than depending on
    // whatever happens to be left in the database.
    await check('migration 22 carries an old alert_phone across to the contacts table', async () => {
      const sqlText = await readFile('migrations/migration_22_openai_contacts_and_daily_check.sql', 'utf8');

      await db.query('alter table openai_accounts add column if not exists alert_phone text');
      const legacy = await row1(
        db,
        `insert into openai_accounts
           (client_id, name, status, alert_name, alert_phone, alerted, last_alerted_at)
         values ($1, 'Pre-22 Project', 'NO_CREDIT', 'Legacy Ops', '+919111100000', true, now() - interval '2 hours')
         returning id`,
        [client.id]
      );

      await db.query(sqlText); // the real migration, unmodified

      const moved = await rows(
        db,
        'select phone, alerted_at from openai_account_contacts where openai_account_id = $1',
        [legacy.id]
      );
      assert.equal(moved.length, 1, 'the pre-migration number was not carried across');
      assert.equal(moved[0].phone, '+919111100000');
      assert.ok(
        moved[0].alerted_at,
        'the episode latch was not carried across — the contact would be messaged again for an incident they already know about'
      );

      const cols22 = (
        await rows(db, `select column_name from information_schema.columns where table_name = 'openai_accounts'`)
      ).map((r) => r.column_name);
      assert.ok(!cols22.includes('alert_phone'), 'migration 22 left alert_phone behind');

      const enabled = await row1(db, 'select daily_check_enabled from openai_accounts where id = $1', [legacy.id]);
      assert.equal(enabled.daily_check_enabled, true, 'an existing project must keep being checked by default');

      await db.query('delete from openai_accounts where id = $1', [legacy.id]);
    });

    await check('replaying migration 22 a second time changes nothing', async () => {
      const sqlText = await readFile('migrations/migration_22_openai_contacts_and_daily_check.sql', 'utf8');
      await db.query(sqlText);
      const still = await rows(
        db,
        'select phone from openai_account_contacts where openai_account_id = $1 order by phone',
        [id]
      );
      assert.equal(still.length, 3, `re-running the migration disturbed the recipients: ${still.length}`);
    });

    // ---- the scheduled OpenAI run -------------------------------------------
    await check('a scheduled run checks an enabled, unclaimed project', async () => {
      await resetEpisode(db, id);
      await makeReady(db, id);
      nextOpenAi = { status: 200, body: { choices: [] } };
      const r = await openaiRun();
      assert.ok(r.json.openai_claimed >= 1, `nothing was claimed: ${r.text}`);
      const row = await row1(db, 'select status, last_checked_at from openai_accounts where id = $1', [id]);
      assert.equal(row.status, 'CREDIT_AVAILABLE');
      assert.ok(row.last_checked_at, 'last_checked_at was not stamped by the scheduled run');
    });

    // THE SPEND CAP. Whoever holds the cron-job.org account can change the
    // schedule without touching this repository, so the ceiling on billable
    // requests has to live in the code. A second call moments later must cost
    // nothing at all.
    await check('a second run inside the check interval does not re-probe', async () => {
      const before = openAiHits;
      await openaiRun();
      assert.equal(openAiHits, before, 'a run moments after the last one re-probed OpenAI');
    });

    // The real cadence: the four daily runs are at least 3 hours apart
    // (10:00 -> 13:00), against a 60-minute claim. Aging the claim by 3 hours is
    // exactly that gap, so this fails if MIN_CHECK_INTERVAL_MS is ever raised
    // past the schedule and starts swallowing the 13:00 run.
    await check('the next scheduled run, 3 hours later, probes again', async () => {
      await db.query(
        "update openai_accounts set check_claimed_at = now() - interval '3 hours' where id = $1",
        [id]
      );
      const before = openAiHits;
      nextOpenAi = { status: 200, body: { choices: [] } };
      await openaiRun();
      assert.equal(openAiHits, before + 1, 'the project was not re-probed at the next scheduled time');
    });

    await check('a disabled project is skipped by the scheduled run and never sent to OpenAI', async () => {
      await makeReady(db, id);
      await req('PATCH', `/api/openai-accounts/${id}`, { daily_check_enabled: false });
      sent.length = 0;
      const before = openAiHits;
      nextOpenAi = quota; // would alert loudly if it were checked
      const r = await openaiRun();
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
    // Vercel validates vercel.json with additionalProperties:false and rejects
    // the whole DEPLOYMENT — before the build — on an unknown top-level key.
    // That is not reproducible by `npm run build`, which is how a "$comment"
    // key shipped and broke a preview deploy while every local check passed.
    await check('vercel.json uses only top-level keys Vercel accepts', async () => {
      const cfg = JSON.parse(await readFile('vercel.json', 'utf8'));
      const ALLOWED = new Set([
        '$schema', 'alias', 'build', 'builds', 'cleanUrls', 'crons', 'env', 'functions', 'git',
        'github', 'headers', 'images', 'installCommand', 'buildCommand', 'devCommand',
        'outputDirectory', 'framework', 'ignoreCommand', 'name', 'public', 'redirects', 'regions',
        'rewrites', 'routes', 'trailingSlash',
      ]);
      const unknown = Object.keys(cfg).filter((k) => !ALLOWED.has(k));
      assert.deepEqual(
        unknown,
        [],
        `Vercel rejects vercel.json outright for unknown top-level keys: ${unknown.join(', ')}. ` +
          'JSON has no comments — put the explanation in the code the config refers to.'
      );
    });

    // Vercel's Hobby plan rejects any cron expression that would run more than
    // once a day — that is what forced the 5-minute cadence onto GitHub Actions
    // in the first place. This entry is only a VM/app backstop for the days
    // Actions is disabled or down, so what matters is that it stays deployable,
    // not when it lands. It must NOT point at the OpenAI endpoint: that would
    // add a fifth, unpredictably-timed billable run to the four scheduled ones.
    await check('vercel.json declares one Hobby-legal daily cron on the VM path', async () => {
      const cfg = JSON.parse(await readFile('vercel.json', 'utf8'));
      assert.equal(cfg.crons.length, 1, `expected 1 cron entry, found ${cfg.crons.length}`);
      const [entry] = cfg.crons;
      assert.equal(entry.path, '/api/cron/check-all', `unexpected cron path "${entry.path}"`);

      // A fixed minute and hour is exactly "once per day". A '*' or a step in
      // either field runs more often and fails the deployment outright.
      const [min, hour] = entry.schedule.split(' ');
      assert.match(min, /^\d+$/, `Hobby rejects a non-fixed minute: "${entry.schedule}"`);
      assert.match(hour, /^\d+$/, `Hobby rejects a non-fixed hour: "${entry.schedule}"`);
    });

    // THE ISOLATION GUARD, and the most important test in this file.
    //
    // The 5-minute workflow fires 288 times a day. If the OpenAI check is ever
    // reattached to it — by a query flag, a second curl, or a call added back to
    // the route — that is 288 billable requests per project per day. It has
    // happened once already. This fails the moment it happens again.
    await check('the 5-minute Actions workflow performs no OpenAI work', async () => {
      const wf = await readFile('.github/workflows/monitor-cron.yml', 'utf8');

      // Comments are stripped before the URL assertions: the header explains at
      // length why the OpenAI endpoint is NOT called here, and a naive substring
      // search would read that explanation as the thing it warns against. What
      // matters is what the workflow executes.
      const code = wf
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');

      assert.match(code, /\*\/5 \* \* \* \*/, 'the monitoring workflow is no longer on a 5-minute schedule');
      assert.match(code, /\/api\/cron\/check-all"/, 'the workflow no longer calls the check-all path');
      assert.ok(
        !code.includes('/api/cron/openai'),
        'the 5-minute workflow now calls the OpenAI endpoint — that is 288 billable requests a day'
      );

      // The request below is byte-for-byte what that workflow sends, against a
      // project that is enabled, unclaimed and would otherwise be probed.
      await resetEpisode(db, id);
      await makeReady(db, id);
      const before = openAiHits;
      nextOpenAi = quota; // would alert loudly if it were checked
      sent.length = 0;
      const r = await vmTick();
      assert.equal(r.status, 200, r.text);
      assert.equal(openAiHits, before, 'the 5-minute VM tick sent a request to OpenAI');
      assert.equal(sent.length, 0, 'the 5-minute VM tick produced a WhatsApp');
      assert.ok(!('openai_checked' in r.json), 'the VM tick still reports OpenAI work');
      assert.ok('vms_checked' in r.json, 'the tick stopped doing its VM work');
    });

    await check('the OpenAI endpoint does no VM work', async () => {
      await makeReady(db, id);
      nextOpenAi = { status: 200, body: { choices: [] } };
      const r = await openaiRun();
      assert.equal(r.status, 200, r.text);
      assert.ok('openai_checked' in r.json, 'the OpenAI endpoint reported no OpenAI work');
      assert.ok(
        !('vms_checked' in r.json) && !('apps_checked' in r.json),
        'the OpenAI endpoint is probing VMs — it must stay independent of the monitoring tick'
      );
    });

    // ---- check frequency is not alert frequency -----------------------------
    // The requirement in one test: probe on all four daily runs, message once
    // per episode. Three consecutive runs stand in for 10:00, 13:00 and 18:00.
    await check('three consecutive no-credit runs send exactly one round of WhatsApps', async () => {
      await resetEpisode(db, id);
      sent.length = 0;
      const before = openAiHits;

      for (let i = 0; i < 3; i++) {
        await makeReady(db, id); // stand in for the hours between scheduled runs
        nextOpenAi = quota;
        await openaiRun();
      }

      assert.equal(openAiHits - before, 3, 'the project was not probed on every scheduled run');
      assert.equal(
        sent.length,
        3,
        `expected one message per recipient (3 recipients, one episode), got ${sent.length} — ` +
          'the per-recipient latch is no longer suppressing repeat alerts'
      );
    });

    await check('recovery then relapse alerts a second time', async () => {
      sent.length = 0;

      await makeReady(db, id);
      nextOpenAi = { status: 200, body: { choices: [] } }; // recovered
      await openaiRun();
      assert.equal(sent.length, 0, 'recovery sent a message; it must be silent');
      const cleared = await rows(
        db,
        'select alerted_at from openai_account_contacts where openai_account_id = $1',
        [id]
      );
      assert.ok(
        cleared.every((c) => c.alerted_at === null),
        'recovery did not clear the recipient latches, so a relapse would stay silent'
      );

      await makeReady(db, id);
      nextOpenAi = quota; // out of credit again
      await openaiRun();
      assert.equal(sent.length, 3, `a relapse must message the whole list again, got ${sent.length}`);
    });

    // ---- concurrency --------------------------------------------------------
    // cron-job.org retries a request it believes timed out, so two overlapping
    // runs are a real scenario, not a hypothetical.
    await check('two simultaneous runs check the project only once', async () => {
      await resetEpisode(db, id);
      await makeReady(db, id);
      sent.length = 0;
      nextOpenAi = quota; // out of credit, so a double-check would double-alert too
      openAiDelayMs = 400; // hold the first probe open so the runs really overlap

      const before = openAiHits;
      const [a, b] = await Promise.all([openaiRun(), openaiRun()]);
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
      await makeReady(db, id);
      // Simulate an invocation that claimed the project and then died: the claim
      // is present but older than MIN_CHECK_INTERVAL_MS.
      await db.query(
        "update openai_accounts set check_claimed_at = now() - interval '2 hours' where id = $1",
        [id]
      );
      const before = openAiHits;
      nextOpenAi = { status: 200, body: { choices: [] } };
      await openaiRun();
      assert.equal(openAiHits, before + 1, 'a project whose claim had expired was never retried');
    });

    await check('a live claim is respected', async () => {
      await makeReady(db, id);
      await db.query('update openai_accounts set check_claimed_at = now() where id = $1', [id]);
      const before = openAiHits;
      await openaiRun();
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
