import { scoreCandidate } from './score.js';
import { ageFromDob } from '../utils/time.js';
import { metroKey, distanceMiles } from '../utils/metros.js';

// Returns an array of candidate profiles the viewer hasn't swiped on yet,
// ordered by score (shared interests) descending.
// Excludes: the viewer themselves, users they've already swiped on, existing matches.

export function getCandidates(db, viewerId, viewerInterests) {
  // Viewer's own profile fields used for weighted scoring (goal + city) and
  // for evaluating the viewer's active deal-breaker filters.
  const viewerProfile = db.prepare(
    `SELECT relationship_goal, dist_city, wants_children, gender, seeking,
            db_wants_children, db_non_smoker, db_must_be_local, search_radius_miles,
            pref_age_min, pref_age_max,
            sensory_environment, comm_cadence,
            comm_directness, comm_literal, sensory_lighting, social_duration
     FROM profiles WHERE user_id = ?`
  ).get(viewerId);
  const viewer = {
    interests: viewerInterests,
    relationship_goal: viewerProfile?.relationship_goal ?? '',
    dist_city: viewerProfile?.dist_city ?? '',
    wants_children: viewerProfile?.wants_children ?? '',
    gender: viewerProfile?.gender ?? '',
    seeking: viewerProfile?.seeking ?? '',
    db_wants_children: !!viewerProfile?.db_wants_children,
    db_non_smoker: !!viewerProfile?.db_non_smoker,
    db_must_be_local: !!viewerProfile?.db_must_be_local,
    search_radius_miles: viewerProfile?.search_radius_miles ?? 0,
    pref_age_min: viewerProfile?.pref_age_min ?? 18,
    pref_age_max: viewerProfile?.pref_age_max ?? 99,
    sensory_environment: viewerProfile?.sensory_environment ?? '',
    comm_cadence: viewerProfile?.comm_cadence ?? '',
    comm_directness: viewerProfile?.comm_directness ?? '',
    comm_literal: viewerProfile?.comm_literal ?? '',
    sensory_lighting: viewerProfile?.sensory_lighting ?? '',
    social_duration: viewerProfile?.social_duration ?? '',
  };

  // Get IDs already swiped on
  const swipedIds = db.prepare(
    'SELECT swiped_id FROM swipes WHERE swiper_id = ?'
  ).all(viewerId).map(r => r.swiped_id);

  // Get IDs already matched with
  const matchedIds = db.prepare(
    'SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END as other_id FROM matches WHERE user_a_id = ? OR user_b_id = ?'
  ).all(viewerId, viewerId, viewerId).map(r => r.other_id);

  const excludeIds = new Set([viewerId, ...swipedIds, ...matchedIds]);

  // Get all profiles except excluded
  const placeholders = Array(excludeIds.size).fill('?').join(',');
  const allProfiles = db.prepare(`
    SELECT p.user_id, p.display_name, p.tagline, p.bio, p.comm_note,
           p.relationship_goal, p.dist_city, p.updated_at, p.photo_url,
           p.gender, p.pronouns, p.seeking,
           p.date_of_birth, p.wants_children, p.smoking, p.drinking,
           p.identity_verified, p.paused,
           p.comm_directness, p.comm_literal, p.comm_cadence,
           p.sensory_environment, p.sensory_lighting, p.social_duration,
           p.context_card,
           (SELECT pp.description FROM profile_photos pp
            WHERE pp.user_id = p.user_id AND pp.is_primary = 1 LIMIT 1) AS primary_photo_description
    FROM profiles p
    WHERE p.user_id NOT IN (${placeholders})
      AND p.display_name != ''
      AND p.bio != ''
      AND p.photo_url != ''
      AND p.paused = 0
      AND (SELECT COUNT(*) FROM user_interests WHERE user_id = p.user_id) > 0
  `).all(...excludeIds);

  if (allProfiles.length === 0) return [];

  // Fetch interests for each candidate and score
  const getInterests = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?');

  const norm = (s) => (s || '').trim().toLowerCase();

  return allProfiles
    // 18+ gate: only surface candidates with a valid DOB yielding age >= 18.
    .filter(profile => {
      const age = ageFromDob(profile.date_of_birth);
      return age !== null && age >= 18;
    })
    // Hard deal-breaker filters: apply the viewer's ACTIVE flags as exclusions,
    // but only on a KNOWN conflict. Empty/unknown candidate values always pass
    // (most profiles haven't set these yet — excluding unknowns would empty out
    // Discover).
    .filter(profile => {
      // Must be local: exclude candidates in a known, different city.
      if (viewer.db_must_be_local && metroKey(viewer.dist_city) !== '') {
        if (metroKey(profile.dist_city) !== '' && metroKey(profile.dist_city) !== metroKey(viewer.dist_city)) {
          return false;
        }
      }
      // Search radius (miles): exclude candidates farther than the viewer's
      // chosen radius. Only when the radius is set AND both locations are known
      // (unknown distance always passes — never exclude on missing data).
      if (viewer.search_radius_miles > 0) {
        const miles = distanceMiles(viewer.dist_city, profile.dist_city);
        if (miles !== null && miles > viewer.search_radius_miles) {
          return false;
        }
      }
      // Gender / seeking compatibility (mutual). Only filters on KNOWN values —
      // candidates with no gender set, or gender 'other', always pass (inclusive
      // + avoids emptying Discover). A seeking list of '' means "open to everyone".
      const SEEKABLE = ['woman', 'man', 'nonbinary'];
      const mySeeking = (viewer.seeking || '').split(',').map(s => s.trim()).filter(Boolean);
      if (mySeeking.length > 0 && SEEKABLE.includes(profile.gender) && !mySeeking.includes(profile.gender)) {
        return false; // their gender isn't one I'm seeking
      }
      const theirSeeking = (profile.seeking || '').split(',').map(s => s.trim()).filter(Boolean);
      if (theirSeeking.length > 0 && SEEKABLE.includes(viewer.gender) && !theirSeeking.includes(viewer.gender)) {
        return false; // I'm not a gender they're seeking (mutual)
      }
      // Age-range preference: hide candidates outside the viewer's chosen range.
      // (Default 18–99 = no effect.) Unknown age can't happen — the 18+ gate
      // above already requires a valid DOB.
      const candAge = ageFromDob(profile.date_of_birth);
      if (candAge !== null && (candAge < viewer.pref_age_min || candAge > viewer.pref_age_max)) {
        return false;
      }
      // Non-smoker: exclude candidates whose smoking is known and not 'no'.
      if (viewer.db_non_smoker) {
        if (profile.smoking !== '' && profile.smoking !== 'no') {
          return false;
        }
      }
      // Wants children: exclude candidates whose wants_children is known and
      // differs from the viewer's stated preference.
      if (viewer.db_wants_children && viewer.wants_children !== '') {
        if (profile.wants_children !== '' && profile.wants_children !== viewer.wants_children) {
          return false;
        }
      }
      return true;
    })
    .map(profile => {
      const interests = getInterests.all(profile.user_id).map(r => r.interest);
      const candidate = { ...profile, interests };
      return { ...candidate, ...scoreCandidate(viewer, candidate) };
    })
    .sort((a, b) => b.score - a.score || b.updated_at - a.updated_at);
}
