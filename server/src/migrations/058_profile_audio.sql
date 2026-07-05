-- AUDIO SAFETY SPINE — human-review queue for PROFILE AUDIO prompt answers.
-- Mirrors profile_photos + 036 (SAFETY-2). A new audio answer is servable to
-- nobody but its owner until a moderator approves it; every clip carries a
-- REQUIRED, free member-typed transcript (a11y floor + moderator's fastest read
-- + the string the off-platform/scam detector runs over at submit time).
--
-- NO BLANKET-APPROVE BACKFILL (unlike 036, which had to promote pre-existing
-- gallery rows): this table is brand-new and empty, so every row legitimately
-- starts life 'pending_review'. Copying 036's `UPDATE ... SET 'approved'` here
-- would be a security bug. There is nothing to backfill.
--
-- Idempotent via CREATE TABLE / CREATE INDEX ... IF NOT EXISTS — safe to boot
-- more than once; needs no runner guard.

CREATE TABLE IF NOT EXISTS profile_audio (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_key     TEXT NOT NULL,           -- which prompt this answers (catalog key)
  storage_key    TEXT NOT NULL,           -- R2 object key: profile-audio/{userId}/{id}.{ext}
  url            TEXT NOT NULL DEFAULT '', -- public R2 URL (mirrors profile_photos.url)
  transcript     TEXT NOT NULL,           -- REQUIRED, non-empty; shown free to all viewers
  duration_ms    INTEGER,                 -- client-declared; clamped server-side
  mime_type      TEXT NOT NULL,
  review_status  TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review|approved|rejected
  reviewed_at    INTEGER,                 -- set when a moderator decides
  reviewed_by    TEXT,                    -- moderator user id
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_audio_user   ON profile_audio(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_audio_review ON profile_audio(review_status);
