import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mutationLimiter } from '../middleware/rateLimits.js';
import { getCandidates } from '../matching/candidates.js';
import { requirePaid } from '../billing/entitlements.js';
import { listPrompts, parseFacetList } from './profile.js';
import { listPublicPhotos } from './photos.js';
import { ageFromDob } from '../utils/time.js';
import { coarseCity } from '../utils/metros.js';
import { newId } from '../utils/ids.js';
import { ensureMatch } from '../utils/matches.js';
import { emitNewMatch } from '../socket/emitters.js';
import { notifyUser } from '../push/notify.js';

const router = Router();

// Shared candidate → card mapping. The ONE place a scored candidate row from
// getCandidates() becomes the public "card" shape, so /candidates and the
// Companion-gated /best-fits can never drift apart. IMPORTANT: contextCard
// ("how to talk to me", a free-text personal disclosure) is GATED to post-match
// only (see GET /matching/matches otherUser) and is deliberately NEVER included
// here — any pre-match surface (Discover, best-fits) that leaked it would be a
// weaponized-disclosure abuse surface. The coarse-city helper strips the ZIP so
// strangers see "Phoenix, AZ", never a precise location.
function mapCandidateToCard(db, c) {
  return {
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
    occupation: c.occupation || '',
    languages: c.languages || '',
    specialInterests: parseFacetList(c.special_interests),
    age: c.date_of_birth ? ageFromDob(c.date_of_birth) : null,
    verified: !!c.identity_verified,
    pronouns: c.pronouns || '',
    gender: c.gender || '',
    genderCustom: c.gender_custom || '',
    orientation: c.orientation || '',
    distCity: coarseCity(c.dist_city),
    interests: c.interests,
    sharedInterests: c.sharedInterests,
    whyReasons: c.whyReasons,
    prompts: listPrompts(db, c.user_id),
    photoUrl: c.photo_url || null,
    photoDescription: c.primary_photo_description || '',
    photos: listPublicPhotos(db, c.user_id),
    matchedAt: null,
  };
}

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

  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));

  const scored = getCandidates(db, userId, viewerInterests);
  const candidates = scored.slice(offset, offset + limit);
  res.set('X-Has-More', String(scored.length > offset + limit));

  // Map via the shared helper so Discover and best-fits carry identical fields
  // and the same post-match contextCard gating (see mapCandidateToCard above).
  const result = candidates.map(c => mapCandidateToCard(db, c));

  return res.json(result);
});

