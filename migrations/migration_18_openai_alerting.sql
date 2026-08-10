-- ============================================================================
-- FWAI Tracker — migration 18: low-credit alerting for OpenAI accounts
-- Run after migration 17. Idempotent.
--
-- The recovered migration 16 tracks allocation vs usage but has nowhere to
-- record a derived state or an alert that has already gone out. These columns
-- are deliberately the SAME shape the VM/app alerter already uses
-- (status / alerted / last_alerted_at, own contact falling back to the
-- client's), so src/lib/alerts.ts throttling applies unchanged rather than a
-- second set of rules being invented for credits.
-- ============================================================================

-- Derived from remaining % against the two thresholds, so the Pill component
-- renders it exactly like a VM's: healthy / warning (low) / down (critical).
alter table public.openai_accounts add column if not exists status text not null default 'healthy';

-- Per-account WhatsApp recipient. Blank falls back to the client's alert_phone,
-- matching how vms.alert_phone / apps.alert_phone already behave.
alter table public.openai_accounts add column if not exists alert_name  text;
alter table public.openai_accounts add column if not exists alert_phone text;

-- Throttling state, same semantics as vms/apps: `alerted` stops one incident
-- from messaging every cycle, `last_alerted_at` drives the 24h repeat while the
-- account is still low, and `low_since` records when it first crossed so the UI
-- can show how long it has been in that state.
alter table public.openai_accounts add column if not exists alerted         boolean not null default false;
alter table public.openai_accounts add column if not exists last_alerted_at timestamptz;
alter table public.openai_accounts add column if not exists low_since       timestamptz;

-- Postgres has no "add constraint if not exists"; swallowing duplicate_object
-- keeps a re-run harmless.
do $$ begin
  alter table public.openai_accounts
    add constraint openai_accounts_status_check check (status in ('healthy', 'warning', 'down'));
exception when duplicate_object then null;
end $$;

-- The alerter scans for accounts needing attention every cycle.
create index if not exists openai_accounts_status_idx on public.openai_accounts (status);
