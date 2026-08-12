-- ============================================================================
-- FWAI Tracker — migration 22: several WhatsApp recipients per OpenAI project,
-- a per-project daily-check toggle, and a claim column that stops two
-- schedulers checking the same project twice.
-- Run after migration 21. Idempotent.
--
-- Nothing about the CHECK changes. Same minimal request, same four outcomes,
-- same "we do not know the dollar balance" scope. This migration only changes
-- who gets told and when the telling is attempted.
--
-- 1. WHY A CHILD TABLE. openai_accounts.alert_phone held exactly one number, so
--    only one person could be told a client's project had stopped working. A
--    comma-separated column would have made that list unqueryable and given the
--    alerter nowhere to record which of the numbers it had actually reached.
--
-- 2. WHY openai_account_contacts.alerted_at. The requirement is "one alert per
--    recipient per NO_CREDIT episode", and a single account-level flag cannot
--    express that once there are several recipients: if two of three sends
--    succeed, flipping the flag abandons the third forever, and leaving it
--    clear re-messages the two who already know on every subsequent check.
--    Per-recipient state removes the dilemma — each check messages only the
--    contacts still carrying a NULL alerted_at, and a recovery clears them all.
--
-- 3. WHY check_claimed_at. The daily check is fired by a cron, and a cron can
--    fire twice (a retry, a hand-run workflow_dispatch, two hosts). Selecting
--    the due projects and then probing them is a check-then-act with a window
--    of seconds in between, during which a second invocation reads the same
--    rows as due. Both would then spend a billable OpenAI request and both
--    could send the same WhatsApp. This column is the claim: see the UPDATE ...
--    RETURNING in src/lib/openai-check.ts, which selects and claims in one
--    statement so no such window exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recipients
-- ---------------------------------------------------------------------------
create table if not exists public.openai_account_contacts (
  id                uuid primary key default gen_random_uuid(),
  openai_account_id uuid not null references public.openai_accounts(id) on delete cascade,
  phone             text not null,
  -- When this recipient was last successfully messaged about the CURRENT
  -- no-credit episode. NULL means "still owed a message", which is exactly the
  -- set the alerter sends to. Cleared for every contact when the project
  -- recovers, so a later relapse messages everybody again.
  alerted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists openai_account_contacts_account_idx
  on public.openai_account_contacts (openai_account_id);

-- The same number twice on one project would mean two identical WhatsApps.
create unique index if not exists openai_account_contacts_unique
  on public.openai_account_contacts (openai_account_id, phone);

-- ---------------------------------------------------------------------------
-- 2. Backfill the single alert_phone into the new table, then drop it
--
-- GUARDED AND DEFERRED-PARSE. The whole step is skipped once alert_phone is
-- gone, so re-running this file is a genuine no-op rather than an error. The
-- statements go through EXECUTE because plpgsql resolves a plain SQL statement
-- against the catalog when it first runs it — quoting them keeps a database
-- that has already dropped the column from ever parsing a reference to it.
-- (Migration 20 documents the same parse-time trap from the other direction.)
--
-- alerted_at is carried across from the account's own latch: a project that was
-- mid-episode at upgrade time has already had its message delivered, and
-- starting the new table with a NULL would message that person a second time
-- for an incident they were already told about.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'openai_accounts'
       and column_name  = 'alert_phone'
  ) then
    execute $mig$
      insert into public.openai_account_contacts (openai_account_id, phone, alerted_at)
      select id,
             btrim(alert_phone),
             case when alerted then last_alerted_at end
        from public.openai_accounts
       where btrim(coalesce(alert_phone, '')) <> ''
      on conflict (openai_account_id, phone) do nothing
    $mig$;

    execute 'alter table public.openai_accounts drop column alert_phone';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-project daily-check toggle
--
-- Defaults to true so every project that exists today keeps being checked
-- without anyone having to go and switch it on. Only the SCHEDULED check reads
-- this — a manual "Check now" ignores it, so a disabled project can still be
-- checked on demand.
-- ---------------------------------------------------------------------------
alter table public.openai_accounts
  add column if not exists daily_check_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. Claim column (see note 3 in the header)
--
-- NULL means unclaimed. A claim is respected for CLAIM_LEASE_MS (10 minutes in
-- src/lib/openai-check.ts) and then expires, so a run killed mid-flight — the
-- 60s maxDuration cut-off this route has a history of — releases its projects
-- instead of leaving them unchecked until tomorrow.
-- ---------------------------------------------------------------------------
alter table public.openai_accounts
  add column if not exists check_claimed_at timestamptz;

-- The claim statement filters on exactly these two columns. Partial, because
-- disabled projects are never candidates and there is no reason to index them.
create index if not exists openai_accounts_daily_due_idx
  on public.openai_accounts (last_checked_at, check_claimed_at)
  where daily_check_enabled;
