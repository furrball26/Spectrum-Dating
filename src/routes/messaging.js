import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { safetyActionLimiter } from '../middleware/rateLimits.js';
import { newId } from '../utils/ids.js';
import { coarseLabel } from '../utils/time.js';
import { emitNewMessage, emitMessageDeleted, emitConversationArchived, joinConversationRoom } from '../socket/emitters.js';
import { notifyUser } from '../push/notify.js';
import { getReactionSummary } from './reactions.js';

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

// F21 — is the match behind this conversation ended (unmatched)? An ended match
// makes the thread READ-ONLY for BOTH people. We never expose WHO ended it
// (ended_by stays server-side) — only the boolean fact that it has ended.
function isConversationEnded(db, convId) {
  const row = db.prepare(`
    SELECT m.ended_at
    FROM conversations c
    JOIN matches m ON m.id = c.match_id
    WHERE c.id = ?
  `).get(convId);
  return !!(row && row.ended_at);
}

function isBlocked(db, userA, userB) {
  return !!(
    db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(userA, userB, userB, userA)
  );
}

function activeConvoCount(db, userId) {
  // F21: an ENDED (unmatched) conversation is read-only and must not occupy an
  // active-conversation slot for either party.
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM conversations c
    JOIN matches mt ON mt.id = c.match_id
    WHERE ((c.user_a_id = ? AND c.archived_by_a = 0) OR (c.user_b_id = ? AND c.archived_by_b = 0))
      AND mt.ended_at IS NULL
  `).get(userId, userId).cnt;
}

// ---------------------------------------------------------------------------
// GET /messaging/conversations
// ---------------------------------------------------------------------------

router.get('/conversations', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  // F21: LEFT JOIN the match so we know its ended state. The person who ENDED
  // the match (mt.ended_by = them) drops the thread from their list entirely
  // (like archive/block — they chose to end it). The OTHER person keeps the
  // thread but it's flagged ended:true so the list can show it as read-only;
  // they discover the neutral notice only on opening it. We never expose who
  // ended it.
  const rows = db.prepare(`
    SELECT c.id, c.match_id, c.user_a_id, c.user_b_id,
           c.last_read_at_a, c.last_read_at_b,
           mt.ended_at, mt.ended_by,
           m.sent_at as last_sent_at, m.sender_id as last_sender_id
    FROM conversations c
    JOIN matches mt ON mt.id = c.match_id
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
    )
    WHERE ((c.user_a_id = ? AND c.archived_by_a = 0)
       OR (c.user_b_id = ? AND c.archived_by_b = 0))
      AND (mt.ended_at IS NULL OR mt.ended_by != ?)
    ORDER BY COALESCE(m.sent_at, c.created_at) DESC
  `).all(userId, userId, userId);

  const conversations = rows.map(row => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const otherProfile = db.prepare('SELECT display_name, identity_verified, photo_url FROM profiles WHERE user_id = ?').get(otherId);
    const isUserA = row.user_a_id === userId;
    const lastReadAt = isUserA ? (row.last_read_at_a || 0) : (row.last_read_at_b || 0);
    const ended = !!row.ended_at;
    // An ended thread carries no "unread" nudge — nothing new can arrive, and we
    // don't want to draw the unmatched person back with a badge.
    const hasUnread = !ended && !!(row.last_sent_at && row.last_sender_id !== userId && row.last_sent_at > lastReadAt);
    return {
      id: row.id,
      matchId: row.match_id,
      otherUser: { userId: otherId, displayName: otherProfile?.display_name || '', verified: !!otherProfile?.identity_verified, photoUrl: otherProfile?.photo_url || null },
      lastMessageGroup: row.last_sent_at ? coarseLabel(row.last_sent_at) : null,
      hasUnread,
      ended,
    };
  });

  const activeCount = activeConvoCount(db, userId);
  const archivedCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM conversations
    WHERE (user_a_id = ? AND archived_by_a = 1) OR (user_b_id = ? AND archived_by_b = 1)
  `).get(userId, userId).cnt;
  res.json({ conversations, activeCap: 5, activeCount, capReached: activeCount >= 5, archivedCount });
});

