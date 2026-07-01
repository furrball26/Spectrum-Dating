-- F13: private, owner-only "note to self" on a match. Each user has their OWN
-- private note per match (composite PK on user_id + match_id). Never shared with
-- the other member of the match. ON DELETE CASCADE so notes vanish with the
-- user or the match.
CREATE TABLE IF NOT EXISTS match_notes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_match_notes_match ON match_notes(match_id);
