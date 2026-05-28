-- ============================================================================
-- FWAI Tracker — migration 03: multi-cloud accounts (AWS / Azure / GCP)
-- Run in the Supabase SQL editor AFTER migration.sql and migration_02.
-- Idempotent.
-- ============================================================================

-- Cloud provider accounts. Credentials are stored ENCRYPTED (AES-256-GCM) with
-- a master key kept in the server's APP_ENCRYPTION_KEY env var — only the
-- ciphertext lives here, and it is useless without that key.
create table if not exists public.cloud_accounts (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  name                   text not null,                       -- display name
  provider               text not null check (provider in ('aws','azure','gcp')),
  label                  text,                                -- non-secret id (key prefix / subscription / project)
  credentials_encrypted  text not null,
  last_synced_at         timestamptz,
  last_sync_error        text,
  created_at             timestamptz not null default now()
);
create index if not exists cloud_accounts_client_idx on public.cloud_accounts(client_id);

-- Link VMs back to the cloud account they were imported from, and remember the
-- provider's own instance id so re-syncs update the same row instead of dupes.
alter table public.vms add column if not exists cloud_account_id uuid
  references public.cloud_accounts(id) on delete cascade;
alter table public.vms add column if not exists external_id text;
alter table public.vms add column if not exists source text not null default 'manual'; -- 'manual' | 'cloud'

-- One row per (account, instance). NULLs are distinct in Postgres unique
-- indexes, so manual VMs (both columns null) are unaffected.
create unique index if not exists vms_cloud_ext_uniq
  on public.vms(cloud_account_id, external_id);
