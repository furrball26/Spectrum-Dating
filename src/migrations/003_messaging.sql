CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_a_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  archived_by_a INTEGER NOT NULL DEFAULT 0,
  archived_by_b INTEGER NOT NULL DEFAULT 0,
  UNIQUE(match_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  deleted         INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id          TEXT PRIMARY KEY,
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  details     TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier    TEXT NOT NULL DEFAULT 'in_app'
);

CREATE TABLE IF NOT EXISTS notification_rate_limit (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b_id);
