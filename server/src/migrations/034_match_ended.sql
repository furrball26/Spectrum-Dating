-- F21 unmatch acknowledgement: soft-end a match instead of hard-deleting it, so
-- the person who was unmatched keeps a READ-ONLY thread with a neutral notice
-- ("This conversation has ended.") rather than the pair silently vanishing.
--
-- ended_at: epoch ms the match was ended (NULL = still active).
-- ended_by: the user_id of whoever ended it. Server-only — NEVER returned to the
--           other party (no "X unmatched you"). Used purely for authz/audit.
--
-- Idempotent: the migration runner tolerates "duplicate column name" per-statement,
-- so re-running on an already-migrated DB is a safe no-op.
ALTER TABLE matches ADD COLUMN ended_at INTEGER;
ALTER TABLE matches ADD COLUMN ended_by TEXT;
