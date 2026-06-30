import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../utils/ids.js';
import { coarseLabel } from '../utils/time.js';
import { emitNewMessage, emitMessageDeleted, emitConversationArchived } from '../socket/emitters.js';
import { notifyUser } from '../push/notify.js';

const router = Router();

const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending messages too quickly. Please slow down.' },
  keyGenerator: (req) => {
    // Rate limit per authenticated user, not per IP. Fall back to the
    // IPv6-safe ipKeyGenerator helper when there's no user (required by
    // express-rate-limit v8 to avoid ERR_ERL_KEY_GEN_IPV6 at startup).
    return req.ctx?.userId ? `user:${req.ctx.userId}` : ipKeyGenerator(req.ip);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConversationMember(db, convId, userId) {
  const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(convId);
  if (!conv) return null;
  if (conv.user_a_id !== userId && conv.user_b_id !== userId) return null;
  return conv;
}

function isBlocked(db, userA, userB) {
  return !!(
    db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(userA, userB, userB, userA)
  );
}

function activeConvoCount(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM conversations
    WHERE (user_a_id = ? AND archived_by_a = 0) OR (user_b_id = ? AND archived_by_b = 0)
  `).get(userId, userId).cnt;
}

// ---------------------------------------------------------------------------
// GET /messaging/conversations
// ---------------------------------------------------------------------------

router.get('/conversations', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db.prepare(`
    SELECT c.id, c.match_id, c.user_a_id, c.user_b_id,
           c.last_read_at_a, c.last_read_at_b,
           m.sent_at as last_sent_at, m.sender_id as last_sender_id
    FROM conversations c
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
    )
    WHERE (c.user_a_id = ? AND c.archived_by_a = 0)
       OR (c.user_b_id = ? AND c.archived_by_b = 0)
    ORDER BY COALESCE(m.sent_at, c.created_at) DESC
  `).all(userId, userId);

  const conversations = rows.map(row => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const otherProfile = db.prepare('SELECT display_name, identity_verified FROM profiles WHERE user_id = ?').get(otherId);
    const isUserA = row.user_a_id === userId;
    const lastReadAt = isUserA ? (row.last_read_at_a || 0) : (row.last_read_at_b || 0);
    const hasUnread = !!(row.last_sent_at && row.last_sender_id !== userId && row.last_sent_at > lastReadAt);
    return {
      id: row.id,
      matchId: row.match_id,
      otherUser: { userId: otherId, displayName: otherProfile?.display_name || '', verified: !!otherProfile?.identity_verified },
      lastMessageGroup: row.last_sent_at ? coarseLabel(row.last_sent_at) : null,
      hasUnread,
    };
  });

  const activeCount = activeConvoCount(db, userId);
  res.json({ conversations, activeCap: 5, activeCount, capReached: activeCount >= 5 });
});

// ---------------------------------------------------------------------------
// GET /messaging/conversations/:id
// ---------------------------------------------------------------------------

router.get('/conversations/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
  const otherProfile = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(otherId);

  const msgs = db.prepare(`
    SELECT id, sender_id, body, deleted, sent_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY sent_at ASC
  `).all(req.params.id);

  const messages = msgs.map(m => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.deleted ? null : m.body,
    deleted: !!m.deleted,
    timeLabel: coarseLabel(m.sent_at),
  }));

  res.json({
    conversation: {
      id: conv.id || req.params.id,
      otherUser: { userId: otherId, displayName: otherProfile?.display_name || '' },
    },
    messages,
  });
});

// ---------------------------------------------------------------------------
// PUT /messaging/conversations/:id/read
// ---------------------------------------------------------------------------

router.put('/conversations/:id/read', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const isUserA = conv.user_a_id === userId;
  const col = isUserA ? 'last_read_at_a' : 'last_read_at_b';
  db.prepare(`UPDATE conversations SET ${col} = ? WHERE id = ?`).run(Date.now(), req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /messaging/conversations
// ---------------------------------------------------------------------------

router.post('/conversations', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { matchId } = req.body;

  if (!matchId) return res.status(400).json({ error: 'matchId is required' });

  // Verify match exists and user is a party
  const match = db.prepare('SELECT id, user_a_id, user_b_id FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Check for existing conversation
  const existing = db.prepare('SELECT id FROM conversations WHERE match_id = ?').get(matchId);
  if (existing) return res.status(409).json({ error: 'Conversation already exists', conversationId: existing.id });

  // Enforce cap
  const count = activeConvoCount(db, userId);
  if (count >= 5) {
    return res.status(422).json({ error: 'Conversation cap reached. Archive a conversation to start a new one.', code: 'CAP_REACHED' });
  }

  const otherId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const id = newId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, matchId, userId, otherId, now);

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.status(201).json({ conversation: conv });
});

// ---------------------------------------------------------------------------
// POST /messaging/conversations/:id/messages
// ---------------------------------------------------------------------------

router.post('/conversations/:id/messages', requireAuth, messageLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body cannot be empty' });
  if (body.length > 2000) return res.status(400).json({ error: 'Message body exceeds 2000 characters' });

  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;

  // Consent gate
  if (isBlocked(db, userId, otherId)) {
    return res.status(403).json({ error: 'This conversation is no longer available.', code: 'CONSENT_GATE' });
  }

  const messageId = newId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, body, sent_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, req.params.id, userId, body, now);

  const timeLabel = coarseLabel(now);

  const { io } = req.app.locals;
  if (io) {
    emitNewMessage(io, req.params.id, { id: messageId, senderId: userId, body, deleted: false, timeLabel });
  }

  // Async push to recipient — tier-aware, don't await
  const recipientProfile = db.prepare('SELECT notification_tier FROM profiles WHERE user_id = ?').get(otherId);
  const tier = recipientProfile?.notification_tier || 'in_app';

  let pushPayload = null;
  if (tier === 'in_app') {
    pushPayload = {
      title: 'New message',
      body: 'You have a new message.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `conv-${req.params.id}`,
      data: { url: '/' },
    };
  } else if (tier === 'name_only') {
    const senderProfile = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(userId);
    pushPayload = {
      title: senderProfile?.display_name || 'Someone',
      body: 'Sent you a message.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `conv-${req.params.id}`,
      data: { url: '/' },
    };
  } else if (tier === 'silent_push') {
    pushPayload = {
      title: 'Spectrum Dating',
      body: '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `conv-${req.params.id}`,
      data: { url: '/' },
    };
  }
  // tier === 'none' or anything else → no push

  if (pushPayload) {
    notifyUser(db, otherId, pushPayload).catch(() => {});
  }

  res.status(201).json({ messageId, timeLabel });
});

// ---------------------------------------------------------------------------
// DELETE /messaging/conversations/:id/messages/:messageId
// ---------------------------------------------------------------------------

router.delete('/conversations/:id/messages/:messageId', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const message = db.prepare('SELECT id, sender_id, conversation_id FROM messages WHERE id = ?').get(req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.conversation_id !== req.params.id) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id !== userId) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`UPDATE messages SET body = '__DELETED__', deleted = 1 WHERE id = ?`).run(req.params.messageId);

  const { io } = req.app.locals;
  if (io) {
    emitMessageDeleted(io, req.params.id, req.params.messageId);
  }

  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// POST /messaging/conversations/:id/archive
// ---------------------------------------------------------------------------

router.post('/conversations/:id/archive', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  if (conv.user_a_id === userId) {
    db.prepare('UPDATE conversations SET archived_by_a = 1 WHERE id = ?').run(req.params.id);
  } else {
    db.prepare('UPDATE conversations SET archived_by_b = 1 WHERE id = ?').run(req.params.id);
  }

  const { io } = req.app.locals;
  if (io) {
    emitConversationArchived(io, req.params.id, userId);
  }

  res.json({ archived: true });
});

// ---------------------------------------------------------------------------
// POST /messaging/block
// ---------------------------------------------------------------------------

const VALID_REASONS = ['harassment', 'spam', 'fake_profile', 'other'];

router.post('/block', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { blockedUserId, reason, details } = req.body;

  if (!blockedUserId) return res.status(400).json({ error: 'blockedUserId is required' });
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
  }
  if (details && details.length > 500) {
    return res.status(400).json({ error: 'details exceeds 500 characters' });
  }

  const id = newId();
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO blocks (id, blocker_id, blocked_id, reason, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, blockedUserId, reason, details || null, now);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Already blocked' });
    }
    throw err;
  }

  res.status(201).json({ blocked: true });
});

// ---------------------------------------------------------------------------
// POST /messaging/report — file a report for moderator review.
// SEPARATE from /block: a user can report without blocking and vice versa.
// ---------------------------------------------------------------------------

router.post('/report', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { reportedUserId, reason, details, conversationId } = req.body ?? {};

  if (!reportedUserId || typeof reportedUserId !== 'string') {
    return res.status(400).json({ error: 'reportedUserId is required' });
  }
  if (reportedUserId === userId) {
    return res.status(400).json({ error: 'You cannot report yourself' });
  }

  const reported = db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);
  if (!reported) return res.status(404).json({ error: 'Reported user not found' });

  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'reason is required' });
  }
  if (reason.length > 100) {
    return res.status(400).json({ error: 'reason exceeds 100 characters' });
  }
  if (details !== undefined && details !== null) {
    if (typeof details !== 'string') return res.status(400).json({ error: 'details must be a string' });
    if (details.length > 1000) return res.status(400).json({ error: 'details exceeds 1000 characters' });
  }
  if (conversationId !== undefined && conversationId !== null && typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId must be a string' });
  }

  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, conversation_id, reason, details, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(newId(), userId, reportedUserId, conversationId || null, reason.trim(), details || null, Date.now());

  res.status(201).json({ reported: true });
});

// ---------------------------------------------------------------------------
// GET /messaging/my-reports — the current user's submitted reports, newest
// first. Lets a reporter see their report was reviewed/actioned. Never exposes
// the moderator_note.
// ---------------------------------------------------------------------------

router.get('/my-reports', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const rows = db.prepare(`
    SELECT r.id, r.reason, r.status, r.created_at, r.resolved_at,
           p.display_name AS reported_name
    FROM reports r
    LEFT JOIN profiles p ON p.user_id = r.reported_id
    WHERE r.reporter_id = ?
    ORDER BY r.created_at DESC
  `).all(userId);

  const reports = rows.map(row => ({
    id: row.id,
    reportedName: row.reported_name || '',
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
  }));

  res.json({ reports });
});

export default router;
