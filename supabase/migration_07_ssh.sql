-- ============================================================================
-- FWAI Tracker — migration 07: SSH metric collection for VMs
-- Run in the Supabase SQL editor AFTER migrations 01–06. Idempotent.
-- ============================================================================

-- Log into the server over SSH to read CPU / Memory / Disk. The private key
-- and passphrase are encrypted (AES-256-GCM) before storage, like cloud creds.
alter table public.vms add column if not exists ssh_user           text;
alter table public.vms add column if not exists ssh_port           int  default 22;
alter table public.vms add column if not exists ssh_key_encrypted  text;
alter table public.vms add column if not exists ssh_pass_encrypted text;