-- E6 — account deletion must NOT cascade away moderation evidence.
--
-- In 010_moderation.sql, reports.reporter_id and reported_id were declared
-- `ON DELETE CASCADE`, so a user self-deleting erased BOTH the reports they
-- filed AND every report filed AGAINST them — an abuser could wipe their trail
-- by deleting their account. This rebuilds `reports` with `ON DELETE SET NULL`
-- so the report row (reason/details/status/moderator_note) SURVIVES a user
-- deletion; only the user link is nulled.
--
-- SQLite cannot ALTER a constraint, so we rebuild the table. This migration is
-- GUARDED in the runner (src/db.js): it is skipped entirely once reports'
-- foreign keys are already SET NULL, so it is safe to boot more than once and
-- never rebuilds twice / never loses existing report rows.
--
-- reporter_id / reported_id are now NULLABLE (required for SET NULL) — the app
-- never inserts a null (see messaging.js /report), it only becomes null via a
-- user deletion. Admin queries already LEFT JOIN profiles on these ids.

CREATE TABLE reports_new (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reported_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  conversation_id TEXT,
  reason         TEXT NOT NULL,
  details        TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  moderator_note TEXT,
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);

INSERT INTO reports_new
  (id, reporter_id, reported_id, conversation_id, reason, details, status, moderator_note, created_at, resolved_at)
  SELECT id, reporter_id, reported_id, conversation_id, reason, details, status, moderator_note, created_at, resolved_at
  FROM reports;

DROP TABLE reports;

ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
