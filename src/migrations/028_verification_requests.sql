-- Tracks self-serve identity-verification requests submitted by users.
-- One row per user (UNIQUE on user_id). status: 'pending' | 'approved' | 'rejected'.
-- 'approved' mirrors identity_verified=1 on profiles (both stay in sync via the
-- admin verify endpoint); 'rejected' lets the user know they can try again.
CREATE TABLE IF NOT EXISTS verification_requests (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  reviewed_at  INTEGER
);
