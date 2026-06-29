-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (emoji IN ('♥', '👍', '😊', '😄', '🤔')),
  created_at INTEGER NOT NULL,
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- Photo attachment metadata (no actual file storage -- object store key only)
CREATE TABLE IF NOT EXISTS message_attachments (
  id               TEXT PRIMARY KEY,
  message_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  file_size_bytes  INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  upload_status    TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending','scanned','approved','rejected')),
  scanned_at       INTEGER,
  created_at       INTEGER NOT NULL
);
