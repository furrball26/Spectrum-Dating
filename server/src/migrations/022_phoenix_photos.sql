-- Sample portrait photos for the 20 Phoenix-metro sample users (same approach as
-- 021: external hotlinked randomuser.me images, no R2 needed). Idempotent — only
-- fills an empty photo_url, so re-running on boot is a no-op once applied.

UPDATE profiles SET photo_url = CASE (SELECT email FROM users u WHERE u.id = profiles.user_id)
  WHEN 'harper.quinn.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/1.jpg'
  WHEN 'diego.salazar.phx@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/men/5.jpg'
  WHEN 'noor.hassan.phx@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/women/6.jpg'
  WHEN 'theo.lindqvist.phx@sample.spectrum-dating.app'  THEN 'https://randomuser.me/api/portraits/men/11.jpg'
  WHEN 'priscilla.vance.phx@sample.spectrum-dating.app' THEN 'https://randomuser.me/api/portraits/women/12.jpg'
  WHEN 'ravi.menon.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/15.jpg'
  WHEN 'sage.whitman.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/19.jpg'
  WHEN 'lucia.moreno.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/23.jpg'
  WHEN 'owen.frost.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/22.jpg'
  WHEN 'amara.okafor.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/30.jpg'
  WHEN 'felix.brandt.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/25.jpg'
  WHEN 'mei.tanaka.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/38.jpg'
  WHEN 'caleb.ortiz.phx@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/40.jpg'
  WHEN 'iris.kovac.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/42.jpg'
  WHEN 'jonah.reed.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/47.jpg'
  WHEN 'talia.bishop.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/50.jpg'
  WHEN 'marcus.lee.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/51.jpg'
  WHEN 'nadia.petrova.phx@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/women/53.jpg'
  WHEN 'eli.tanaka.phx@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/53.jpg'
  WHEN 'rosa.delgado.phx@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/55.jpg'
  ELSE photo_url END
WHERE photo_url = ''
  AND (SELECT email FROM users u WHERE u.id = profiles.user_id) LIKE '%.phx@sample.spectrum-dating.app';

-- Mirror into the gallery so the profile photo grid shows them too.
INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at)
SELECT profiles.user_id || '-phx-photo', profiles.user_id, '', profiles.photo_url, 0, 1, COALESCE(profiles.updated_at, 0)
FROM profiles
WHERE profiles.photo_url LIKE 'https://randomuser.me/%'
  AND (SELECT email FROM users u WHERE u.id = profiles.user_id) LIKE '%.phx@sample.spectrum-dating.app'
  AND NOT EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = profiles.user_id);
