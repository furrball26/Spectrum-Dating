-- E2 — message photo-attachment human-review queue.
--
-- The attachment lifecycle is: pending -> pending_review -> approved | rejected.
-- The status 'scanned' is RETIRED (it implied a scan that never happened).
--
-- Two changes are needed on message_attachments:
--   1. Add reviewer bookkeeping columns: reviewed_at INTEGER, reviewed_by TEXT.
--   2. Widen the upload_status CHECK constraint. In 004_reactions_photos.sql the
--      column was declared:
--        upload_status TEXT NOT NULL DEFAULT 'pending'
--          CHECK (upload_status IN ('pending','scanned','approved','rejected'))
--      That CHECK does NOT allow 'pending_review', so an INSERT/UPDATE with the
--      new status would be rejected. SQLite cannot ALTER a CHECK constraint, so
--      we REBUILD the table (create-copy-drop-rename) preserving every row and
--      index, exactly the way 030_reports_preserve_evidence.sql did.
--
-- This migration is GUARDED in the runner (src/db.js): it is skipped once the
-- table already accepts 'pending_review' (detected by trying an EXPLAIN-safe
-- probe in the guard), so it is safe to boot more than once and never rebuilds
-- twice / never loses existing attachment rows. The whole file runs inside ONE
-- transaction.

-- New table with the widened CHECK and the two reviewer columns. All other
-- columns/definitions are preserved verbatim from 004 + 005 (public_url).
CREATE TABLE message_attachments_new (
  id               TEXT PRIMARY KEY,
  message_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  file_size_bytes  INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  upload_status    TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending','pending_review','approved','rejected')),
  scanned_at       INTEGER,
  public_url       TEXT NOT NULL DEFAULT '',
  reviewed_at      INTEGER,
  reviewed_by      TEXT,
  created_at       INTEGER NOT NULL
);

-- Copy every existing row. Any legacy 'scanned' rows are migrated forward to
-- 'pending_review' so they re-enter the review queue rather than violating the
-- new CHECK.
INSERT INTO message_attachments_new
  (id, message_id, uploader_id, storage_key, mime_type, file_size_bytes, upload_status, scanned_at, public_url, reviewed_at, reviewed_by, created_at)
  SELECT id, message_id, uploader_id, storage_key, mime_type, file_size_bytes,
         CASE upload_status WHEN 'scanned' THEN 'pending_review' ELSE upload_status END,
         scanned_at, public_url, NULL, NULL, created_at
  FROM message_attachments;

DROP TABLE message_attachments;

ALTER TABLE message_attachments_new RENAME TO message_attachments;
