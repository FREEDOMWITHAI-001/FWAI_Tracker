-- ============================================================================
-- FWAI Tracker — migration 15: fix requires/optional_roles on ai_only /
-- ai_vs_manual for installs that already ran migration_12.
-- Run after migration 14. Idempotent.
-- ============================================================================

-- migration_12 seeds report_templates with "insert if absent" (on purpose —
-- so an operator's edits to a built-in row are never clobbered by a
-- re-run). That means any install that ran migration_12 BEFORE it was
-- edited to make "leads" optional on these two templates is stuck showing
-- "Leads / registrations — required" forever, because the row already
-- exists and the insert silently no-ops.
--
-- This is a one-time, narrowly-scoped UPDATE (not another insert-if-absent)
-- to push that fix onto rows that already exist. Scoped to is_builtin rows
-- only, and only the two keys that changed, so it cannot touch anything an
-- operator customised via the templates API.
update public.report_templates
   set requires = array['calls','attendance']::text[],
       optional_roles = array['leads','sales','cost']::text[]
 where is_builtin = true
   and client_id is null
   and key in ('ai_only', 'ai_vs_manual')
   and requires @> array['leads']::text[];
