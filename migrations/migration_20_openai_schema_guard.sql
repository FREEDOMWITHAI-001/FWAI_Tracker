-- ============================================================================
-- FWAI Tracker — migration 20: guarantee the OpenAI Track schema exists
-- Run after migration 19. Idempotent.
--
-- WHY THIS EXISTS, given 16 and 18 already declare the same objects.
--
-- migration_16_openai_credits.sql is a RECOVERED file: its filename was written
-- into schema_migrations on at least one database before the file itself was
-- ever committed. The runner (scripts/migrate.mjs) skips any filename already
-- recorded, so on such a database migration 16 can never run again — and if that
-- database did not in fact end up with the table (restored ledger, reset volume,
-- ledger copied between environments, partial restore), `npm run migrate`
-- cheerfully reports "Up to date" while `openai_accounts` does not exist. The
-- symptom is the OpenAI Track page returning
--
--     relation "openai_accounts" does not exist
--
-- and — less obviously — EVERY downtime WhatsApp alert failing with it, because
-- closeOrphanedIncidents() in src/lib/alerts.ts joins openai_accounts and is
-- called from runAlerts() on every cycle. One missing table silently takes the
-- VM/app alerting down with it.
--
-- This migration carries a NEW filename, so it runs on every database that has
-- not seen it regardless of what the ledger claims about 16 and 18, and it
-- restates the full shape with create-if-not-exists / add-column-if-not-exists.
-- On a database that already has the table it changes nothing at all. It creates
-- no duplicate table and supersedes neither 16 nor 18 — those stay exactly as
-- they are for the databases where they did their job.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Base table (restates migration 16)
-- ---------------------------------------------------------------------------
create table if not exists public.openai_accounts (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  name                   text not null,
  label                  text,
  org_id                 text,
  project_id             text,
  allocated_tokens       bigint  not null default 0 check (allocated_tokens >= 0),
  used_tokens            bigint  not null default 0 check (used_tokens >= 0),
  used_source            text    not null default 'manual' check (used_source in ('manual', 'api')),
  low_threshold_pct      integer not null default 25 check (low_threshold_pct between 0 and 100),
  critical_threshold_pct integer not null default 10 check (critical_threshold_pct between 0 and 100),
  credentials_encrypted  text,
  last_checked_at        timestamptz,
  last_check_error       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Columns from 16, added individually so a table created by an older/partial
-- run is brought up to the full shape rather than being assumed complete.
alter table public.openai_accounts add column if not exists label                  text;
alter table public.openai_accounts add column if not exists org_id                 text;
alter table public.openai_accounts add column if not exists project_id             text;
alter table public.openai_accounts add column if not exists allocated_tokens       bigint  not null default 0;
alter table public.openai_accounts add column if not exists used_tokens            bigint  not null default 0;
alter table public.openai_accounts add column if not exists used_source            text    not null default 'manual';
alter table public.openai_accounts add column if not exists low_threshold_pct      integer not null default 25;
alter table public.openai_accounts add column if not exists critical_threshold_pct integer not null default 10;
alter table public.openai_accounts add column if not exists credentials_encrypted  text;
alter table public.openai_accounts add column if not exists last_checked_at        timestamptz;
alter table public.openai_accounts add column if not exists last_check_error       text;
alter table public.openai_accounts add column if not exists created_at             timestamptz not null default now();
alter table public.openai_accounts add column if not exists updated_at             timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Alerting columns (restates migration 18)
-- ---------------------------------------------------------------------------
alter table public.openai_accounts add column if not exists status          text not null default 'healthy';
alter table public.openai_accounts add column if not exists alert_name      text;
alter table public.openai_accounts add column if not exists alert_phone     text;
alter table public.openai_accounts add column if not exists alerted         boolean not null default false;
alter table public.openai_accounts add column if not exists last_alerted_at timestamptz;
alter table public.openai_accounts add column if not exists low_since       timestamptz;

-- Postgres has no "add constraint if not exists"; swallowing duplicate_object
-- keeps a re-run harmless.
do $$ begin
  alter table public.openai_accounts
    add constraint openai_accounts_status_check check (status in ('healthy', 'warning', 'down'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.openai_accounts
    add constraint openai_accounts_used_source_check check (used_source in ('manual', 'api'));
exception when duplicate_object then null;
end $$;

create index if not exists openai_accounts_client_idx on public.openai_accounts (client_id);
create index if not exists openai_accounts_status_idx on public.openai_accounts (status);

-- ---------------------------------------------------------------------------
-- Incident plumbing the OpenAI alerter depends on (restates migration 17)
--
-- Same reasoning: runOpenAiAlerts() writes alerts rows through openIncident(),
-- which relies on source_kind / source_id and on the partial unique index being
-- present as the ON CONFLICT arbiter. Without the index the insert raises
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" and no alert is ever recorded.
-- ---------------------------------------------------------------------------
alter table public.alerts add column if not exists source_kind      text;
alter table public.alerts add column if not exists source_id        uuid;
alter table public.alerts add column if not exists whatsapp_sent_at timestamptz;
alter table public.alerts add column if not exists whatsapp_error   text;

create unique index if not exists alerts_one_active_per_source
  on public.alerts (source_kind, source_id)
  where status = 'active' and source_id is not null;

create index if not exists alerts_source_idx on public.alerts (source_kind, source_id);
