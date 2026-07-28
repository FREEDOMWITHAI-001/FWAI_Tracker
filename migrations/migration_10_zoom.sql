-- ============================================================================
-- FWAI Tracker — migration 10: Zoom integration (per-client accounts + sessions)
-- Lets each client connect their own Zoom Server-to-Server OAuth app. Synced
-- webinars/meetings land in zoom_sessions. Credentials are stored ENCRYPTED
-- (AES-256-GCM) with the server's APP_ENCRYPTION_KEY — same scheme as
-- cloud_accounts. Run in the Supabase SQL editor AFTER migration_03_cloud.sql.
-- Idempotent.
-- ============================================================================

-- One Zoom account per client (a client may have more than one).
-- credentials_encrypted holds JSON: { account_id, client_id, client_secret }.
create table if not exists public.zoom_accounts (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  name                   text not null,            -- display name
  account_id             text,                     -- non-secret Zoom account id
  label                  text,                     -- non-secret hint (client_id prefix)
  credentials_encrypted  text not null,
  last_synced_at         timestamptz,
  last_sync_error        text,
  created_at             timestamptz not null default now()
);
create index if not exists zoom_accounts_client_idx on public.zoom_accounts(client_id);

-- One row per synced webinar/meeting occurrence. Re-syncs upsert on
-- (zoom_account_id, zoom_uuid) so the same occurrence updates in place.
create table if not exists public.zoom_sessions (
  id                  uuid primary key default gen_random_uuid(),
  zoom_account_id     uuid not null references public.zoom_accounts(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete cascade,
  kind                text not null check (kind in ('webinar','meeting')),
  zoom_id             text not null,               -- recurring webinar/meeting id
  zoom_uuid           text not null,               -- specific occurrence uuid (dedup key)
  topic               text not null,
  host_email          text,
  start_time          timestamptz,
  duration_min        integer,
  registrants_count   integer not null default 0,
  participants_count  integer not null default 0,
  attendance_pct      integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists zoom_sessions_client_idx  on public.zoom_sessions(client_id);
create index if not exists zoom_sessions_account_idx on public.zoom_sessions(zoom_account_id);
create unique index if not exists zoom_sessions_uniq
  on public.zoom_sessions(zoom_account_id, zoom_uuid);
