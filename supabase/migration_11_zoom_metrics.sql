-- ============================================================================
-- FWAI Tracker — migration 11: cache per-session Zoom engagement metrics.
-- These are computed from the participant report when a session is opened
-- (and stored here) so the list/column and CSV export can show them without
-- re-fetching every time. Run in the Supabase SQL editor AFTER
-- migration_10_zoom.sql. Idempotent.
-- ============================================================================

alter table public.zoom_sessions add column if not exists unique_participants integer;
alter table public.zoom_sessions add column if not exists peak_concurrent     integer;
alter table public.zoom_sessions add column if not exists avg_duration_min    integer;
alter table public.zoom_sessions add column if not exists rejoins             integer;
alter table public.zoom_sessions add column if not exists metrics_at          timestamptz;
