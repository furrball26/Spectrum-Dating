-- F6: weekly email digest — OPT-IN, OFF by default (privacy-first).
-- weekly_digest: 1 = user has opted in to the weekly digest email; 0 = off.
-- last_digest_sent_at: epoch ms of the last digest we sent this user; drives the
-- "since last digest" window (0 = never sent → falls back to a 7-day window).
-- Idempotent via the per-statement runner (tolerates "duplicate column name").
ALTER TABLE profiles ADD COLUMN weekly_digest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN last_digest_sent_at INTEGER NOT NULL DEFAULT 0;
