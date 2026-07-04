import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { introRequestHourlyLimiter, introRequestDailyLimiter } from '../middleware/rateLimits.js';
import { newId } from '../utils/ids.js';
import { coarseLabel, ageFromDob } from '../utils/time.js';
import { coarseCity } from '../utils/metros.js';
import { containsSlur } from '../utils/nameScreen.js';
import { hasSafetySignal } from '../utils/safetySignals.js';
import { ensureMatch } from '../utils/matches.js';
import { joinConversationRoom } from '../socket/emitters.js';
import { listPrompts, parseFacetList } from './profile.js';
import { listPublicPhotos } from './photos.js';

const router = Router();

// The single canonical send response. EVERY /messaging/requests POST path — a
// real insert AND every "insert nothing" silent-failure branch — returns EXACTLY
// this, byte-for-byte, so a blocked / declined / already-matched prober can never
// distinguish a swallowed no-op from a genuine delivered intro. Do not vary it.
const SEND_OK = { ok: true };

// One directed intro's durable cap: a sender may hold at most this many PENDING
// outbound intros at once. DB-backed (counts live rows), so it survives a
// process restart — unlike the in-memory velocity limiters.
const PENDING_CAP = 10;

// Recipient active-conversation cap, mirrored from messaging.js so accepting an
// intro can never push someone past their calm ceiling.
const ACTIVE_CONVO_CAP = 5;

// ---------------------------------------------------------------------------
// Helpers (kept local; mirror messaging.js / matching.js semantics exactly)
// ---------------------------------------------------------------------------

function isBlocked(db, userA, userB) {
  return !!db
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    )
    .get(userA, userB, userB, userA);
}

// A match in EITHER direction between the pair (canonical order, so one lookup).
// Includes ENDED matches on purpose: once a pair has ever matched, an intro is
// the wrong channel (message them, or they intentionally unmatched — an intro
// must not become a re-contact backdoor around that severance).
function hasAnyMatch(db, userA, userB) {
  const [ua, ub] = userA < userB ? [userA, userB] : [userB, userA];
  return !!db.prepare('SELECT 1 FROM matches WHERE user_a_id = ? AND user_b_id = ?').get(ua, ub);
}

// NOT_BLOCKED_PAIR / activeConvoCount mirror messaging.js — an ENDED (unmatched)
// or blocked-pair conversation never occupies an active slot for either party.
const NOT_BLOCKED_PAIR = `NOT EXISTS (
  SELECT 1 FROM blocks bl
  WHERE (bl.blocker_id = c.user_a_id AND bl.blocked_id = c.user_b_id)
     OR (bl.blocker_id = c.user_b_id AND bl.blocked_id = c.user_a_id)
)`;

function activeConvoCount(db, userId) {
  return db
    .prepare(
      `SELECT COUNT(*) as cnt FROM conversations c
       JOIN matches mt ON mt.id = c.match_id
       WHERE ((c.user_a_id = ? AND c.archived_by_a = 0) OR (c.user_b_id = ? AND c.archived_by_b = 0))
         AND mt.ended_at IS NULL
         AND ${NOT_BLOCKED_PAIR}`
    )
    .get(userId, userId).cnt;
}

