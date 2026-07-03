-- SAFETY-2 — human review queue for PROFILE photos (mirrors 031's message-
-- attachment review). New profile photos must be admin-approved before they are
-- served to anyone but their owner.
--
-- Adds three columns to profile_photos:
--   review_status TEXT NOT NULL DEFAULT 'pending_review'  ('pending_review'|'approved'|'rejected')
--   reviewed_at   INTEGER  (nullable — set when a moderator decides)
--   reviewed_by   TEXT     (nullable — moderator user id)
--
-- CRITICAL BACKFILL: every row that already exists is set to 'approved'. Nobody
-- who is currently visible on Discover/matches must disappear because we added a
-- review gate. A fresh ADD COLUMN with DEFAULT 'pending_review' first stamps all
-- existing rows 'pending_review'; the UPDATE below then promotes them to
-- 'approved'. Only genuinely NEW uploads (inserted by photos.js after this
-- migration) start life 'pending_review'.
--
-- This migration is GUARDED in the runner (src/db.js): it runs only when the
-- review_status column does not yet exist, and runs as ONE transaction. That is
-- what makes the blanket "UPDATE ... SET review_status = 'approved'" safe — it
-- fires exactly once, at add time, and never re-approves a later moderation
-- decision on a subsequent boot.

ALTER TABLE profile_photos ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending_review';
ALTER TABLE profile_photos ADD COLUMN reviewed_at INTEGER;
ALTER TABLE profile_photos ADD COLUMN reviewed_by TEXT;

-- Backfill: everyone already in the gallery stays visible.
UPDATE profile_photos SET review_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_profile_photos_review ON profile_photos(review_status);
