-- ============================================================================
-- FWAI Tracker — migration 02: VM health checks + metric history
-- Run this in the Supabase SQL editor AFTER the original migration.sql.
-- Idempotent: safe to run more than once.
-- ============================================================================

-- New columns on vms for the health-check engine.
alter table public.vms add column if not exists health_url        text;
alter table public.vms add column if not exists last_checked_at   timestamptz;
alter table public.vms add column if not exists last_response_ms  int;

-- Time-series samples written on every probe (one row per check), used to
-- draw the CPU / memory / disk history charts and response-time trend.
create table if not exists public.vm_metrics (
  id           uuid primary key default gen_random_uuid(),
  vm_id        uuid not null references public.vms(id) on delete cascade,
  checked_at   timestamptz not null default now(),
  status       text not null default 'healthy'
                 check (status in ('healthy','warning','down')),
  response_ms  int,
  cpu          int,
  mem          int,
  disk         int
);
create index if not exists vm_metrics_vm_id_checked_idx
  on public.vm_metrics(vm_id, checked_at desc);

-- Keeps the table from growing forever (optional helper you can call from a cron):
--   delete from public.vm_metrics where checked_at < now() - interval '30 days';
