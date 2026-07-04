-- D-1 data fix — backfill Step-5 communication + sensory preferences onto the
-- @sample.spectrum-dating.app demo personas so the "How they communicate" chip
-- row and the mutual "You both…" ✓ reasons actually render (they were empty).
--
-- These are the exact columns scored by src/matching/score.js:
--   comm_directness      '' | 'direct' | 'softened'
--   comm_cadence         '' | 'instant' | 'daily' | 'whenever'
--   comm_literal         '' | 'literal' | 'playful'
--   sensory_environment  '' | 'quiet' | 'lively'   (score ignores 'either')
--   sensory_lighting     '' | 'dim' | 'bright'      (score ignores 'either')
--   social_duration      '' | 'short' | 'long'      (score ignores 'either'/'medium')
--
-- Scoped to the demo email domain only — NEVER touches real users. Values are
-- DETERMINISTIC + VARIED (bucketed by profiles.rowid, decorrelated per facet) so
-- the demo set is diverse and viewing a persona produces real mutual signals.
-- Idempotent: each UPDATE only fills rows where the column is still '' — so
-- re-running on every boot is a no-op once applied and never clobbers real edits.

UPDATE profiles SET comm_directness =
  CASE abs(rowid) % 2 WHEN 0 THEN 'direct' ELSE 'softened' END
WHERE comm_directness = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');

UPDATE profiles SET comm_cadence =
  CASE abs(rowid) % 3 WHEN 0 THEN 'instant' WHEN 1 THEN 'daily' ELSE 'whenever' END
WHERE comm_cadence = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');

UPDATE profiles SET comm_literal =
  CASE (abs(rowid) / 2) % 2 WHEN 0 THEN 'literal' ELSE 'playful' END
WHERE comm_literal = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');

UPDATE profiles SET sensory_environment =
  CASE (abs(rowid) / 3) % 2 WHEN 0 THEN 'quiet' ELSE 'lively' END
WHERE sensory_environment = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');

UPDATE profiles SET sensory_lighting =
  CASE abs(rowid) % 2 WHEN 0 THEN 'dim' ELSE 'bright' END
WHERE sensory_lighting = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');

UPDATE profiles SET social_duration =
  CASE (abs(rowid) / 2) % 2 WHEN 0 THEN 'short' ELSE 'long' END
WHERE social_duration = ''
  AND user_id IN (SELECT id FROM users WHERE email LIKE '%@sample.spectrum-dating.app');
