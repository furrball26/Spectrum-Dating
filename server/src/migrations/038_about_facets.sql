-- F28 — structured "about me" facets (all optional, calm-by-design scannable rows).
-- Two short free-text facets + two short lists.
--   occupation  : short free text (≤80 chars)   — e.g. "Librarian" / "Studying biology"
--   languages   : short free text (≤120 chars)  — e.g. "English, ASL"
-- The two list facets are stored as a JSON array string (e.g. '["Clear plans","Text over calls"]').
-- Empty = '' (NOT a literal '[]'); the routes parse '' back to [] and serialise
-- an empty list to '' so "unset" and "empty list" read identically.
--   helps_me    : list, ≤5 items, each ≤60 chars — "Things that help me"
--   hard_for_me : list, ≤5 items, each ≤60 chars — "Things that are hard for me"
ALTER TABLE profiles ADD COLUMN occupation  TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN languages   TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN helps_me    TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN hard_for_me TEXT NOT NULL DEFAULT '';