// ---------------------------------------------------------------------------
// GET /messaging/conversations/archived  (must precede the /:id wildcard)
// ---------------------------------------------------------------------------

router.get('/conversations/archived', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db.prepare(`
    SELECT c.id, c.match_id, c.user_a_id, c.user_b_id,
           m.sent_at as last_sent_at
    FROM conversations c
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
    )
    WHERE (c.user_a_id = ? AND c.archived_by_a = 1)
       OR (c.user_b_id = ? AND c.archived_by_b = 1)
    ORDER BY COALESCE(m.sent_at, c.created_at) DESC
  `).all(userId, userId);

  const conversations = rows.map(row => {
    const otherId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
    const otherProfile = db.prepare(
      'SELECT display_name, identity_verified, photo_url FROM profiles WHERE user_id = ?'
    ).get(otherId);
    return {
      id: row.id,
      matchId: row.match_id,
      otherUser: {
        userId: otherId,
        displayName: otherProfile?.display_name || '',
        verified: !!otherProfile?.identity_verified,
        photoUrl: otherProfile?.photo_url || null,
      },
      lastMessageGroup: row.last_sent_at ? coarseLabel(row.last_sent_at) : null,
      hasUnread: false,
    };
  });

  res.json({ conversations });
});

// ---------------------------------------------------------------------------
// GET /messaging/conversations/:id
// ---------------------------------------------------------------------------

