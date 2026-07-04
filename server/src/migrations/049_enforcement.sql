-- 049 — enforcement ladder + due-process (gap-analysis §Needed #7 + #11).
--
-- Until now the ONLY moderation action on a user was a single binary, reversible
-- `suspended` flag: no warn, no permanent ban, no severity, and an actioned user
-- got NO reason and NO way to appeal. This migration adds the two missing pieces:
--
--  1. `users.banned` — a PERMANENT ban, distinct from the reversible `suspended`.
--     A ban is intentionally harder to undo (its own endpoint); suspend stays the
--     lighter, routine lockout. Both force-logout via token_version at action time.
--
--  2. `enforcement_notices` — the due-process record. Every ladder action (warn /
--     suspend / unsuspend / ban) APPENDS one row here with the moderator's reason.
--     This is what an actioned user is shown ("your account was {…}: {reason}") so
--     they can see WHY and appeal via the existing feedback channel — the DSA
--     due-process norm, adapted to calm-by-design (a plain reason, no legalese).
--
-- ADD/CREATE only — never rebuilds users or reports. The `banned` ADD COLUMN is
-- tolerated as a no-op on re-boot by the runner's duplicate-column guard; the
-- table + index are CREATE ... IF NOT EXISTS, so the whole file re-runs cleanly.

ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS enforcement_notices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,   -- the actioned member
  kind            TEXT NOT NULL,   -- 'warn' | 'suspend' | 'unsuspend' | 'ban'
  reason          TEXT NOT NULL DEFAULT '',  -- the moderator's note, shown to the user
  created_at      INTEGER NOT NULL,
  acknowledged_at INTEGER          -- set when/if the user views the notice (reserved)
);

-- The moderation console + the login due-process surfacing both read the latest
-- notice for a given member, so index the user column.
CREATE INDEX IF NOT EXISTS idx_enforcement_notices_user ON enforcement_notices(user_id);
