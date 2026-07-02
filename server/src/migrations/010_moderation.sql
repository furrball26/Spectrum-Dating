-- Dedicated reports table for moderator review (separate from blocks)
CREATE TABLE IF NOT EXISTS reports (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  reason         TEXT NOT NULL,
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'open',   -- open | reviewed | actioned | dismissed
  moderator_note TEXT,
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);

-- User suspension for moderation
ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
