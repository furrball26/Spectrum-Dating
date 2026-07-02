ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_verifications (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id);
