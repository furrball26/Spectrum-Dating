CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
