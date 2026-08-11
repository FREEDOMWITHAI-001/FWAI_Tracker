-- ============================================================================
-- FWAI Tracker — migration 17: alerts become the real incident log
-- Run after migration 15. Idempotent.
--
-- Numbered 17, not 16: a `migration_16_openai_credits.sql` is already recorded
-- in schema_migrations on at least one database while no such file exists in
-- this repo. Skipping the number keeps the two from ever colliding.
--
-- Until now the downtime alerter (src/lib/alerts.ts) sent WhatsApp messages but
-- never wrote an alerts row, while `whatsapp_sent` was a checkbox an operator
-- ticked by hand. So the Alerts page showed incidents nobody was told about and
-- deliveries that may never have happened. These columns let one alerts row
-- represent one incident, from detection to recovery, with the real delivery
-- outcome on it.
-- ============================================================================

-- Which monitored thing an alert belongs to, so the next alert cycle can find
-- the same incident again instead of appending a new row, and recovery can
-- close it. Operator-raised alerts are 'manual' and carry no source_id.
alter table public.alerts add column if not exists source_kind text;
alter table public.alerts add column if not exists source_id   uuid;

-- Real WhatsApp delivery state. `whatsapp_sent` is now written only by the code
-- that actually calls AI Sensy; `whatsapp_error` records why a message did not
-- go out (no phone number, WhatsApp switched off, AI Sensy rejected it) so a
-- silent failure is visible instead of looking like "no alert was needed".
alter table public.alerts add column if not exists whatsapp_sent_at timestamptz;
alter table public.alerts add column if not exists whatsapp_error   text;

-- At most one OPEN alert per monitored target. The alert loop re-runs every few
-- minutes for the whole length of an outage; without this, a host that is down
-- for a day would leave hundreds of identical rows behind.
create unique index if not exists alerts_one_active_per_source
  on public.alerts (source_kind, source_id)
  where status = 'active' and source_id is not null;

-- Lookups by target (the update/resolve path) hit this rather than scanning.
create index if not exists alerts_source_idx on public.alerts (source_kind, source_id);