// Discover-level projection of a member for the intro cards. DELIBERATELY the
// SAME shape Discover (matching.js /candidates) exposes to a stranger: coarse
// city (ZIP stripped), scannable comm/sensory facts, photos, prompts — but NEVER
// context_card / helps_me / hard_for_me, which are POST-MATCH disclosures. An
// intro is a first contact between non-matches, so it must not reveal any more
// than the public deck card already does.
function discoverProjection(db, memberId) {
  const p = db
    .prepare(
      `SELECT display_name, tagline, bio, comm_note, relationship_goal,
              comm_directness, comm_literal, comm_cadence,
              sensory_environment, sensory_lighting, social_duration,
              occupation, languages, special_interests,
              date_of_birth, identity_verified, pronouns,
              gender, gender_custom, orientation, dist_city, photo_url,
              (SELECT pp.description FROM profile_photos pp
               WHERE pp.user_id = profiles.user_id AND pp.review_status = 'approved'
               ORDER BY pp.is_primary DESC, pp.position ASC, pp.created_at ASC
               LIMIT 1) AS primary_photo_description
       FROM profiles WHERE user_id = ?`
    )
    .get(memberId);
  if (!p) return { userId: memberId, displayName: '' };
  return {
    userId: memberId,
    displayName: p.display_name || '',
    tagline: p.tagline || '',
    bio: p.bio || '',
    commNote: p.comm_note || '',
    relationshipGoal: p.relationship_goal || '',
    commDirectness: p.comm_directness || '',
    commLiteral: p.comm_literal || '',
    commCadence: p.comm_cadence || '',
    sensoryEnvironment: p.sensory_environment || '',
    sensoryLighting: p.sensory_lighting || '',
    socialDuration: p.social_duration || '',
    occupation: p.occupation || '',
    languages: p.languages || '',
    specialInterests: parseFacetList(p.special_interests),
    age: p.date_of_birth ? ageFromDob(p.date_of_birth) : null,
    verified: !!p.identity_verified,
    pronouns: p.pronouns || '',
    gender: p.gender || '',
    genderCustom: p.gender_custom || '',
    orientation: p.orientation || '',
    // Coarse city ONLY — ZIP/postal stripped, exactly like the Discover card.
    distCity: coarseCity(p.dist_city),
    photoUrl: p.photo_url || null,
    photoDescription: p.primary_photo_description || '',
    photos: listPublicPhotos(db, memberId),
    prompts: listPrompts(db, memberId),
  };
}

// Durable, sender-invisible flag to moderators when an intro trips the
// server-side off-platform/money signal. Uses moderation_log (append-only mod
// trail) rather than `reports` so nothing ever surfaces back to the sender via
// their my-reports view. Best-effort — a flag hiccup must never change the
// caller-facing refusal.
function flagIntroSignal(db, senderId, recipientId, intro) {
  try {
    db.prepare(
      'INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      newId(),
      senderId,
      'intro_safety_signal',
      recipientId,
      `refused off-platform/money intro: ${String(intro).slice(0, 280)}`,
      Date.now()
    );
  } catch {
    /* never fail the request on an audit-log hiccup */
  }
}

