CREATE TABLE IF NOT EXISTS profile_prompts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,
  answer     TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_prompts_user ON profile_prompts(user_id, position);
