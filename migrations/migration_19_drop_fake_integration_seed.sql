-- ============================================================================
-- FWAI Tracker — migration 19: remove the misleading seeded integration rows
-- Run after migration 18. Idempotent.
--
-- `integrations` is an operator-maintained note board. `status` is a value
-- somebody types; nothing in the app ever health-checks the service behind a
-- row. migration.sql nevertheless seeded four rows asserting states nobody had
-- verified, and the Settings page rendered 'healthy' as the word "Connected":
--
--   AWS (EC2)          healthy  -> "Connected"   (may have no cloud_account)
--   Zoom               healthy  -> "Connected"   (may have no zoom_account)
--   WhatsApp Business  healthy  -> "Connected"   detail said "Twilio · Ops group"
--                                                 — Twilio appears NOWHERE in this
--                                                 codebase; WhatsApp goes via AI Sensy
--   GoHighLevel        warning  -> "Token expired" — GoHighLevel appears NOWHERE
--                                                 in this codebase
--
-- So a fresh install displayed four connected-looking services before it had a
-- single client, two of them for integrations that do not exist.
--
-- The seed is gone from migration.sql for new installs. This removes it from
-- installs that already got it.
--
-- SCOPED DELIBERATELY NARROWLY: a row is only removed when it still matches the
-- seed EXACTLY on name + detail + status. Anything an operator renamed, edited,
-- re-described or re-statused is theirs and is left completely alone. Rows added
-- by hand are never touched. Nothing else in the table is affected, and no
-- application functionality depends on this table — AWS, Zoom, AI Sensy and
-- OpenAI all read their real credentials from cloud_accounts / zoom_accounts /
-- app_settings / openai_accounts, never from here.
-- ============================================================================

delete from public.integrations i
 where (i.name, i.detail, i.status) in (
   ('AWS (EC2)',         'Read-only · ap-south-1', 'healthy'),
   ('Zoom',              'Server-to-Server OAuth', 'healthy'),
   ('WhatsApp Business', 'Twilio · Ops group',     'healthy'),
   ('GoHighLevel',       'Webinar email delivery', 'warning')
 );