// GET /matching/best-fits — "Your best fits", the first Companion-gated feature
// (audit/MONETIZATION_STRATEGY.md §5 #4). A small, calm shortlist of the viewer's
// highest-compatibility people. requirePaid returns 402 { error:'upgrade_required',
// upgrade:true } for free/non-Companion callers — the gate lives HERE on the
// backend; the frontend lock is UX only.
//
// Calm-by-design (product law / the memo's hard red lines): this is a plain list
// the user can look at whenever. NO expiry, NO countdown, NO counter, NO "act
// now", NO "X people viewed you", NO scarcity. A manual re-fetch (Refresh) is
// fine. It reuses the SAME honest getCandidates() scoring the deck uses — no new
// "match %" vanity metric — and returns the top ~5 (default 5, clamped) in the
// SAME per-card shape /candidates uses (contextCard stays post-match-gated).
router.get('/best-fits', requireAuth, requirePaid, (req, res) => {
  const { db, userId } = req.ctx;

  // Mirror /candidates' onboarding gate: an incomplete profile has no meaningful
  // fits to compute, so return an empty list rather than a half-scored one.
  const viewerProfile = db.prepare('SELECT display_name, bio FROM profiles WHERE user_id = ?').get(userId);
  const viewerInterests = db.prepare(
    'SELECT interest FROM user_interests WHERE user_id = ?'
  ).all(userId).map(r => r.interest);

  const onboardingComplete = !!(viewerProfile?.display_name?.trim() && viewerProfile?.bio?.trim() && viewerInterests.length > 0);
  if (!onboardingComplete) {
    return res.json({ bestFits: [] });
  }

  // getCandidates already returns candidates scored + sorted desc, and already
  // excludes the viewer's own profile, swiped, matched (incl. ended), and blocked
  // pairs. Take the top few — clamp to 5, default 5.
  const limit = Math.min(5, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const scored = getCandidates(db, userId, viewerInterests);
  const bestFits = scored.slice(0, limit).map(c => mapCandidateToCard(db, c));

  return res.json({ bestFits });
});

// POST /matching/swipe
// Body: { candidateId: string, decision: 'like' | 'skip' }
router.post('/swipe', requireAuth, mutationLimiter, async (req, res) => {
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
    return res.status(400).json({ error: "That's your own profile." });
  }

  // Check candidate exists
  const candidate = db.prepare('SELECT id FROM users WHERE id = ?').get(candidateId);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found.' });
  }

  // Block gate: if EITHER party has blocked the other, silently no-op. A blocked
  // pair must never form a match (nor fire a push), and we don't reveal the
  // block's existence/direction — the swipe just resolves as a non-match.
  const blocked = db.prepare(
    'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
  ).get(userId, candidateId, candidateId, userId);
  if (blocked) {
    return res.json({ matched: false });
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

  // Mutual like — create the match via the shared canonical-order + UNIQUE-dedupe
  // helper (ensureMatch), the SAME path the intro-accept flow uses so the two can
  // never diverge. E11: a swipe→match race where the other user's concurrent
  // mutual-like won the INSERT resolves to the winning row's id, and we still fall
  // through to the shared emit/push below so BOTH users are notified regardless of
  // which insert won.
  const matchId = ensureMatch(db, userId, candidateId, now);

  // Intro stale-resolve: if a pending message-request intro exists between this
  // pair, the mutual swipe-match supersedes it — withdraw it (either direction)
  // so no orphaned pending intro lingers between a now-matched pair.
  db.prepare(
    `UPDATE message_requests SET status = 'withdrawn', decided_at = ?
     WHERE status = 'pending'
       AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`
  ).run(now, userId, candidateId, candidateId, userId);

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
router.post('/undo-skip', requireAuth, mutationLimiter, (req, res) => {
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

// POST /matching/undo-like — undo a still-PENDING 'like'. Mirrors undo-skip:
// deleting the like removes the caller's one-sided interest so that person can
// resurface in candidates (Discover). Never touches 'skip' swipes.
//
// Body (optional): { candidateId?: string }
//   - candidateId present → undo the like on that specific candidate (targeted).
//   - candidateId absent  → undo the caller's MOST RECENT 'like' (parity with undo-skip).
//
// GUARD — the like can only be undone while it's still ONE-SIDED. If it has
// already produced a mutual match (the other person liked back), the match row
// exists and this endpoint refuses with 409 and leaves the match untouched. To
// end a real match the user must use the unmatch flow (DELETE /matches/:id).
// This route NEVER deletes a match.
//
// Authz: scoped to the caller's own swipes via swiper_id = req.ctx.userId, so
// no IDOR — a caller can only ever undo a like they themselves made.
//
// Returns { ok: false } when there's no matching pending like to undo.
router.post('/undo-like', requireAuth, mutationLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const { candidateId } = req.body ?? {};

  if (candidateId != null && (typeof candidateId !== 'string' || !candidateId)) {
    return res.status(400).json({ error: 'candidateId must be a non-empty string.' });
  }

  // Find the like to undo — always scoped to the caller's own swipes.
  const like = candidateId
    ? db.prepare(
        `SELECT id, swiped_id FROM swipes
         WHERE swiper_id = ? AND swiped_id = ? AND decision = 'like'`
      ).get(userId, candidateId)
    : db.prepare(
        `SELECT id, swiped_id FROM swipes
         WHERE swiper_id = ? AND decision = 'like'
         ORDER BY created_at DESC LIMIT 1`
      ).get(userId);

  if (!like) {
    return res.json({ ok: false });
  }

  // GUARD: refuse if this like already became a mutual match. Look up the match
  // by canonical pair order (smaller id first), matching how /swipe creates it.
  const otherId = like.swiped_id;
  const [userA, userB] = userId < otherId ? [userId, otherId] : [otherId, userId];
  const match = db.prepare(
    'SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?'
  ).get(userA, userB);

  if (match) {
    return res.status(409).json({
      error: "You've already matched — you can unmatch from the conversation instead.",
      matched: true,
    });
  }

  db.prepare('DELETE FROM swipes WHERE id = ?').run(like.id);

  return res.json({ ok: true, candidateId: like.swiped_id });
});

// GET /matching/matches — list the viewer's mutual matches, with the other
// person's profile and whether a conversation has been started yet.
router.get('/matches', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  // Join the requester's OWN private note (match_notes keyed by user_id +
  // match_id). Because we key on n.user_id = ?, this can only ever surface the
  // viewer's own note — never the other member's.
  const rows = db.prepare(`
    SELECT m.id, m.user_a_id, m.user_b_id, m.matched_at, c.id AS conversation_id,
           n.note AS note
    FROM matches m
    LEFT JOIN conversations c ON c.match_id = m.id
    LEFT JOIN match_notes n ON n.match_id = m.id AND n.user_id = ?
    WHERE (m.user_a_id = ? OR m.user_b_id = ?)
      AND m.ended_at IS NULL
    ORDER BY m.matched_at DESC
  `).all(userId, userId, userId);

  const matches = rows.map((row) => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const p = db.prepare(
      `SELECT display_name, tagline, photo_url, identity_verified, dist_city, pronouns,
              gender, gender_custom, orientation,
              comm_directness, comm_literal, comm_cadence,
              sensory_environment, sensory_lighting, social_duration, context_card,
              occupation, languages, helps_me, hard_for_me, special_interests
       FROM profiles WHERE user_id = ?`
    ).get(otherId);
    return {
      matchId: row.id,
      matchedAt: row.matched_at,
      conversationId: row.conversation_id || null,
      hasConversation: !!row.conversation_id,
      // The viewer's OWN private note for this match ("" if none). Owner-only —
      // the other person's note is never joined or returned.
      note: row.note || '',
      otherUser: {
        userId: otherId,
        displayName: p?.display_name || '',
        tagline: p?.tagline || '',
        photoUrl: p?.photo_url || null,
        verified: !!p?.identity_verified,
        pronouns: p?.pronouns || '',
        gender: p?.gender || '',
        genderCustom: p?.gender_custom || '',
        orientation: p?.orientation || '',
        // Coarse city (ZIP stripped) for the "city on matches" display.
        distCity: coarseCity(p?.dist_city),
        commDirectness: p?.comm_directness || '',
        commLiteral: p?.comm_literal || '',
        commCadence: p?.comm_cadence || '',
        sensoryEnvironment: p?.sensory_environment || '',
        sensoryLighting: p?.sensory_lighting || '',
        socialDuration: p?.social_duration || '',
        contextCard: p?.context_card || '',
        occupation: p?.occupation || '',
        languages: p?.languages || '',
        helpsMe: parseFacetList(p?.helps_me),
        hardForMe: parseFacetList(p?.hard_for_me),
        specialInterests: parseFacetList(p?.special_interests),
        prompts: listPrompts(db, otherId),
      },
    };
  });

  res.json({ matches });
});

// DELETE /matching/matches/:id — F21 unmatch: SOFT-end the match instead of
// hard-deleting it. The pair stops appearing as candidates (the match row still
// exists → still excluded), the conversation becomes read-only for BOTH people,
// and the person who was unmatched keeps a quiet "This conversation has ended."
// notice they only discover if/when they reopen the thread. NO push, NO reason,
// NO "X unmatched you" — ended_by is kept server-side for authz/audit only and
// is NEVER surfaced to the other party.
//
// Authz: only a participant may end their own match (no IDOR). Idempotent — if
// it's already ended we just re-confirm success without changing ended_by/at.
router.delete('/matches/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const match = db.prepare('SELECT id, user_a_id, user_b_id, ended_at FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Already ended (by either party) → no-op, still a success for the caller.
  if (match.ended_at) {
    return res.json({ ok: true, unmatched: true, ended: true });
  }

  db.prepare('UPDATE matches SET ended_at = ?, ended_by = ? WHERE id = ?')
    .run(Date.now(), userId, match.id);

  res.json({ ok: true, unmatched: true, ended: true });
});

