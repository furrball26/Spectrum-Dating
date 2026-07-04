-- 048 — chat safety signals (gap-analysis §Needed #4).
--
-- Off-platform / money (scam & grooming) detection already runs on the message
-- SEND path via server/src/utils/safetySignals.js, but until now it produced
-- ZERO moderation signal: the client showed a gentle, dismissible in-chat note
-- and nothing was ever logged. A groomer pushing someone off-platform therefore
-- generated no trail a moderator could see.
--
-- This table is that trail. It is OBSERVE-ONLY: a tripped message is NEVER
-- blocked or altered (calm-by-design) — we only APPEND one row here, attributed
-- to the SENDER, so a repeat off-platform / money pusher accrues a real,
-- reviewable "repeat-offender for grooming" signal. It feeds the moderation
-- console (report cards, member detail, user history) as a count.
--
-- Idempotent (CREATE ... IF NOT EXISTS) so it re-runs cleanly on every boot.
CREATE TABLE IF NOT EXISTS chat_safety_signals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,   -- the SENDER of the tripped message
  conversation_id TEXT,
  message_id      TEXT,
  signal_kind     TEXT NOT NULL,   -- 'off_platform' | 'money'
  created_at      INTEGER NOT NULL
);

-- The moderation console reads these by the reported/inspected user, so index
-- the sender column (COUNT(*) WHERE user_id = ?).
CREATE INDEX IF NOT EXISTS idx_chat_safety_signals_user ON chat_safety_signals(user_id);
