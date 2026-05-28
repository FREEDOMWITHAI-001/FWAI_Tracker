-- ============================================================================
-- FWAI Tracker — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> Run).
-- Safe to re-run: uses IF NOT EXISTS / idempotent guards where possible.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- clients : the companies you monitor
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vms : machines belonging to a client (AWS EC2 / VPS / self-hosted)
-- ---------------------------------------------------------------------------
create table if not exists public.vms (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  name          text not null,                 -- e.g. "i-0a91c2", "vps-4912"
  provider      text not null default 'AWS EC2',  -- AWS EC2 | Other VPS | Self-host
  region        text,                          -- e.g. "ap-south-1", "on-premise"
  status        text not null default 'healthy'
                  check (status in ('healthy','warning','down')),
  cpu           int not null default 0,        -- percent 0..100
  mem           int not null default 0,        -- percent 0..100
  disk          int not null default 0,        -- percent 0..100
  uptime_label  text default '',               -- e.g. "42d 6h" or "unreachable"
  created_at    timestamptz not null default now()
);
create index if not exists vms_client_id_idx on public.vms(client_id);

-- ---------------------------------------------------------------------------
-- apps : applications / projects a client runs (may sit on a VM, or be hosted
--        elsewhere such as Supabase / an automation platform -> vm_id nullable)
-- ---------------------------------------------------------------------------
create table if not exists public.apps (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  vm_id       uuid references public.vms(id) on delete set null,
  name        text not null,
  type        text default 'Web service',      -- Website | n8n + GHL | Supabase | Wavelength | Flutter + Supabase | Pabbly ...
  host        text default '',                 -- free text: "ec2 i-0a91", "supabase", "automation"
  status      text not null default 'healthy'
                check (status in ('healthy','warning','down')),
  resp_ms     int not null default 0,          -- response time in ms (0 = n/a)
  health      text default '',                 -- e.g. "/health 200", "GHL token expired"
  uptime      numeric(5,2) not null default 100,  -- uptime percent over window
  created_at  timestamptz not null default now()
);
create index if not exists apps_client_id_idx on public.apps(client_id);
create index if not exists apps_vm_id_idx on public.apps(vm_id);

-- ---------------------------------------------------------------------------
-- alerts : active / resolved alerts, optionally tied to a client
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id) on delete set null,
  severity       text not null default 'warning'
                   check (severity in ('critical','warning','info')),
  title          text not null,
  description    text default '',
  whatsapp_sent  boolean not null default false,
  status         text not null default 'active'
                   check (status in ('active','resolved')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists alerts_status_idx on public.alerts(status);
create index if not exists alerts_client_id_idx on public.alerts(client_id);

-- ---------------------------------------------------------------------------
-- webinars : Zoom webinars per client + their reminder funnel stages
-- ---------------------------------------------------------------------------
create table if not exists public.webinars (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  name          text not null,
  participants  int not null default 0,
  reminders     int not null default 0,        -- "leave" / re-join reminders sent
  attendance    int not null default 0,        -- percent who stayed
  webinar_date  date,
  status        text not null default 'healthy'
                  check (status in ('healthy','warning','down')),
  created_at    timestamptz not null default now()
);
create index if not exists webinars_client_id_idx on public.webinars(client_id);

create table if not exists public.webinar_stages (
  id           uuid primary key default gen_random_uuid(),
  webinar_id   uuid not null references public.webinars(id) on delete cascade,
  stage        text not null,                  -- "Confirmation", "24h before", ...
  triggered    int not null default 0,
  succeeded    int not null default 0,
  failed       int not null default 0,
  sort_order   int not null default 0
);
create index if not exists webinar_stages_webinar_id_idx on public.webinar_stages(webinar_id);

-- ---------------------------------------------------------------------------
-- integrations : connected services shown on the Settings page
-- ---------------------------------------------------------------------------
create table if not exists public.integrations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                   -- "AWS (EC2)", "Zoom", "WhatsApp Business", "GoHighLevel"
  detail      text default '',
  status      text not null default 'healthy'
                check (status in ('healthy','warning','down')),
  sort_order  int not null default 0
);

-- ---------------------------------------------------------------------------
-- app_settings : simple key/value store for notification toggles etc.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- uptime_samples : optional daily uptime points for the 14-day charts.
--   client_id null  -> fleet-wide sample.
--   Leave empty and the charts show an empty state; populate via a cron later.
-- ---------------------------------------------------------------------------
create table if not exists public.uptime_samples (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  day         date not null,
  uptime      numeric(5,2) not null,
  unique (client_id, day)
);

-- ---------------------------------------------------------------------------
-- Seed the integration rows + default notification settings (optional but
-- harmless on an empty start; comment out if you want a truly blank slate).
-- ---------------------------------------------------------------------------
insert into public.integrations (name, detail, status, sort_order) values
  ('AWS (EC2)',          'Read-only · ap-south-1',            'healthy', 1),
  ('Zoom',               'Server-to-Server OAuth',            'healthy', 2),
  ('WhatsApp Business',  'Twilio · Ops group',                'healthy', 3),
  ('GoHighLevel',        'Webinar email delivery',            'warning', 4)
on conflict do nothing;

insert into public.app_settings (key, value) values
  ('notifications', '{"whatsapp": true, "email_digest": true, "throttle": true}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- Row Level Security
-- ----------------------------------------------------------------------------
-- This app talks to Supabase from Next.js server routes using the SERVICE ROLE
-- key, which bypasses RLS. RLS is therefore left DISABLED here for simplicity.
-- If you later expose the anon key to the browser or add user auth, enable RLS
-- and add policies, e.g.:
--
--   alter table public.clients enable row level security;
--   create policy "auth read" on public.clients for select to authenticated using (true);
-- ============================================================================
