import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { coarseLabel } from '../utils/time.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

router.get('/conversations', (req, res) => {
  // Accept token from Authorization header OR ?token= query param (needed for
  // browser download links that cannot send custom headers).
  let userId = req.ctx?.userId ?? null;

  if (!userId && req.query.token) {
    try {
      const payload = jwt.verify(req.query.token, JWT_SECRET);
      userId = payload.sub || payload.userId || payload.id || null;
    } catch {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  const { db } = req.ctx;

  // Fetch all conversations the user is part of (including archived)
  const conversations = db.prepare(`
    SELECT c.id, c.user_a_id, c.user_b_id,
           pa.display_name AS name_a,
           pb.display_name AS name_b
    FROM conversations c
    LEFT JOIN profiles pa ON pa.user_id = c.user_a_id
    LEFT JOIN profiles pb ON pb.user_id = c.user_b_id
    WHERE c.user_a_id = ? OR c.user_b_id = ?
    ORDER BY c.created_at DESC
  `).all(userId, userId);

  const exportData = {
    exportedAt: coarseLabel(Date.now()),
    userId,
    conversations: conversations.map((conv) => {
      const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
      const otherName = conv.user_a_id === userId ? conv.name_b : conv.name_a;

      // Fetch all messages including deleted ones
      const messages = db.prepare(`
        SELECT m.id, m.sender_id, m.body, m.deleted, m.sent_at
        FROM messages m
        WHERE m.conversation_id = ?
        ORDER BY m.sent_at ASC
      `).all(conv.id);

      // Fetch reactions the current user placed on any message in this conversation
      const userReactions = db.prepare(`
        SELECT mr.message_id, mr.emoji
        FROM message_reactions mr
        JOIN messages m ON m.id = mr.message_id
        WHERE m.conversation_id = ? AND mr.user_id = ?
      `).all(conv.id, userId);

      // Build a map of messageId -> [emoji, ...]
      const reactionMap = {};
      for (const r of userReactions) {
        if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
        reactionMap[r.message_id].push(r.emoji);
      }

      return {
        conversationId: conv.id,
        withUser: otherName ?? 'Unknown',
        messages: messages.map((msg) => ({
          messageId: msg.id,
          from: msg.sender_id === userId ? 'me' : 'them',
          body: msg.deleted ? '[deleted]' : msg.body,
          timeGroup: coarseLabel(msg.sent_at),
          reactions: reactionMap[msg.id] ?? [],
        })),
      };
    }),
  };

  res.setHeader('Content-Disposition', 'attachment; filename="spectrum-export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

export default router;


