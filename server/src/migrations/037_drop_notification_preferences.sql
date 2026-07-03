-- F29 — drop the orphaned notification_preferences table.
--
-- 003_messaging.sql created notification_preferences(user_id, tier) but the live
-- notification tier is stored on profiles.notification_tier — nothing reads or
-- writes notification_preferences anywhere in the codebase. Remove the dead
-- table so the schema reflects reality. Idempotent (IF EXISTS) so re-running the
-- migration on any boot is a harmless no-op.

DROP TABLE IF EXISTS notification_preferences;
