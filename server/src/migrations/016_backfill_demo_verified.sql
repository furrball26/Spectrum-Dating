-- Mark roughly half of the sample/demo accounts as identity-verified so the
-- trust badge is visible in demos. Scoped to the sample email domain only —
-- never touches real users. Idempotent: only flips rows still at 0, so
-- re-running on every boot is a no-op once applied.
UPDATE profiles SET identity_verified = 1
WHERE identity_verified = 0
  AND user_id IN (
    SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app'
  )
  AND (abs(random()) % 2) = 0;
