import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../utils/ids.js';
import { emitReactionUpdate } from '../socket/emitters.js';

const router = Router();

const ALLOWED_EMOJI = new Set(['♥', '👍', '😊', '😄', '🤔']);

export function getReactionSummary(db, messageId, currentUserId) {
  const rows = db.prepare(
    'SELECT emoji, user_id FROM message_reactions WHERE message_id = ?'
  ).all(messageId);

  const counts = {};
  const userReacted = new Set();
  for (const row of rows) {
    counts[row.emoji] = (counts[row.emoji] || 0) + 1;
    if (row.user_id === currentUserId) userReacted.add(row.emoji);
  }
  return Object.entries(counts).map(([emoji, count]) => ({
    emoji,
    count,
    userReacted: userReacted.has(emoji),
  }));
}

function getMessageConversation(db, messageId) {
  return db.prepare('SELECT id, conversation_id FROM messages WHERE id = ?').get(messageId);
}

function isConversationMember(db, convId, userId) {
  const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(convId);
  if (!conv) return null;
  if (conv.user_a_id !== userId && conv.user_b_id !== userId) return null;
  return conv;
}

// ---------------------------------------------------------------------------
// POST /reactions/messages/:messageId/reactions  — toggle reaction
// ---------------------------------------------------------------------------

router.post('/messages/:messageId/reactions', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { emoji } = req.body;

  if (!emoji || !ALLOWED_EMOJI.has(emoji)) {
    return res.status(400).json({ error: `emoji must be one of: ${[...ALLOWED_EMOJI].join(' ')}` });
  }

  const message = getMessageConversation(db, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const conv = isConversationMember(db, message.conversation_id, userId);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });

  // Toggle: check if reaction already exists
  const existing = db.prepare(
    'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(req.params.messageId, userId, emoji);

  let action;
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    action = 'removed';
  } else {
    db.prepare(
      'INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(newId(), req.params.messageId, userId, emoji, Date.now());
    action = 'added';
  }

  const reactions = getReactionSummary(db, req.params.messageId, userId);

  const { io } = req.app.locals;
  if (io) emitReactionUpdate(io, message.conversation_id, req.params.messageId, reactions);

  res.json({ reactions, action });
});

// ---------------------------------------------------------------------------
// GET /reactions/messages/:messageId/reactions
// ---------------------------------------------------------------------------

router.get('/messages/:messageId/reactions', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const message = getMessageConversation(db, req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const conv = isConversationMember(db, message.conversation_id, userId);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });

  res.json({ reactions: getReactionSummary(db, req.params.messageId, userId) });
});

export default router;
