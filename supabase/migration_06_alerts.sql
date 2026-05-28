-- ============================================================================
-- FWAI Tracker — migration 06: WhatsApp alerts (AI Sensy)
-- Run in the Supabase SQL editor AFTER migrations 01–05. Idempotent.
-- ============================================================================

-- Per-contact notification details (who to message when something is down).
alter table public.clients add column if not exists alert_name  text;
alter table public.clients add column if not exists alert_phone text;

-- Each app/VM can have its own contact; if blank it falls back to the client's.
-- down_since = when it first went down; alerted = whether we've already messaged.
alter table public.apps add column if not exists alert_name  text;
alter table public.apps add column if not exists alert_phone text;
alter table public.apps add column if not exists down_since  timestamptz;
alter table public.apps add column if not exists alerted     boolean not null default false;

alter table public.vms add column if not exists alert_name  text;
alter table public.vms add column if not exists alert_phone text;
alter table public.vms add column if not exists down_since  timestamptz;
alter table public.vms add column if not exists alerted     boolean not null default false;

-- AI Sensy connection + alert rules live in app_settings under key 'aisensy'
-- (stored as JSON; the API key inside is encrypted). No table change needed.