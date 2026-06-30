CREATE TABLE IF NOT EXISTS profile_photos (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  url         TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_photos_user ON profile_photos(user_id, position);

-- Backfill: existing single photo_url becomes the user's primary gallery photo.
INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at)
SELECT user_id || '-legacy', user_id, '', photo_url, 0, 1, COALESCE(updated_at, 0)
FROM profiles
WHERE photo_url IS NOT NULL AND photo_url != ''
  AND NOT EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = profiles.user_id);
