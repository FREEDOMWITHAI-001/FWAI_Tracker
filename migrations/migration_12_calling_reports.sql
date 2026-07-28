-- ============================================================================
-- FWAI Tracker — migration 12: AI Calling Performance Reports
--
-- A multi-client, multi-template report generator. Operators upload the raw
-- exports (leads / call logs / attendance / sales / cost), the engine joins
-- them into ONE canonical fact table (one row per person x session) and every
-- report format is a different cohort split of that table.
--
-- Design notes
--   * RAW ROWS ARE KEPT (report_dataset_rows.data jsonb). A report can be
--     re-run with different assumptions without re-uploading anything — that
--     is the whole point (GoNature needed 10 versions, Flute Gandharvas 15,
--     and every single re-version was an assumption change, not new data).
--   * Column mappings and assumption sets are saved PER CLIENT so month 2 is
--     "upload two files and click".
--   * Templates are DATA, not code: a template is a list of lens ids + block
--     ids + required input roles. Adding a format = inserting a row.
--
-- Run in the Supabase SQL editor AFTER migration_10_zoom.sql. Idempotent.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- calling_reports : one generated report run (draft -> ready)
-- ---------------------------------------------------------------------------
create table if not exists public.calling_reports (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  name             text not null,
  template_key     text not null,                 -- -> report_templates.key
  period_label     text,                          -- e.g. "Jun 17 – Jul 8, 2026"
  period_start     date,
  period_end       date,
  assumptions      jsonb not null default '{}'::jsonb,  -- snapshot of every knob
  status           text not null default 'draft'
                     check (status in ('draft','ready','failed')),
  result           jsonb,                         -- computed blocks + lenses + roi
  quality          jsonb,                         -- data-quality panel
  error            text,
  -- Numbers cannot be exported until an operator has SEEN the quality panel.
  quality_ack_at   timestamptz,
  quality_ack_hash text,                          -- hash of the acked quality panel
  generated_at     timestamptz,
  run_count        integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists calling_reports_client_idx on public.calling_reports(client_id);
create index if not exists calling_reports_created_idx on public.calling_reports(created_at desc);

-- ---------------------------------------------------------------------------
-- report_datasets : one uploaded file (or one Zoom API pull) in a report
-- ---------------------------------------------------------------------------
create table if not exists public.report_datasets (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  report_id          uuid references public.calling_reports(id) on delete cascade,
  role               text not null
                       check (role in ('leads','calls','attendance','sales','cost','comeback')),
  source             text not null default 'upload'
                       check (source in ('upload','zoom_api')),
  filename           text not null,
  -- Detected physical shape. The four Zoom attendance exports plus generics.
  shape              text not null default 'simple',
  content_hash       text,                        -- sha256 of the bytes (duplicate detection)
  headers            jsonb not null default '[]'::jsonb,
  row_count          integer not null default 0,
  mapping            jsonb not null default '{}'::jsonb,   -- field -> column header
  mapping_confidence jsonb not null default '{}'::jsonb,   -- field -> 0..1
  options            jsonb not null default '{}'::jsonb,   -- e.g. { "call_mode": "manual" }
  detect_notes       jsonb not null default '[]'::jsonb,   -- what the shape detector saw
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists report_datasets_report_idx on public.report_datasets(report_id);
create index if not exists report_datasets_client_idx on public.report_datasets(client_id, role);
create index if not exists report_datasets_hash_idx   on public.report_datasets(client_id, content_hash);

-- ---------------------------------------------------------------------------
-- report_dataset_rows : the raw uploaded rows, verbatim, as jsonb.
-- block='main' is the row table; block='session' holds the session-summary
-- block of a two-table Zoom CSV.
-- ---------------------------------------------------------------------------
create table if not exists public.report_dataset_rows (
  id          bigserial primary key,
  dataset_id  uuid not null references public.report_datasets(id) on delete cascade,
  row_index   integer not null,
  block       text not null default 'main',
  data        jsonb not null
);
create index if not exists report_dataset_rows_ds_idx on public.report_dataset_rows(dataset_id, row_index);

-- ---------------------------------------------------------------------------
-- report_column_mappings : remembered column mapping per (client, role, header
-- signature). Re-uploading next month's identical export auto-maps silently.
-- ---------------------------------------------------------------------------
create table if not exists public.report_column_mappings (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  role             text not null,
  header_signature text not null,   -- sha256 of the normalised, sorted header list
  mapping          jsonb not null default '{}'::jsonb,
  options          jsonb not null default '{}'::jsonb,
  use_count        integer not null default 1,
  last_used_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create unique index if not exists report_column_mappings_uniq
  on public.report_column_mappings(client_id, role, header_signature);

-- ---------------------------------------------------------------------------
-- report_assumption_sets : saved, named knob sets per client.
-- ---------------------------------------------------------------------------
create table if not exists public.report_assumption_sets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists report_assumption_sets_uniq
  on public.report_assumption_sets(client_id, name);

-- ---------------------------------------------------------------------------
-- report_exclusions : per-client test / internal numbers and addresses.
-- ---------------------------------------------------------------------------
create table if not exists public.report_exclusions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  kind       text not null check (kind in ('phone','email','email_domain','name')),
  value      text not null,
  note       text,
  created_at timestamptz not null default now()
);
create unique index if not exists report_exclusions_uniq
  on public.report_exclusions(client_id, kind, value);

-- ---------------------------------------------------------------------------
-- report_templates : a named format = lenses x blocks. Data, not code.
-- client_id null = global built-in; a client row overrides/extends.
-- ---------------------------------------------------------------------------
create table if not exists public.report_templates (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id) on delete cascade,
  key            text not null,
  name           text not null,
  description    text,
  lenses         text[] not null default '{}',   -- L1..L7
  blocks         text[] not null default '{}',   -- scorecard|funnel|per_webinar|who_bought|roi
  requires       text[] not null default '{}',   -- input roles that MUST be present
  optional_roles text[] not null default '{}',
  primary_lens   text,                           -- the lens the scorecard headline uses
  is_builtin     boolean not null default false,
  sort_order     integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Portable "unique nulls not distinct": two partial indexes.
create unique index if not exists report_templates_global_key_uniq
  on public.report_templates(key) where client_id is null;
create unique index if not exists report_templates_client_key_uniq
  on public.report_templates(client_id, key) where client_id is not null;

-- ---------------------------------------------------------------------------
-- report_facts : the canonical fact table for one report run.
-- One row per (person x webinar session). Every lens is a cohort split of this.
-- Rebuilt from scratch on each run — never edited in place.
-- ---------------------------------------------------------------------------
create table if not exists public.report_facts (
  id            bigserial primary key,
  report_id     uuid not null references public.calling_reports(id) on delete cascade,
  person_key    text not null,          -- last-10 phone, else email, else name
  session_key   text not null,
  name          text,
  phone         text,
  email         text,
  registered    boolean not null default false,
  dialled       boolean not null default false,
  connected     boolean not null default false,
  talk_turns    integer,
  engaged       boolean not null default false,
  bot_id        text,
  call_mode     text,                   -- 'ai' | 'manual'
  call_time     timestamptz,
  call_seconds  integer,
  showed_up     boolean not null default false,
  watch_minutes numeric,
  left_early    boolean not null default false,
  came_back     boolean not null default false,
  bought        boolean not null default false,
  order_value   numeric,
  order_time    timestamptz,
  holdout       boolean not null default false,  -- registered but never dialled
  week          text,                            -- ISO week (IST), e.g. 2026-W27
  session_date  date,
  ai_week       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists report_facts_report_idx  on public.report_facts(report_id);
create index if not exists report_facts_session_idx on public.report_facts(report_id, session_key);
create index if not exists report_facts_buyer_idx   on public.report_facts(report_id) where bought;

-- ---------------------------------------------------------------------------
-- Seed the built-in templates. Insert-if-absent so re-running is safe and an
-- operator's edits to a built-in row are never clobbered.
-- ---------------------------------------------------------------------------
insert into public.report_templates (key, name, description, lenses, blocks, requires, optional_roles, primary_lens, is_builtin, sort_order)
select v.key, v.name, v.description, v.lenses, v.blocks, v.requires, v.optional_roles, v.primary_lens, true, v.sort_order
from (values
  ('ai_only',
   'AI-only report',
   'The standard AI-calling performance report: what the dialer did and what happened after. Headline uses the time-based AI-weeks lens because it carries the least selection bias.',
   array['L3','L1','L6','L5']::text[],
   array['scorecard','funnel','per_webinar','who_bought','roi']::text[],
   array['calls','attendance']::text[],
   array['leads','sales','cost']::text[],
   'L3', 10),
  ('ai_vs_manual',
   'AI vs Manual',
   'Compares the AI dialer against the human calling team on the same funnel. Needs at least one call log marked manual.',
   array['L4','L3','L1']::text[],
   array['scorecard','funnel','per_webinar','who_bought','roi']::text[],
   array['calls','attendance']::text[],
   array['leads','sales','cost']::text[],
   'L4', 20),
  ('called_vs_not',
   'Called vs Not-called',
   'Registrants we dialled against registrants we never dialled. Directional only — who gets dialled is not random.',
   array['L2','L1','L6']::text[],
   array['scorecard','funnel','per_webinar','who_bought']::text[],
   array['leads','calls','attendance']::text[],
   array['sales','cost']::text[],
   'L2', 30),
  ('per_bot',
   'Per-bot breakdown',
   'Signup-confirmation bot vs day-of reminder bot vs both, against the dialled-but-not-reached baseline. This is the Coacheasily "Show-up & Buyers by Bot" format.',
   array['L5','L1','L6']::text[],
   array['scorecard','funnel','per_webinar','who_bought','roi']::text[],
   array['leads','calls','attendance']::text[],
   array['sales','cost']::text[],
   'L5', 40),
  ('leave_comeback',
   'Leave & comeback',
   'People who left the webinar early and came back via the reminder link, and how many of them bought.',
   array['L7']::text[],
   array['scorecard','funnel','per_webinar','who_bought']::text[],
   array['attendance']::text[],
   array['leads','calls','sales','comeback','cost']::text[],
   'L7', 50),
  ('full_audit',
   'Full audit (all lenses)',
   'Every lens the data supports, credible ones first. Internal use — shows how much the answer moves between a biased lens and an unbiased one.',
   array['L3','L5','L7','L4','L1','L2','L6']::text[],
   array['scorecard','funnel','per_webinar','who_bought','roi']::text[],
   array['leads','calls','attendance']::text[],
   array['sales','cost','comeback']::text[],
   'L3', 60)
) as v(key, name, description, lenses, blocks, requires, optional_roles, primary_lens, sort_order)
where not exists (
  select 1 from public.report_templates t where t.client_id is null and t.key = v.key
);
