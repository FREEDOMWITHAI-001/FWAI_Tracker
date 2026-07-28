-- ============================================================================
-- FWAI Tracker — migration 05: live checks for applications
-- Run in the Supabase SQL editor AFTER migrations 01–04. Idempotent.
-- ============================================================================

-- An application is checked by URL (HTTP) or host:port (TCP), just like a VM,
-- giving up/down + response time. (Apps don't have CPU/mem/disk of their own.)
alter table public.apps add column if not exists check_url        text;
alter table public.apps add column if not exists check_host       text;
alter table public.apps add column if not exists check_port       int;
alter table public.apps add column if not exists last_checked_at  timestamptz;
alter table public.apps add column if not exists last_response_ms int;

-- Response-time / up-down history per application.
create table if not exists public.app_metrics (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references public.apps(id) on delete cascade,
  checked_at   timestamptz not null default now(),
  status       text not null default 'healthy' check (status in ('healthy','warning','down')),
  response_ms  int
);
create index if not exists app_metrics_app_idx on public.app_metrics(app_id, checked_at desc);
