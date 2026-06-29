import { scoreCandidate } from './score.js';

// Returns an array of candidate profiles the viewer hasn't swiped on yet,
// ordered by score (shared interests) descending.
// Excludes: the viewer themselves, users they've already swiped on, existing matches.

export function getCandidates(db, viewerId, viewerInterests) {
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
           p.relationship_goal, p.dist_city, p.updated_at
    FROM profiles p
    WHERE p.user_id NOT IN (${placeholders})
      AND p.display_name != ''
  `).all(...excludeIds);

  if (allProfiles.length === 0) return [];

  // Fetch interests for each candidate and score
  const getInterests = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?');

  return allProfiles
    .map(profile => {
      const interests = getInterests.all(profile.user_id).map(r => r.interest);
      const candidate = { ...profile, interests };
      return { ...candidate, ...scoreCandidate(viewerInterests, candidate) };
    })
    .sort((a, b) => b.score - a.score || b.updated_at - a.updated_at);
}
