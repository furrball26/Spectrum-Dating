-- Users (auth identities)
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL  -- Unix epoch ms
);

-- Profiles (what other users see)
CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL DEFAULT '',
  tagline         TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  comm_note       TEXT NOT NULL DEFAULT '',
  relationship_goal TEXT NOT NULL DEFAULT '',  -- '' | 'long-term' | 'friendship' | 'open'
  dist_city       TEXT NOT NULL DEFAULT '',
  notification_tier TEXT NOT NULL DEFAULT 'in_app',  -- 'in_app' | 'silent_push' | 'name_only'
  updated_at      INTEGER NOT NULL  -- Unix epoch ms
);

-- User interests (separate table -- one row per interest)
CREATE TABLE IF NOT EXISTS user_interests (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest TEXT NOT NULL,
  PRIMARY KEY (user_id, interest)
);
