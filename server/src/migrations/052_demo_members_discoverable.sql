-- 052 — make the ALREADY-LIVE demo members discoverable in the Discover deck.
--
-- The demo dataset (telemetry/demoSeed.js) historically created its 500 demo
-- members with profiles.paused = 1 ("deck-safety"), which hid them from other
-- users' Discover deck (matching/candidates.js requires p.paused = 0). We are
-- intentionally reversing that so the live client sees a populated deck for the
-- demo. demoSeed.js now inserts fresh demo members with paused = 0; THIS
-- migration flips the members that were ALREADY seeded before that change, so
-- the fix applies on deploy without an admin "Load demo data" reload.
--
-- SCOPE — this is a narrow, idempotent, one-time DATA fix (not a table rebuild):
--   • It touches ONLY the reserved telemetry-demo- demo members, matched by the
--     EXACT demo-identification predicate from demoSeed.js
--     (email LIKE 'telemetry-demo-%@sample.spectrum-dating.app'). It does NOT
--     match any real user, nor the other @sample seed personas (e.g. the
--     Phoenix seed users harper.quinn.phx@sample…) which lack the prefix.
--   • It changes ONLY profiles.paused. No other table (reports evidence trail,
--     users, telemetry) is touched — every separability guarantee (is_demo=1,
--     email exclusion from real dashboards, 100% wipeability) is unaffected.
--   • Idempotent: re-running only ever sets paused = 0 on the same demo rows —
--     harmless on every subsequent boot.
UPDATE profiles SET paused = 0
 WHERE user_id IN (
   SELECT id FROM users WHERE email LIKE 'telemetry-demo-%@sample.spectrum-dating.app'
 );
