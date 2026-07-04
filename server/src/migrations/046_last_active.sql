-- Admin-only "last active" DATE (not timestamp) for the member-management drawer.
--
-- PRIVACY: DATE-only (YYYY-MM-DD), lazily updated at most once per user per day
-- on an authed request, and NEVER serialized to public/member responses — only
-- the admin member listing/detail expose it. A public "last seen" would violate
-- calm-by-design; this is a moderation-ops signal only.
--
-- ADD COLUMN ONLY — never rebuild `users`. Idempotent via the runner's
-- "duplicate column name" tolerance (src/db.js).
ALTER TABLE users ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '';
