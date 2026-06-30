-- Append-only audit trail for moderation actions (suspend/unsuspend, verify,
-- report-resolve). Gives accountability + an abuse-of-admin trail.
CREATE TABLE IF NOT EXISTS moderation_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,         -- the admin who acted
  action      TEXT NOT NULL,         -- 'suspend' | 'unsuspend' | 'verify' | 'unverify' | 'resolve_report'
  target_id   TEXT,                  -- affected user or report id
  detail      TEXT NOT NULL DEFAULT '', -- e.g. resolution status + note
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modlog_created ON moderation_log (created_at DESC);
