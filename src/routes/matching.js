import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getCandidates } from '../matching/candidates.js';
import { listPrompts } from './profile.js';
import { ageFromDob } from '../utils/time.js';
import { newId } from '../utils/ids.js';
import { emitNewMatch } from '../socket/emitters.js';
import { notifyUser } from '../push/notify.js';

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

  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

  const scored = getCandidates(db, userId, viewerInterests);
  const candidates = scored.slice(offset, offset + limit);
  res.set('X-Has-More', String(scored.length > offset + limit));

  const result = candidates.map(c => ({
    memberId: c.user_id,
    displayName: c.display_name,
    tagline: c.tagline,
    bio: c.bio,
    commNote: c.comm_note,
    relationshipGoal: c.relationship_goal,
    commDirectness: c.comm_directness || '',
    commLiteral: c.comm_literal || '',
    commCadence: c.comm_cadence || '',
    sensoryEnvironment: c.sensory_environment || '',
    sensoryLighting: c.sensory_lighting || '',
    socialDuration: c.social_duration || '',
    contextCard: c.context_card || '',
    age: c.date_of_birth ? ageFromDob(c.date_of_birth) : null,
    verified: !!c.identity_verified,
    interests: c.interests,
    sharedInterests: c.sharedInterests,
    whyReasons: c.whyReasons,
    prompts: listPrompts(db, c.user_id),
    photoUrl: c.photo_url || null,
    matchedAt: null,
  }));

  return res.json(result);
});

// POST /matching/swipe
// Body: { candidateId: string, decision: 'like' | 'skip' }
router.post('/swipe', requireAuth, async (req, res) => {
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
  const matchPayload = {
    title: 'New match',
    body: "You and someone both said yes. There's no rush to say hello.",
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `match-${matchId}`,
    data: { url: '/' },
  };
  notifyUser(db, userId, matchPayload).catch(() => {});
  notifyUser(db, candidateId, matchPayload).catch(() => {});

  return res.json({ matched: true, matchId });
});

// POST /matching/undo-skip — undo the viewer's MOST RECENT 'skip' swipe.
// Deleting the skip lets that person resurface in candidates. Never touches
// 'like' swipes. Returns { ok: false } when there's no skip to undo.
router.post('/undo-skip', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const lastSkip = db.prepare(
    `SELECT id, swiped_id FROM swipes
     WHERE swiper_id = ? AND decision = 'skip'
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId);

  if (!lastSkip) {
    return res.json({ ok: false });
  }

  db.prepare('DELETE FROM swipes WHERE id = ?').run(lastSkip.id);

  return res.json({ ok: true, candidateId: lastSkip.swiped_id });
});

// GET /matching/matches — list the viewer's mutual matches, with the other
// person's profile and whether a conversation has been started yet.
router.get('/matches', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db.prepare(`
    SELECT m.id, m.user_a_id, m.user_b_id, m.matched_at, c.id AS conversation_id
    FROM matches m
    LEFT JOIN conversations c ON c.match_id = m.id
    WHERE m.user_a_id = ? OR m.user_b_id = ?
    ORDER BY m.matched_at DESC
  `).all(userId, userId);

  const matches = rows.map((row) => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const p = db.prepare(
      `SELECT display_name, tagline, photo_url, identity_verified,
              comm_directness, comm_literal, comm_cadence,
              sensory_environment, sensory_lighting, social_duration, context_card
       FROM profiles WHERE user_id = ?`
    ).get(otherId);
    return {
      matchId: row.id,
      matchedAt: row.matched_at,
      conversationId: row.conversation_id || null,
      hasConversation: !!row.conversation_id,
      otherUser: {
        userId: otherId,
        displayName: p?.display_name || '',
        tagline: p?.tagline || '',
        photoUrl: p?.photo_url || null,
        verified: !!p?.identity_verified,
        commDirectness: p?.comm_directness || '',
        commLiteral: p?.comm_literal || '',
        commCadence: p?.comm_cadence || '',
        sensoryEnvironment: p?.sensory_environment || '',
        sensoryLighting: p?.sensory_lighting || '',
        socialDuration: p?.social_duration || '',
        contextCard: p?.context_card || '',
        prompts: listPrompts(db, otherId),
      },
    };
  });

  res.json({ matches });
});

// DELETE /matching/matches/:id — unmatch: remove the match + its conversation
router.delete('/matches/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const match = db.prepare('SELECT id, user_a_id, user_b_id FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const unmatch = db.transaction(() => {
    db.prepare('DELETE FROM conversations WHERE match_id = ?').run(match.id);
    db.prepare('DELETE FROM matches WHERE id = ?').run(match.id);
  });
  unmatch();
  res.json({ ok: true, unmatched: true });
});

export default router;
