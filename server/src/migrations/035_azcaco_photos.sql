-- Sample portrait photos for the 50 AZ/CA/CO sample users (same approach as 021
-- and 022: external hotlinked randomuser.me images, no R2 needed). Indices are
-- chosen to NOT collide with any face already used in 021 or 022. Idempotent —
-- only fills an empty photo_url, so re-running on boot is a no-op once applied.

UPDATE profiles SET photo_url = CASE (SELECT email FROM users u WHERE u.id = profiles.user_id)
  WHEN 'wren.calloway.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/women/0.jpg'
  WHEN 'hector.villalobos.azcaco@sample.spectrum-dating.app' THEN 'https://randomuser.me/api/portraits/men/0.jpg'
  WHEN 'juniper.hale.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/2.jpg'
  WHEN 'marcus.dunbar.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/1.jpg'
  WHEN 'sofia.reyes.azcaco@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/women/3.jpg'
  WHEN 'oren.blackwood.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/2.jpg'
  WHEN 'priya.nair.azcaco@sample.spectrum-dating.app'        THEN 'https://randomuser.me/api/portraits/women/4.jpg'
  WHEN 'gabriel.moss.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/4.jpg'
  WHEN 'delphine.okonkwo.azcaco@sample.spectrum-dating.app'  THEN 'https://randomuser.me/api/portraits/women/5.jpg'
  WHEN 'silas.rourke.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/6.jpg'
  WHEN 'amelia.frost.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/7.jpg'
  WHEN 'roman.petrov.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/7.jpg'
  WHEN 'kai.hoffmann.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/9.jpg'
  WHEN 'noelle.aguilar.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/8.jpg'
  WHEN 'ezra.lindgren.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/10.jpg'
  WHEN 'thea.castellano.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/women/10.jpg'
  WHEN 'dorian.abara.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/men/13.jpg'
  WHEN 'clara.benedetti.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/women/11.jpg'
  WHEN 'julian.ferreira.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/men/14.jpg'
  WHEN 'maya.okonjo.azcaco@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/women/13.jpg'
  WHEN 'felix.novak.azcaco@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/men/16.jpg'
  WHEN 'anaya.krishnan.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/14.jpg'
  WHEN 'theo.marchetti.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/15.jpg'
  WHEN 'harriet.nakamura.azcaco@sample.spectrum-dating.app'  THEN 'https://randomuser.me/api/portraits/women/17.jpg'
  WHEN 'omar.haddad.azcaco@sample.spectrum-dating.app'       THEN 'https://randomuser.me/api/portraits/men/17.jpg'
  WHEN 'lena.abernathy.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/18.jpg'
  WHEN 'idris.calloway.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/19.jpg'
  WHEN 'rosalind.mbeki.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/20.jpg'
  WHEN 'callum.rivera.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/20.jpg'
  WHEN 'aria.solberg.azcaco@sample.spectrum-dating.app'      THEN 'https://randomuser.me/api/portraits/women/21.jpg'
  WHEN 'nikolai.reyes.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/21.jpg'
  WHEN 'imogen.bassett.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/22.jpg'
  WHEN 'tobias.underwood.azcaco@sample.spectrum-dating.app'  THEN 'https://randomuser.me/api/portraits/men/23.jpg'
  WHEN 'wren.delacroix.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/24.jpg'
  WHEN 'august.hollis.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/26.jpg'
  WHEN 'saoirse.linden.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/24.jpg'
  WHEN 'dmitri.vasquez.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/27.jpg'
  WHEN 'freya.osei.azcaco@sample.spectrum-dating.app'        THEN 'https://randomuser.me/api/portraits/women/25.jpg'
  WHEN 'lachlan.reeves.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/men/28.jpg'
  WHEN 'penelope.aoki.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/women/26.jpg'
  WHEN 'mateo.bianchi.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/29.jpg'
  WHEN 'edith.nakashima.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/women/27.jpg'
  WHEN 'soren.adeyemi.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/30.jpg'
  WHEN 'marlowe.finch.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/women/28.jpg'
  WHEN 'beatrix.solano.azcaco@sample.spectrum-dating.app'    THEN 'https://randomuser.me/api/portraits/women/31.jpg'
  WHEN 'quentin.abara.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/men/31.jpg'
  WHEN 'cordelia.mwangi.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/women/32.jpg'
  WHEN 'hendrik.osborne.azcaco@sample.spectrum-dating.app'   THEN 'https://randomuser.me/api/portraits/men/33.jpg'
  WHEN 'vivienne.tran.azcaco@sample.spectrum-dating.app'     THEN 'https://randomuser.me/api/portraits/women/34.jpg'
  WHEN 'rafael.stromberg.azcaco@sample.spectrum-dating.app'  THEN 'https://randomuser.me/api/portraits/men/34.jpg'
  ELSE photo_url END
WHERE photo_url = ''
  AND (SELECT email FROM users u WHERE u.id = profiles.user_id) LIKE '%.azcaco@sample.spectrum-dating.app';

-- Mirror into the gallery so the profile photo grid shows them too.
INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, created_at)
SELECT profiles.user_id || '-azcaco-photo', profiles.user_id, '', profiles.photo_url, 0, 1, COALESCE(profiles.updated_at, 0)
FROM profiles
WHERE profiles.photo_url LIKE 'https://randomuser.me/%'
  AND (SELECT email FROM users u WHERE u.id = profiles.user_id) LIKE '%.azcaco@sample.spectrum-dating.app'
  AND NOT EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = profiles.user_id);
