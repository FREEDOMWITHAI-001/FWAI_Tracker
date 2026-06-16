-- ============================================================================
-- FWAI Tracker — migration 09: allow OCI as a cloud provider
-- Migration 03 created cloud_accounts with a CHECK that only permitted
-- ('aws','azure','gcp'), but the app (adapters, dialog, API validation) all
-- support OCI. This widens the constraint so OCI accounts can be stored.
-- Run in the Supabase SQL editor AFTER migration_03_cloud.sql. Idempotent.
-- ============================================================================

alter table public.cloud_accounts
  drop constraint if exists cloud_accounts_provider_check;

alter table public.cloud_accounts
  add constraint cloud_accounts_provider_check
  check (provider in ('aws', 'azure', 'gcp', 'oci'));
