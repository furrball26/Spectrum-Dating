-- Add per-photo alt-text / description field.
-- Empty string default means existing rows are unaffected; the listPhotos helper
-- will return '' for undescribed photos and callers fall back to a name-based alt.
ALTER TABLE profile_photos ADD COLUMN description TEXT NOT NULL DEFAULT '';
