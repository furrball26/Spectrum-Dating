-- 051 — moderator QA / decision re-review sampling (gap-analysis §Nice-to-have,
-- moderator QA / calibration).
--
-- Trust & Safety teams periodically re-review a random sample of ALREADY-RESOLVED
-- moderation decisions to check consistency BETWEEN moderators. This is a calm,
-- calibration-only record: an admin pulls a small random sample of resolved
-- reports they did NOT resolve themselves, and marks each Agree/Disagree with an
-- optional short note. NO punitive action ever flows from a QA review — it is
-- quality tracking, not public scoring of moderators.
--
--   report_id   — the resolved report being re-reviewed.
--   reviewer_id — the admin who did the QA re-review (never the original
--                 resolver — you can't QA your own decision).
--   verdict     — 'agree' | 'disagree' with the original decision.
--   note        — optional short free-text calibration note.
--   created_at  — when the QA review was recorded (ISO string, matches the
--                 timestamp pattern used by the newId()/now callers elsewhere).
--
-- CREATE ... IF NOT EXISTS only — this migration never rebuilds an existing
-- table, so it re-runs cleanly on every boot.
CREATE TABLE IF NOT EXISTS moderation_qa_reviews (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,          -- admin who did the QA re-review
  verdict TEXT NOT NULL,              -- 'agree' | 'disagree'
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_report ON moderation_qa_reviews(report_id);
CREATE INDEX IF NOT EXISTS idx_qa_reviews_reviewer ON moderation_qa_reviews(reviewer_id);
