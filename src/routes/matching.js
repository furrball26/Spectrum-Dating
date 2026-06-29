import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getCandidates } from '../matching/candidates.js';
import { newId } from '../utils/ids.js';
import { emitNewMatch } from '../socket/emitters.js';

const router = Router();

// GET /matching/candidates
// Returns top 10 scored candidates the viewer hasn't swiped on yet.
router.get('/candidates', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  // Don't show candidates to users who haven't completed onboarding
  const viewerProfile = db.prepare('SELECT display_name, bio FROM profiles WHERE user_id = ?').get(userId);
  const viewerInterests = db.prepare(
    'SELECT interest FROM user_interests WHERE user_id = ?'
  ).all(userId).map(r => r.interest);

  const onboardingComplete = !!(viewerProfile?.display_name?.trim() && viewerProfile?.bio?.trim() && viewerInterests.length > 0);
  if (!onboardingComplete) {
    return res.json([]); // empty — frontend will redirect to onboarding
  }

  const candidates = getCandidates(db, userId, viewerInterests).slice(0, 10);

  const result = candidates.map(c => ({
    memberId: c.user_id,
    displayName: c.display_name,
    tagline: c.tagline,
    bio: c.bio,
    commNote: c.comm_note,
    relationshipGoal: c.relationship_goal,
    interests: c.interests,
    sharedInterests: c.sharedInterests,
    whyReasons: c.whyReasons,
    matchedAt: null,
  }));

  return res.json(result);
});

// POST /matching/swipe
// Body: { candidateId: string, decision: 'like' | 'skip' }
router.post('/swipe', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { candidateId, decision } = req.body ?? {};

  // Validate input
  if (typeof candidateId !== 'string' || !candidateId) {
    return res.status(400).json({ error: 'candidateId is required.' });
  }
  if (decision !== 'like' && decision !== 'skip') {
    return res.status(400).json({ error: 'decision must be "like" or "skip".' });
  }
  if (candidateId === userId) {
    return res.status(400).json({ error: 'Cannot swipe on yourself.' });
  }

  // Check candidate exists
  const candidate = db.prepare('SELECT id FROM users WHERE id = ?').get(candidateId);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found.' });
  }

  const now = Date.now();
  const swipeId = newId();

  // Insert swipe — 409 if already swiped
  try {
    db.prepare(
      'INSERT INTO swipes (id, swiper_id, swiped_id, decision, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(swipeId, userId, candidateId, decision, now);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Already swiped on this user.' });
    }
    throw err;
  }

  // If skip, we're done
  if (decision === 'skip') {
    return res.json({ matched: false });
  }

  // If like, check for mutual like
  const theirLike = db.prepare(
    'SELECT id FROM swipes WHERE swiper_id = ? AND swiped_id = ? AND decision = ?'
  ).get(candidateId, userId, 'like');

  if (!theirLike) {
    return res.json({ matched: false });
  }

  // Mutual like — create match (canonical order: smaller id first)
  const [userA, userB] = userId < candidateId ? [userId, candidateId] : [candidateId, userId];
  const matchId = newId();

  try {
    db.prepare(
      'INSERT INTO matches (id, user_a_id, user_b_id, matched_at) VALUES (?, ?, ?, ?)'
    ).run(matchId, userA, userB, now);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      // Match already exists (race condition) — look it up
      const existing = db.prepare(
        'SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?'
      ).get(userA, userB);
      return res.json({ matched: true, matchId: existing.id });
    }
    throw err;
  }

  const { io } = req.app.locals;
  if (io) {
    emitNewMatch(io, userId, candidateId, matchId);
  }

  // Async push — don't await, don't block response
  const { notifyUser } = await import('../push/notify.js');
  const matchPayload = {
    title: 'New match! 💚',
    body: "You've matched on Spectrum Dating.",
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `match-${matchId}`,
    data: { url: '/' },
  };
  notifyUser(db, userId, matchPayload).catch(() => {});
  notifyUser(db, candidateId, matchPayload).catch(() => {});

  return res.json({ matched: true, matchId });
});

export default router;
