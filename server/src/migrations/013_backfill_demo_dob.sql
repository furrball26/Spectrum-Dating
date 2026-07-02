-- Give demo/sample accounts a valid adult date of birth so the 18+ age gate
-- doesn't hide them from Discover. Scoped to the sample email domain only —
-- never touches real users. Idempotent: only fills empty DOBs, so re-running on
-- every boot is a no-op once applied. Varied values so demo ages look natural.
UPDATE profiles
SET date_of_birth = CASE abs(random()) % 6
  WHEN 0 THEN '1990-03-21'
  WHEN 1 THEN '1994-07-08'
  WHEN 2 THEN '1988-11-30'
  WHEN 3 THEN '1997-02-14'
  WHEN 4 THEN '1992-09-05'
  ELSE '1985-12-19'
END
WHERE date_of_birth = ''
  AND user_id IN (
    SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app'
  );
