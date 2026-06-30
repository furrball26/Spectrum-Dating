import { scoreCandidate } from './score.js';
import { ageFromDob } from '../utils/time.js';

// Returns an array of candidate profiles the viewer hasn't swiped on yet,
// ordered by score (shared interests) descending.
// Excludes: the viewer themselves, users they've already swiped on, existing matches.

export function getCandidates(db, viewerId, viewerInterests) {
  // Viewer's own profile fields used for weighted scoring (goal + city) and
  // for evaluating the viewer's active deal-breaker filters.
  const viewerProfile = db.prepare(
    `SELECT relationship_goal, dist_city, wants_children,
            db_wants_children, db_non_smoker, db_must_be_local
     FROM profiles WHERE user_id = ?`
  ).get(viewerId);
  const viewer = {
    interests: viewerInterests,
    relationship_goal: viewerProfile?.relationship_goal ?? '',
    dist_city: viewerProfile?.dist_city ?? '',
    wants_children: viewerProfile?.wants_children ?? '',
    db_wants_children: !!viewerProfile?.db_wants_children,
    db_non_smoker: !!viewerProfile?.db_non_smoker,
    db_must_be_local: !!viewerProfile?.db_must_be_local,
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
           p.date_of_birth, p.wants_children, p.smoking, p.drinking
    FROM profiles p
    WHERE p.user_id NOT IN (${placeholders})
      AND p.display_name != ''
      AND p.bio != ''
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
      if (viewer.db_must_be_local && norm(viewer.dist_city) !== '') {
        if (norm(profile.dist_city) !== '' && norm(profile.dist_city) !== norm(viewer.dist_city)) {
          return false;
        }
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