router.get('/conversations/:id', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
  const otherProfile = db.prepare('SELECT display_name, identity_verified, photo_url FROM profiles WHERE user_id = ?').get(otherId);

  // Pagination: ?limit=N (default 50, max 100) and ?before=<messageId> cursor.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;

  let msgs;
  if (before) {
    // Fetch the pivot timestamp; also verify it belongs to this conversation to
    // prevent information-disclosure via a foreign message id.
    const pivot = db.prepare(
      'SELECT sent_at FROM messages WHERE id = ? AND conversation_id = ?'
    ).get(before, req.params.id);
    if (!pivot) return res.status(400).json({ error: 'Invalid cursor' });
    msgs = db.prepare(`
      SELECT id, sender_id, body, deleted, sent_at
      FROM messages
      WHERE conversation_id = ? AND sent_at < ?
      ORDER BY sent_at DESC, id DESC
      LIMIT ?
    `).all(req.params.id, pivot.sent_at, limit + 1);
  } else {
    msgs = db.prepare(`
      SELECT id, sender_id, body, deleted, sent_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY sent_at DESC, id DESC
      LIMIT ?
    `).all(req.params.id, limit + 1);
  }

  // If we got more than `limit` rows there are older messages available.
  const hasMore = msgs.length > limit;
  if (hasMore) msgs.pop();
  msgs.reverse(); // restore chronological (ASC) order for the client

  // Hydrate any APPROVED attachment per message so photos survive reload/reopen
  // (only approved ones are ever surfaced; pending_review/rejected stay hidden).
  const attachmentFor = (messageId) => {
    const a = db.prepare(
      `SELECT id, public_url, mime_type, upload_status FROM message_attachments WHERE message_id = ? AND upload_status = 'approved'`
    ).get(messageId);
    return a ? { id: a.id, publicUrl: a.public_url, mimeType: a.mime_type, status: a.upload_status } : null;
  };

  const messages = msgs.map(m => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.deleted ? null : m.body,
    deleted: !!m.deleted,
    timeLabel: coarseLabel(m.sent_at),
    // Attach reaction summary so reactions survive reload/reopen (the client
    // hydrates msg.reactions). Deleted messages carry no reactions.
    reactions: m.deleted ? [] : getReactionSummary(db, m.id, userId),
    attachment: m.deleted ? null : attachmentFor(m.id),
  }));

  res.json({
    conversation: {
      id: conv.id || req.params.id,
      otherUser: { userId: otherId, displayName: otherProfile?.display_name || '', verified: !!otherProfile?.identity_verified, photoUrl: otherProfile?.photo_url || null },
      // F21 — read-only flag. True once EITHER party has unmatched; the client
      // renders the neutral "This conversation has ended." notice and hides the
      // composer. We never say who ended it.
      ended: isConversationEnded(db, req.params.id),
    },
    messages,
    hasMore,
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

  // Join BOTH parties' live sockets to the new room now, so the very first
  // message delivers in real-time without either client reloading. The badge
  // socket only auto-joins conv rooms at connect time (socket/index.js), so a
  // conversation created mid-session would otherwise be silent until reload.
  const { io } = req.app.locals;
  joinConversationRoom(io, id, userId, otherId);

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

  // F21 — read-only enforcement. Once the match is ended (unmatched by either
  // party) no new messages may be posted by EITHER person. Server-side gate so a
  // stale client (or a direct API call) can't write into an ended thread. The
  // message is neutral — it never reveals who ended the conversation.
  if (isConversationEnded(db, req.params.id)) {
    return res.status(409).json({ error: 'This conversation has ended.', code: 'CONVERSATION_ENDED' });
  }

  const body = (req.body.body || '').trim();

  // Optional photo attachment. The ENTIRE attachment-accepting branch is gated
  // behind ATTACHMENTS_ENABLED so nothing goes live until the flag is flipped.
  const attachmentsEnabled = process.env.ATTACHMENTS_ENABLED === 'true';
  const rawAttachmentId = req.body.attachmentId;
  const wantsAttachment = rawAttachmentId !== undefined && rawAttachmentId !== null && rawAttachmentId !== '';

  if (wantsAttachment && !attachmentsEnabled) {
    return res.status(400).json({ error: 'Attachments are not enabled' });
  }

  // Body is REQUIRED unless a (gated) attachment is present — an attachment-only
  // message is allowed. This is the E37 fix: text + attachment persist together
  // in ONE call, so the failure-path can never lose the typed text.
  let attachment = null;
  if (wantsAttachment) {
    if (typeof rawAttachmentId !== 'string') {
      return res.status(400).json({ error: 'attachmentId must be a string' });
    }
    attachment = db.prepare(
      'SELECT id, uploader_id, upload_status, message_id, public_url, mime_type FROM message_attachments WHERE id = ?'
    ).get(rawAttachmentId);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    if (attachment.uploader_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (attachment.upload_status !== 'pending_review' && attachment.upload_status !== 'approved') {
      return res.status(409).json({ error: `Attachment is not ready (status '${attachment.upload_status}')` });
    }
    if (attachment.message_id) {
      return res.status(409).json({ error: 'Attachment is already attached to a message' });
    }
  }

  if (!body && !attachment) return res.status(400).json({ error: 'Message body cannot be empty' });
  if (body.length > 2000) return res.status(400).json({ error: 'Message body exceeds 2000 characters' });

  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;

  // Consent gate
  if (isBlocked(db, userId, otherId)) {
    return res.status(403).json({ error: 'This conversation is no longer available.', code: 'CONSENT_GATE' });
  }

  const messageId = newId();
  const now = Date.now();

  // Insert the message and link the attachment in ONE transaction so text +
  // attachment can never end up split-brain (E37).
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_id, body, sent_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(messageId, req.params.id, userId, body, now);

      if (attachment) {
        const linked = db.prepare(
          `UPDATE message_attachments SET message_id = ? WHERE id = ? AND message_id IS NULL`
        ).run(messageId, attachment.id);
        // Guard against a concurrent link (TOCTOU): if some other request linked
        // it between our check and here, 0 rows change → abort the whole txn.
        if (linked.changes !== 1) {
          throw new Error('ATTACHMENT_ALREADY_LINKED');
        }
      }
    })();
  } catch (e) {
    if (e.message === 'ATTACHMENT_ALREADY_LINKED') {
      return res.status(409).json({ error: 'Attachment is already attached to a message' });
    }
    throw e;
  }

  const timeLabel = coarseLabel(now);

  // Serialized attachment for the response + realtime emit (only when linked).
  const attachmentPayload = attachment
    ? { id: attachment.id, publicUrl: attachment.public_url, mimeType: attachment.mime_type, status: attachment.upload_status }
    : null;

  const { io } = req.app.locals;
  if (io) {
    emitNewMessage(io, req.params.id, { id: messageId, senderId: userId, body, deleted: false, timeLabel, attachment: attachmentPayload });
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

  const response = { messageId, timeLabel };
  if (attachmentPayload) response.attachment = attachmentPayload;
  res.status(201).json(response);
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
// POST /messaging/conversations/:id/unarchive
// ---------------------------------------------------------------------------

router.post('/conversations/:id/unarchive', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const conv = isConversationMember(db, req.params.id, userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  if (conv.user_a_id === userId) {
    db.prepare('UPDATE conversations SET archived_by_a = 0 WHERE id = ?').run(req.params.id);
  } else {
    db.prepare('UPDATE conversations SET archived_by_b = 0 WHERE id = ?').run(req.params.id);
  }

  res.json({ unarchived: true });
});

// ---------------------------------------------------------------------------
// POST /messaging/block
// ---------------------------------------------------------------------------

// 'inappropriate' is included because Discover's report sheet defaults to it —
// omitting it made a valid client reason 400, and the swallowed client error
// meant the reported person was silently never blocked (safety promise broken).
const VALID_REASONS = ['harassment', 'spam', 'fake_profile', 'inappropriate', 'other'];

router.post('/block', requireAuth, safetyActionLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const { blockedUserId, reason, details } = req.body;

  if (!blockedUserId) return res.status(400).json({ error: 'blockedUserId is required' });
  // Self-block guard + existence check, mirroring /report — otherwise a
  // self-target or nonexistent target lets the FK violation bubble as a generic
  // 500 (and burns the abuse limiter).
  if (blockedUserId === userId) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
  }
  if (details && details.length > 500) {
    return res.status(400).json({ error: 'details exceeds 500 characters' });
  }

  const blocked = db.prepare('SELECT id FROM users WHERE id = ?').get(blockedUserId);
  if (!blocked) return res.status(404).json({ error: 'User not found' });

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
// GET /messaging/blocked — list the people the current user has blocked,
// so blocking isn't a one-way trapdoor with no review or undo.
// ---------------------------------------------------------------------------
router.get('/blocked', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const rows = db.prepare(`
    SELECT b.blocked_id AS userId, b.reason, b.created_at,
           p.display_name AS displayName
    FROM blocks b
    LEFT JOIN profiles p ON p.user_id = b.blocked_id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `).all(userId);
  res.json({
    blocked: rows.map(r => ({
      userId: r.userId,
      displayName: r.displayName || 'Someone',
      reason: r.reason,
    })),
  });
});

