-- ============================================================================
-- FWAI Tracker — migration 21: OpenAI Track becomes a health/credit CHECK
-- Run after migration 20. Idempotent.
--
-- WHAT CHANGES AND WHY.
--
-- Migrations 16/18/20 modelled an OpenAI account as a TOKEN BUDGET: an
-- `allocated_tokens` figure somebody typed in, `used_tokens` pulled from
-- /v1/organization/usage/completions, and a status derived from
-- (allocated - used) / allocated against two percentage thresholds.
--
-- That model does not survive contact with a project API key:
--
--   1. The usage endpoint is ORGANIZATION-scoped and needs an admin key
--      (sk-admin-…). A project key (sk-proj-…) is rejected with 401 and cannot
--      read usage at all — so the whole feature required a client to hand over
--      an organization-wide administrative credential.
--   2. `allocated_tokens` was never a real balance. OpenAI exposes no API for
--      remaining prepaid credit, so the "remaining %" the UI showed, the
--      thresholds it compared against and the alerts it fired were all derived
--      from a number an operator invented.
--
-- The replacement asks one answerable question instead: can this project key
-- currently make a billable request, or does OpenAI report insufficient_quota?
-- That is a single API call and a single status. It does NOT know the dollar
-- balance and no longer claims to.
--
-- `status` therefore stops being healthy/warning/down and becomes one of the
-- four check outcomes, and the eight columns that existed only to support the
-- budget arithmetic are dropped.
--
-- DATA LOSS IS INTENTIONAL AND SCOPED: allocated/used token figures and the
-- threshold percentages are exactly the invented numbers being removed. The
-- client link, project name, encrypted key, contact name, mobile number and
-- alert state all survive untouched, so no account has to be re-added and no
-- key has to be re-entered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. status: healthy/warning/down  ->  the four check outcomes
--
-- The constraint has to go BEFORE the update, or the rewrite trips over it.
-- Both spellings are dropped: migration 18 and migration 20 each add the same
-- named constraint, and a database may carry either.
-- ---------------------------------------------------------------------------
alter table public.openai_accounts drop constraint if exists openai_accounts_status_check;
alter table public.openai_accounts drop constraint if exists openai_accounts_used_source_check;

-- The default is dropped first for the same reason: 'healthy' is about to stop
-- being a legal value, and a stale default would fail the new constraint the
-- next time a row was inserted without an explicit status.
alter table public.openai_accounts alter column status drop default;

-- A previously-tracked account has never actually been probed the new way, so
-- nothing here can honestly claim CREDIT_AVAILABLE. Everything is moved to
-- CHECK_FAILED — "we do not know yet" — and the first check settles it. Mapping
-- 'healthy' to CREDIT_AVAILABLE instead would assert a live result that no
-- request was ever made to obtain, and mapping 'warning'/'down' to NO_CREDIT
-- would assert quota exhaustion that was only ever inferred from the invented
-- allocation. `last_checked_at` is cleared to match, so the UI says
-- "Not checked yet" rather than showing a timestamp from the old usage pull.
update public.openai_accounts
   set status          = 'CHECK_FAILED',
       last_checked_at = null,
       last_check_error = null
 where status not in ('CREDIT_AVAILABLE', 'NO_CREDIT', 'INVALID_KEY', 'CHECK_FAILED');

-- An account added from now on is unchecked, not healthy.
alter table public.openai_accounts alter column status set default 'CHECK_FAILED';

do $$ begin
  alter table public.openai_accounts
    add constraint openai_accounts_status_check
    check (status in ('CREDIT_AVAILABLE', 'NO_CREDIT', 'INVALID_KEY', 'CHECK_FAILED'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the budget-tracking columns
--
-- org_id / project_id went with the admin-key usage pull: a project key
-- identifies its own project, so neither is asked for or used any more.
-- low_since duplicated what `alerted` already records now that there is no
-- two-stage warning->critical escalation to time.
-- ---------------------------------------------------------------------------
alter table public.openai_accounts drop column if exists allocated_tokens;
alter table public.openai_accounts drop column if exists used_tokens;
alter table public.openai_accounts drop column if exists used_source;
alter table public.openai_accounts drop column if exists low_threshold_pct;
alter table public.openai_accounts drop column if exists critical_threshold_pct;
alter table public.openai_accounts drop column if exists org_id;
alter table public.openai_accounts drop column if exists project_id;
alter table public.openai_accounts drop column if exists low_since;

-- ---------------------------------------------------------------------------
-- 3. Resulting shape (unchanged columns, restated for the next reader)
--
--   client_id             the client this project belongs to
--   name                  project name, as the operator types it
--   label                 masked hint for the stored key ("sk-…4f2a"), non-secret
--   credentials_encrypted AES-256-GCM ciphertext of the sk-proj-… key
--   alert_name            contact person
--   alert_phone           WhatsApp / mobile number (falls back to the client's)
--   status                CREDIT_AVAILABLE | NO_CREDIT | INVALID_KEY | CHECK_FAILED
--   alerted               a NO_CREDIT WhatsApp has been delivered for this episode
--   last_alerted_at       when that message went out
--   last_checked_at       when the last probe ran (null = never)
--   last_check_error      why a CHECK_FAILED/INVALID_KEY check failed
--
-- Both existing indexes still apply and are left in place.
-- ---------------------------------------------------------------------------
