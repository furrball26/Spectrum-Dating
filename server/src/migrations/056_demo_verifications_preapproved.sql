-- 056 — pre-approve the ALREADY-LIVE demo members' verification requests so they
-- leave the moderation verification queue immediately on deploy.
--
-- BACKGROUND: telemetry/demoSeed.js historically seeded 8 'pending'
-- verification_requests for unverified demo members. The moderation verification
-- queue (admin.js GET /verification-requests, WHERE status='pending') then shows
-- each one's profile pic for review — cluttering the queue with fake profiles a
-- moderator can never meaningfully action. The seed no longer creates these; THIS
-- migration cleans up the ~8 rows that were ALREADY seeded on the live DB so the
-- queue clears on boot without an admin "Load demo data" reload.
--
-- SCOPE — narrow, idempotent, one-time DATA fix (not a table rebuild):
--   • Touches ONLY the reserved telemetry-demo- demo members, matched by the
--     EXACT demo-identification predicate from demoSeed.js
--     (email LIKE 'telemetry-demo-%@sample.spectrum-dating.app' == DEMO_MEMBER_LIKE).
--     It does NOT match any real user, nor the other @sample seed personas (e.g.
--     the Phoenix seed users harper.quinn.phx@sample…) which lack the prefix.
--   • Additive/UPDATE only. No table rebuild; no schema change.
--   • Idempotent: once no demo request is 'pending', the first UPDATE matches
--     nothing on every subsequent boot; the second only ever re-sets an already-1
--     flag to 1 — harmless.

-- Approve any pending verification requests belonging to demo members so they
-- leave the moderation verification queue immediately on deploy. reviewed_at is
-- epoch-ms (matches admin.js Date.now()); strftime gives second granularity.
UPDATE verification_requests
   SET status = 'approved', reviewed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE status = 'pending'
   AND user_id IN (SELECT id FROM users WHERE email LIKE 'telemetry-demo-%@sample.spectrum-dating.app');

-- Reflect the approval on the profile (an approved verification = verified badge).
UPDATE profiles
   SET identity_verified = 1
 WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'telemetry-demo-%@sample.spectrum-dating.app')
   AND user_id IN (SELECT user_id FROM verification_requests WHERE status = 'approved');
