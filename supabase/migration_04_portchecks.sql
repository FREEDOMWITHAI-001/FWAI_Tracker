-- ============================================================================
-- FWAI Tracker — migration 04: TCP port checks
-- Run in the Supabase SQL editor AFTER migrations 01–03. Idempotent.
-- ============================================================================

-- Primary reachability check: open a TCP connection to host:port.
alter table public.vms add column if not exists host text;
alter table public.vms add column if not exists port int;
