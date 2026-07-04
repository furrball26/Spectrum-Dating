-- Opt-in "Message Request / Intro" (Phase 1). An intro lets a member reach a
-- NON-match with ONE screened text row — it never creates a parallel messaging
-- path. Pre-accept there is NO conversation/room/socket between the pair; ACCEPT
-- mints a real match + conversation via the EXISTING canonical-order path so all
-- existing safety (block-drops-room, unmatch, convo cap, report) applies for free.
--
-- UNIQUE(sender_id, recipient_id) + never-delete = the one-directed-intro-EVER
-- backbone (mirrors the swipe one-shot): no re-send after decline/withdraw; the
-- row only ever transitions status. conversation_id ON DELETE SET NULL keeps the
-- intro text as a durable mod trail even after a convo is deleted (per 043/044).
CREATE TABLE IF NOT EXISTS message_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intro TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  UNIQUE(sender_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_msgreq_recipient ON message_requests(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_msgreq_sender ON message_requests(sender_id, status);
