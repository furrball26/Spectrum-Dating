-- 050 — evidence-on-report: reporter-pinned offending message (gap-analysis
-- §Needed #10).
--
-- Until now a report snapshotted only the reported user's LAST FEW messages
-- (044). An older offending message falls outside that window, so a moderator
-- could triage without ever seeing the message that actually prompted the
-- report. This migration lets a report carry the SPECIFIC message the reporter
-- flagged, frozen at report time alongside the widened general snapshot:
--
--   reported_message_id — the id of the pinned message (nullable; the
--     no-message report path leaves it NULL). Kept so the moderator UI can
--     highlight exactly that message inside the live conversation view.
--   pinned_message      — the frozen text of the pinned message, so the
--     evidence survives even after the live conversation CASCADE-deletes
--     (mirrors the reported_message durability pattern in 044).
--
-- ADD COLUMN ONLY — never rebuild `reports` (the abuse-evidence trail, see 030).
-- Idempotent via the runner's "duplicate column name" tolerance (src/db.js).
ALTER TABLE reports ADD COLUMN reported_message_id TEXT;
ALTER TABLE reports ADD COLUMN pinned_message TEXT;
