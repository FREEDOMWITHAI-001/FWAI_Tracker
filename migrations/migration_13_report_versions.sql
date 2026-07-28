-- ============================================================================
-- FWAI Tracker — migration 13: report version snapshots + richer facts
--
--   1. report_versions — one immutable row per run, so v3 stays openable and
--      downloadable after v7 exists. GoNature needed 10 versions and Flute
--      Gandharvas 15; overwriting `calling_reports.result` on every run threw
--      all but the newest away.
--   2. report_facts.talked  — connected AND cleared the talk-duration floor.
--   3. report_facts.bots    — every auto-detected bot that reached the person.
--
-- Run with: npm run migrate     (idempotent)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Immutable per-run snapshots.
--
-- assumptions/result/quality are copied in full rather than referenced, because
-- the whole point is to compare what v3 said against what v7 says — including
-- the knobs that produced each. Nothing here is ever UPDATEd.
-- ---------------------------------------------------------------------------
create table if not exists public.report_versions (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid not null references public.calling_reports(id) on delete cascade,
  version          integer not null,              -- 1-based, = run_count at the time
  template_key     text not null,
  period_label     text,
  assumptions      jsonb not null default '{}'::jsonb,
  result           jsonb,
  quality          jsonb,
  quality_hash     text,
  fact_count       integer not null default 0,
  -- Denormalised headline so the version list renders without parsing `result`.
  headline         text,
  primary_lens     text,
  buyers           integer,
  revenue          numeric,
  created_at       timestamptz not null default now()
);

create unique index if not exists report_versions_uniq
  on public.report_versions(report_id, version);
create index if not exists report_versions_report_idx
  on public.report_versions(report_id, version desc);

-- ---------------------------------------------------------------------------
-- 2 + 3. New fact columns.
--
-- `talked` is separate from `connected`: a connected status alone counts a
-- 2-second pickup as a conversation, so a duration floor is the only way to ask
-- "who actually talked". `bots` is a text[] because a lead reached by two bots
-- belongs to both rows of the per-bot table.
-- ---------------------------------------------------------------------------
alter table public.report_facts add column if not exists talked boolean not null default false;
alter table public.report_facts add column if not exists bots   text[]  not null default '{}';

create index if not exists report_facts_talked_idx on public.report_facts(report_id) where talked;
