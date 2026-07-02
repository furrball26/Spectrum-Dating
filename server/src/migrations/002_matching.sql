-- Swipes: a user's decision on a candidate (like or skip)
CREATE TABLE IF NOT EXISTS swipes (
  id          TEXT PRIMARY KEY,
  swiper_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  swiped_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision    TEXT NOT NULL CHECK (decision IN ('like', 'skip')),
  created_at  INTEGER NOT NULL,
  UNIQUE(swiper_id, swiped_id)
);

-- Matches: created when two users both like each other
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  user_a_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_at  INTEGER NOT NULL,
  -- Ensure no duplicate pairs (canonical order: user_a_id < user_b_id)
  UNIQUE(user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_swipes_swiper ON swipes(swiper_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b_id);
