-- D-11/D-12/D-13 — expanded gender (display) with a matchable-core mapping,
-- self-describe free text, and display-only sexual orientation.
--
-- THE LOAD-BEARING SAFETY INVARIANT: matching (server/src/matching/candidates.js)
-- must ONLY ever filter on a 3-value core — woman | man | nonbinary. The raw
-- `gender` string is now an expanded DISPLAY enum (agender, genderfluid,
-- trans-man, …); feeding it into the gender×seeking filter would silently break
-- matching. So we derive a stored `gender_group` (the 3-value core, or '') and
-- matching reads THAT — never the raw `gender`.
--
--   gender_custom : self-describe free text (≤40 chars). '' = unset.
--   gender_group  : matchable core — '' | 'woman' | 'man' | 'nonbinary'.
--                   Computed from `gender` on every PUT /profile/me; this
--                   backfill seeds it for existing rows.
--   orientation   : DISPLAY-ONLY. comma-joined multi-select mirroring `seeking`
--                   serialisation. NEVER read by candidates.js.
ALTER TABLE profiles ADD COLUMN gender_custom TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN gender_group  TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN orientation   TEXT NOT NULL DEFAULT '';

-- Backfill gender_group from the existing (legacy) gender values.
--   woman→woman, man→man, nonbinary→nonbinary, other/'' → '' (no core group).
-- Guarded by `WHERE gender_group = ''` so re-running never clobbers a value the
-- route has since computed from an expanded gender (idempotent).
UPDATE profiles SET gender_group = CASE gender
    WHEN 'woman'     THEN 'woman'
    WHEN 'man'       THEN 'man'
    WHEN 'nonbinary' THEN 'nonbinary'
    ELSE ''
  END
WHERE gender_group = '';
