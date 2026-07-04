import { newId } from './ids.js';

// Canonical-order + UNIQUE-dedupe match creation, shared by BOTH the mutual-like
// swipe path (matching.js) and the intro accept path (messageRequests.js) so the
// two can NEVER diverge. Matches are stored with the smaller user id first
// (user_a_id < user_b_id) and guarded by UNIQUE(user_a_id, user_b_id), so a
// concurrent second caller (swipe-races-accept) can't create a duplicate row:
// the losing INSERT hits the UNIQUE constraint and we return the winner's id.
//
// Returns the match id (new or pre-existing). Does NOT emit sockets or push —
// callers own their own side effects (swipe emits new_match; accept joins the
// conversation room).
export function ensureMatch(db, userIdA, userIdB, now = Date.now()) {
  const [ua, ub] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
  let matchId = newId();
  try {
    db.prepare(
      'INSERT INTO matches (id, user_a_id, user_b_id, matched_at) VALUES (?, ?, ?, ?)'
    ).run(matchId, ua, ub, now);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      const existing = db.prepare(
        'SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?'
      ).get(ua, ub);
      if (!existing) throw err; // shouldn't happen; don't swallow a real error
      matchId = existing.id;
    } else {
      throw err;
    }
  }
  return matchId;
}
