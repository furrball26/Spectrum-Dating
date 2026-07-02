-- Give demo/sample accounts sample portrait photos so profiles aren't blank
-- monograms in demos. External hotlinked images (randomuser.me) — no R2 needed.
-- Scoped to sample accounts + the demo admin. Idempotent: only fills empty
-- photo_url, so re-running on every boot is a no-op once applied.

UPDATE profiles SET photo_url = CASE (SELECT email FROM users u WHERE u.id = profiles.user_id)
  WHEN 'quiet.cartographer.0@sample.spectrum-dating.app' THEN 'https://randomuser.me/api/portraits/men/32.jpg'
  WHEN 'mira.k.1@sample.spectrum-dating.app'             THEN 'https://randomuser.me/api/portraits/women/44.jpg'
  WHEN 'dev.2@sample.spectrum-dating.app'                THEN 'https://randomuser.me/api/portraits/men/45.jpg'
  WHEN 'rowan.ashby.3@sample.spectrum-dating.app'        THEN 'https://randomuser.me/api/portraits/women/68.jpg'
  WHEN 'priya.s.4@sample.spectrum-dating.app'            THEN 'https://randomuser.me/api/portraits/women/65.jpg'
  WHEN 'sam.halloran.5@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/men/52.jpg'
  WHEN 'toby.6@sample.spectrum-dating.app'               THEN 'https://randomuser.me/api/portraits/men/12.jpg'
  WHEN 'nadia.okonkwo.7@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/57.jpg'
  WHEN 'eli.brenner.8@sample.spectrum-dating.app'        THEN 'https://randomuser.me/api/portraits/men/64.jpg'
  WHEN 'wren.9@sample.spectrum-dating.app'               THEN 'https://randomuser.me/api/portraits/women/29.jpg'
  WHEN 'hassan.reyes.10@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/77.jpg'
  WHEN 'june.park.11@sample.spectrum-dating.app'         THEN 'https://randomuser.me/api/portraits/women/9.jpg'
  WHEN 'marco.12@sample.spectrum-dating.app'             THEN 'https://randomuser.me/api/portraits/men/3.jpg'
  WHEN 'ana.beltran.13@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/women/16.jpg'
  WHEN 'felix.nordmann.14@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/41.jpg'
  WHEN 'indira.v.15@sample.spectrum-dating.app'          THEN 'https://randomuser.me/api/portraits/women/72.jpg'
  WHEN 'casper.16@sample.spectrum-dating.app'            THEN 'https://randomuser.me/api/portraits/men/18.jpg'
  WHEN 'leena.abadi.17@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/women/85.jpg'
  WHEN 'gabriel.stowe.18@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/55.jpg'
  WHEN 'sora.19@sample.spectrum-dating.app'              THEN 'https://randomuser.me/api/portraits/women/33.jpg'
  WHEN 'bex.carlin.20@sample.spectrum-dating.app'        THEN 'https://randomuser.me/api/portraits/women/48.jpg'
  WHEN 'omar.haddad.21@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/men/60.jpg'
  WHEN 'talia.friedman.22@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/76.jpg'
  WHEN 'kit.23@sample.spectrum-dating.app'               THEN 'https://randomuser.me/api/portraits/men/8.jpg'
  WHEN 'ttitleman@gmail.com'                             THEN 'https://randomuser.me/api/portraits/women/90.jpg'
  ELSE photo_url END
WHERE photo_url = '';

-- Mirror the photo into the gallery table so the profile photo grid shows it too.
INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at)
SELECT profiles.user_id || '-demo-photo', profiles.user_id, '', profiles.photo_url, 0, 1, COALESCE(profiles.updated_at, 0)
FROM profiles
WHERE profiles.photo_url LIKE 'https://randomuser.me/%'
  AND NOT EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = profiles.user_id);
