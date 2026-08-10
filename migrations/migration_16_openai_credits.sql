-- ============================================================================
-- FWAI Tracker — migration 16: OpenAI credit tracking per client
-- Run after migration 15. Idempotent.
--
-- RECOVERED FILE. This migration was applied to at least one database and then
-- lost before it was ever committed, leaving `migration_16_openai_credits.sql`
-- recorded in schema_migrations with no file behind it. The DDL below was
-- reconstructed from that database's live schema, so it is byte-equivalent in
-- effect: a database that already recorded this filename skips it and keeps the
-- table it has, while a fresh database now gets the same table instead of
-- silently missing it.
--
-- The model is a TOKEN BUDGET, not a dollar balance: OpenAI exposes no API for
-- the remaining prepaid credit on a key, so the ops team records the tokens
-- allocated to a client and the app tracks what has been consumed against it.
-- `used_source` says where that consumption figure came from — 'api' when the
-- Usage API filled it in, 'manual' when someone typed it.
-- ============================================================================

create table if not exists public.openai_accounts (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  name                   text not null,
  -- Non-secret display hint for the stored key (e.g. "sk-…4f2a"), so the UI can
  -- show WHICH key is configured without ever reading the ciphertext.
  label                  text,
  org_id                 text,
  project_id             text,
  allocated_tokens       bigint  not null default 0 check (allocated_tokens >= 0),
  used_tokens            bigint  not null default 0 check (used_tokens >= 0),
  used_source            text    not null default 'manual' check (used_source in ('manual', 'api')),
  -- Percent of the allocation still REMAINING at which to warn / escalate.
  low_threshold_pct      integer not null default 25 check (low_threshold_pct between 0 and 100),
  critical_threshold_pct integer not null default 10 check (critical_threshold_pct between 0 and 100),
  -- AES-256-GCM ciphertext of the OpenAI API key (src/lib/crypto.ts).
  credentials_encrypted  text,
  last_checked_at        timestamptz,
  last_check_error       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists openai_accounts_client_idx on public.openai_accounts (client_id);
