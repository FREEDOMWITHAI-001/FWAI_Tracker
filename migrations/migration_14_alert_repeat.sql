-- ============================================================================
-- FWAI Tracker — migration 14: repeat "still down" WhatsApp alerts
-- Run after migration 13. Idempotent.
-- ============================================================================

-- Tracks when the last alert was actually sent for an ongoing incident, so a
-- still-down target can be re-messaged every 24h instead of alerting once and
-- going silent for the rest of the outage.
alter table public.apps add column if not exists last_alerted_at timestamptz;
alter table public.vms add column if not exists last_alerted_at timestamptz;