// PUT /matching/matches/:id/note — set/clear the requester's OWN private note
// on a match ("note to self"). Owner-only: verify the requester is a member of
// the match (else 404 — don't reveal the match exists), then UPSERT. An empty
// string clears the note. Cap at 500 chars.
router.put('/matches/:id/note', requireAuth, mutationLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const matchId = req.params.id;

  let note = req.body?.note;
  if (note == null) note = '';
  if (typeof note !== 'string') {
    return res.status(400).json({ error: 'note must be a string.' });
  }
  note = note.trim().slice(0, 500);

  const match = db.prepare('SELECT user_a_id, user_b_id FROM matches WHERE id = ?').get(matchId);
  // 404 (not 403) when the requester isn't a member — don't confirm the match exists.
  if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
    return res.status(404).json({ error: 'Match not found' });
  }

  db.prepare(
    `INSERT INTO match_notes (user_id, match_id, note, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, match_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
  ).run(userId, matchId, note, Date.now());

  return res.json({ ok: true, note });
});

// GET /matching/activity — activity inbox:
//   incomingLikes: people who swiped 'like' on you that you haven't acted on yet.
//   recentMatches: your mutual matches from the last 7 days.
//
// incomingLikes are the raw one-sided likes — the viewer can head to Discover to see
// them in their natural queue (they'll appear as normal candidates).  Capped at 20.
router.get('/activity', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // People who liked you and you haven't swiped on (and no match exists yet).
  const likesRows = db.prepare(`
    SELECT s.swiper_id AS user_id, s.created_at AS liked_at,
           p.display_name, p.photo_url, p.date_of_birth, p.pronouns,
           p.dist_city, p.identity_verified
    FROM swipes s
    JOIN profiles p ON p.user_id = s.swiper_id
    WHERE s.swiped_id = ?
      AND s.decision = 'like'
      AND NOT EXISTS (
        SELECT 1 FROM swipes s2
        WHERE s2.swiper_id = ? AND s2.swiped_id = s.swiper_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM matches m
        WHERE (m.user_a_id = ? AND m.user_b_id = s.swiper_id)
           OR (m.user_b_id = ? AND m.user_a_id = s.swiper_id)
      )
      -- Block filter (both directions): a person the viewer has blocked, or who
      -- has blocked the viewer, must never surface in Activity with photo/age/
      -- coarse city (harassment-around-block). Mirrors the Discover deck filter.
      AND NOT EXISTS (
        SELECT 1 FROM blocks bl
        WHERE (bl.blocker_id = ? AND bl.blocked_id = s.swiper_id)
           OR (bl.blocker_id = s.swiper_id AND bl.blocked_id = ?)
      )
    ORDER BY s.created_at DESC
    LIMIT 20
  `).all(userId, userId, userId, userId, userId, userId);

  const incomingLikes = likesRows.map(r => ({
    userId: r.user_id,
    displayName: r.display_name || '',
    age: r.date_of_birth ? ageFromDob(r.date_of_birth) : null,
    photoUrl: r.photo_url || null,
    pronouns: r.pronouns || '',
    distCity: coarseCity(r.dist_city),
    verified: !!r.identity_verified,
    likedAt: r.liked_at,
  }));

  // Recent mutual matches (last 7 days) — for the "new matches" section.
  const recentRows = db.prepare(`
    SELECT m.id AS match_id, m.matched_at,
           CASE WHEN m.user_a_id = ? THEN m.user_b_id ELSE m.user_a_id END AS other_id,
           c.id AS conversation_id
    FROM matches m
    LEFT JOIN conversations c ON c.match_id = m.id
    WHERE (m.user_a_id = ? OR m.user_b_id = ?)
      AND m.matched_at >= ?
      AND m.ended_at IS NULL
      -- Block filter (both directions): drop any recent match where the pair is
      -- now blocked, so a blocked user can't linger in the "new matches" section.
      -- Symmetric over the match pair, so it needs no bind params.
      AND NOT EXISTS (
        SELECT 1 FROM blocks bl
        WHERE (bl.blocker_id = m.user_a_id AND bl.blocked_id = m.user_b_id)
           OR (bl.blocker_id = m.user_b_id AND bl.blocked_id = m.user_a_id)
      )
    ORDER BY m.matched_at DESC
    LIMIT 10
  `).all(userId, userId, userId, sevenDaysAgo);

  const recentMatches = recentRows.map(r => {
    const p = db.prepare(
      'SELECT display_name, photo_url, date_of_birth, pronouns, dist_city, identity_verified FROM profiles WHERE user_id = ?'
    ).get(r.other_id);
    return {
      matchId: r.match_id,
      matchedAt: r.matched_at,
      conversationId: r.conversation_id || null,
      userId: r.other_id,
      displayName: p?.display_name || '',
      age: p?.date_of_birth ? ageFromDob(p.date_of_birth) : null,
      photoUrl: p?.photo_url || null,
      pronouns: p?.pronouns || '',
      distCity: coarseCity(p?.dist_city),
      verified: !!p?.identity_verified,
    };
  });

  return res.json({ incomingLikes, recentMatches });
});

export default router;