// Shared 8-10 intro screening used by BOTH send and PATCH-edit. Returns a
// { error } object (caller sends it as 400) or null when the intro is clean.
// `screenContext` carries sender/recipient ids so a tripped signal can be flagged.
function screenIntro(db, intro, { senderId, recipientId }) {
  if (intro.length < 1 || intro.length > 300) {
    return { error: 'Your intro needs to be between 1 and 300 characters.' };
  }
  if (containsSlur(intro)) {
    return { error: 'Please rewrite your intro without that language.' };
  }
  if (hasSafetySignal(intro)) {
    flagIntroSignal(db, senderId, recipientId, intro);
    return {
      error:
        'For everyone’s safety, a first message can’t include links, contact details, or anything about money or payments. Please introduce yourself without those.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /messaging/requests  {recipientId, intro}
// Guard ORDER is load-bearing (see spec). Steps 4-8 ("insert nothing") each
// return SEND_OK, byte-identical to a real delivered intro.
// ---------------------------------------------------------------------------

router.post('/', requireAuth, introRequestHourlyLimiter, introRequestDailyLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const recipientId = req.body?.recipientId;
  const rawIntro = req.body?.intro;

  // 1. rate limiters ran above (own bucket). 2. recipientId shape + self-target.
  if (typeof recipientId !== 'string' || !recipientId) {
    return res.status(400).json({ error: 'recipientId is required.' });
  }
  if (recipientId === userId) {
    return res.status(400).json({ error: "That's your own profile — you can't intro yourself." });
  }

  // Durable pending-cap (sender's OWN state — safe to surface, and checked BEFORE
  // the target-dependent silent guards so the response for a given sender-state
  // is identical regardless of who the target is → no probe channel here either).
  const pendingCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM message_requests WHERE sender_id = ? AND status = 'pending'")
    .get(userId).cnt;
  if (pendingCount >= PENDING_CAP) {
    return res.status(422).json({
      error: 'You have a lot of intros still waiting. Please wait for some replies before sending more.',
      code: 'PENDING_CAP',
    });
  }

  // 3. recipient missing → generic success, insert nothing (no existence leak).
  const recipient = db.prepare('SELECT id, suspended FROM users WHERE id = ?').get(recipientId);
  if (!recipient) return res.status(201).json(SEND_OK);

  // 4. recipient suspended → generic success, nothing.
  if (recipient.suspended) return res.status(201).json(SEND_OK);

  // 5. block either direction → generic success, nothing (blocked prober learns nothing).
  if (isBlocked(db, userId, recipientId)) return res.status(201).json(SEND_OK);

  // 6. already matched either direction (incl. ended) → generic success, nothing.
  if (hasAnyMatch(db, userId, recipientId)) return res.status(201).json(SEND_OK);

  // 7. existing row: ANY status sender→recipient (one directed intro EVER — hides
  //    a prior decline/withdraw AND stops re-spam), OR a PENDING recipient→sender
  //    (a crossed pending intro) → generic success, nothing.
  const existingRow = db
    .prepare(
      `SELECT 1 FROM message_requests
       WHERE (sender_id = ? AND recipient_id = ?)
          OR (sender_id = ? AND recipient_id = ? AND status = 'pending')`
    )
    .get(userId, recipientId, recipientId, userId);
  if (existingRow) return res.status(201).json(SEND_OK);

  // 8-10. Intro screening (sender's OWN text — safe to surface a specific error).
  const intro = typeof rawIntro === 'string' ? rawIntro.trim() : '';
  const bad = screenIntro(db, intro, { senderId: userId, recipientId });
  if (bad) return res.status(400).json(bad);

  // All guards cleared → the one real insert. Same success shape as every no-op
  // branch above. UNIQUE(sender_id, recipient_id) is a final backstop against a
  // concurrent double-send (treated as the existing-row no-op).
  try {
    db.prepare(
      `INSERT INTO message_requests (id, sender_id, recipient_id, intro, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(newId(), userId, recipientId, intro, Date.now());
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(201).json(SEND_OK);
    }
    throw err;
  }

  return res.status(201).json(SEND_OK);
});

// ---------------------------------------------------------------------------
// GET /messaging/requests/sent — SENDER contract.
// ONLY pending + accepted are EVER returned. A declined (or withdrawn) request is
// invisible to the sender: no status beyond those two, no decided_at / seen /
// read field. The sender cannot tell declined from ignored from unread. This is
// the anti-retaliation core — declaring GET /sent before the /:id param routes.
// ---------------------------------------------------------------------------

router.get('/sent', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db
    .prepare(
      `SELECT id, recipient_id, intro, status, conversation_id, created_at
       FROM message_requests
       WHERE sender_id = ? AND status IN ('pending','accepted')
       ORDER BY created_at DESC`
    )
    .all(userId);

  const requests = rows.map((r) => ({
    id: r.id,
    intro: r.intro,
    status: r.status, // only ever 'pending' | 'accepted'
    conversationId: r.status === 'accepted' ? r.conversation_id || null : null,
    createdAt: coarseLabel(r.created_at),
    recipient: discoverProjection(db, r.recipient_id),
  }));

  res.json({ requests });
});

// ---------------------------------------------------------------------------
// GET /messaging/requests — RECIPIENT inbound, PENDING only. Quiet count, no
// urgency. Sender shown at Discover-level projection ONLY.
// ---------------------------------------------------------------------------

router.get('/', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db
    .prepare(
      `SELECT id, sender_id, intro, created_at
       FROM message_requests
       WHERE recipient_id = ? AND status = 'pending'
       ORDER BY created_at DESC`
    )
    .all(userId);

  const requests = rows.map((r) => ({
    id: r.id,
    intro: r.intro,
    createdAt: coarseLabel(r.created_at),
    sender: discoverProjection(db, r.sender_id),
  }));

  res.json({ requests, count: requests.length });
});

// ---------------------------------------------------------------------------
// POST /messaging/requests/:id/accept — RECIPIENT accepts (pending only). Mints a
// real match + conversation via the EXISTING canonical path, then joins the room.
// Silent to the sender until the conversation simply appears in their inbox.
// ---------------------------------------------------------------------------

router.post('/:id/accept', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const reqRow = db
    .prepare('SELECT id, sender_id, recipient_id, intro, status FROM message_requests WHERE id = ?')
    .get(req.params.id);

  // 404 for "not found" AND "not the recipient" — never disclose the row exists.
  if (!reqRow || reqRow.recipient_id !== userId) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (reqRow.status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been handled.' });
  }

  const senderId = reqRow.sender_id;
  const now = Date.now();

  // Re-check block at accept time — if the pair is now blocked (either direction),
  // silently DECLINE, mint nothing. Same neutral resolution a normal decline gives.
  if (isBlocked(db, userId, senderId)) {
    db.prepare("UPDATE message_requests SET status = 'declined', decided_at = ? WHERE id = ?").run(now, reqRow.id);
    return res.json({ ok: true });
  }

  // Enforce the recipient's active-conversation cap — accepting can't blow past 5.
  if (activeConvoCount(db, userId) >= ACTIVE_CONVO_CAP) {
    return res.status(422).json({
      error: "You've reached your active conversations for now. Archive one from Messages, then accept this.",
      code: 'CAP_REACHED',
    });
  }

  // ONE transaction: dedupe the match (canonical order + UNIQUE), create the
  // conversation if one doesn't already exist for that match (a swipe-race may
  // have made the match+convo first), seed the intro as the sender's opening
  // message ONLY when we create the conversation, and mark the request accepted.
  let conversationId;
  db.transaction(() => {
    const matchId = ensureMatch(db, userId, senderId, now);
    const existingConv = db.prepare('SELECT id FROM conversations WHERE match_id = ?').get(matchId);
    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      conversationId = newId();
      // Creator-first (user_a = the accepting recipient), mirroring POST /conversations.
      db.prepare(
        'INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(conversationId, matchId, userId, senderId, now);
      // Seed the screened intro as the sender's first message so context isn't lost.
      db.prepare(
        'INSERT INTO messages (id, conversation_id, sender_id, body, sent_at) VALUES (?, ?, ?, ?, ?)'
      ).run(newId(), conversationId, senderId, reqRow.intro, now);
    }
    db.prepare(
      "UPDATE message_requests SET status = 'accepted', conversation_id = ?, decided_at = ? WHERE id = ?"
    ).run(conversationId, now, reqRow.id);
  })();

  // Join BOTH parties' live sockets to the new room (best-effort side effect,
  // outside the txn) so the very first message delivers without a reload.
  joinConversationRoom(req.app.locals.io, conversationId, userId, senderId);

  return res.status(201).json({ conversationId });
});

// ---------------------------------------------------------------------------
// POST /messaging/requests/:id/decline — RECIPIENT declines (pending only).
// Silent to the sender (invisible in GET /sent). "Ignore" is simply doing
// nothing — the row stays pending, indistinguishable to the sender from decline.
// ---------------------------------------------------------------------------

router.post('/:id/decline', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const reqRow = db
    .prepare('SELECT id, recipient_id, status FROM message_requests WHERE id = ?')
    .get(req.params.id);

  if (!reqRow || reqRow.recipient_id !== userId) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (reqRow.status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been handled.' });
  }

  db.prepare("UPDATE message_requests SET status = 'declined', decided_at = ? WHERE id = ?").run(Date.now(), reqRow.id);
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PATCH /messaging/requests/:id — SENDER edits their own intro WHILE PENDING
// (the typo escape hatch — there is no re-send after decline). Re-runs the same
// 8-10 screening. Never changes status or re-notifies.
// ---------------------------------------------------------------------------

router.patch('/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const reqRow = db
    .prepare('SELECT id, sender_id, recipient_id, status FROM message_requests WHERE id = ?')
    .get(req.params.id);

  if (!reqRow || reqRow.sender_id !== userId) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (reqRow.status !== 'pending') {
    return res.status(409).json({ error: 'This intro can no longer be edited.' });
  }

  const intro = typeof req.body?.intro === 'string' ? req.body.intro.trim() : '';
  const bad = screenIntro(db, intro, { senderId: userId, recipientId: reqRow.recipient_id });
  if (bad) return res.status(400).json(bad);

  db.prepare('UPDATE message_requests SET intro = ? WHERE id = ?').run(intro, reqRow.id);
  return res.json({ ok: true });
});

export default router;
