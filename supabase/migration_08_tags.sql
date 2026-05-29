-- ============================================================================
-- FWAI Tracker — migration 08: optional free-form tag on VMs and Apps
-- Run in the Supabase SQL editor AFTER migrations 01–07. Idempotent.
-- ============================================================================

-- A short user-typed label (e.g. "production", "Apex Motors", "internal").
-- Different from `client_id` — clients are who-owns-it; tags are how-you-think-of-it.
alter table public.vms  add column if not exists tag text;
alter table public.apps add column if not exists tag text;