// ---------------------------------------------------------------------------
// DELETE /messaging/blocked/:userId — unblock a previously-blocked user.
// ---------------------------------------------------------------------------
router.delete('/blocked/:userId', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const info = db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .run(userId, req.params.userId);
  res.json({ unblocked: info.changes > 0 });
});

// ---------------------------------------------------------------------------
// POST /messaging/report — file a report for moderator review.
// SEPARATE from /block: a user can report without blocking and vice versa.
// ---------------------------------------------------------------------------

router.post('/report', requireAuth, safetyActionLimiter, (req, res) => {
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

// ---------------------------------------------------------------------------
// POST /messaging/reports/:id/withdraw — let the reporter take back a report
// they filed in error. Only the reporter may withdraw, and only while the
// report is still 'open' (not yet reviewed/actioned/dismissed). We soft-set
// status = 'withdrawn' (keep the row for audit; never hard-delete). A
// withdrawn report drops out of the admin OPEN queue automatically.
// ---------------------------------------------------------------------------

router.post('/reports/:id/withdraw', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const report = db.prepare(
    'SELECT id, reporter_id, status FROM reports WHERE id = ?'
  ).get(req.params.id);

  // Same 404 for "not found" and "not yours" — don't disclose existence.
  if (!report || report.reporter_id !== userId) {
    return res.status(404).json({ error: 'Report not found' });
  }
  if (report.status !== 'open') {
    return res.status(409).json({ error: 'This report has already been reviewed' });
  }

  db.prepare(`UPDATE reports SET status = 'withdrawn' WHERE id = ?`).run(req.params.id);

  // Moderation audit trail — append-only, mirrors admin.js logMod().
  try {
    db.prepare(
      'INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newId(), userId, 'withdraw_report', req.params.id, '', Date.now());
  } catch {
    // Never fail the withdraw just because the audit insert hiccuped.
  }

  res.json({ ok: true, status: 'withdrawn' });
});

export default router;
