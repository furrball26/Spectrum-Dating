import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, verifyToken, signPurposeToken, verifyPurposeToken } from '../middleware/auth.js';
import { coarseLabel } from '../utils/time.js';

const router = Router();

// Low-ceiling limiter — exports are rare and expensive (O(convos×msgs) scan of
// the full corpus). Keeps this from becoming a cheap PII-scrape / DoS amplifier.
// Keyed per-user (req.ctx.userId is set by optionalAuth/contextMiddleware);
// falls back to IP for the ?token= path before ctx is resolved.
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.ctx?.userId ? `u:${req.ctx.userId}` : ipKeyGenerator(req.ip)),
  message: { error: 'Too many export requests. Please wait a few minutes and try again.' },
});

// POST /export/token — mint a short-lived (5-minute), purpose-scoped export
// token. The browser download link then carries THIS token in the query string
// instead of the 30-day session JWT — so a leaked URL (proxy/CDN log, history,
// Referer) exposes at most a 5-minute, export-only credential, not a full
// account-takeover session token. Requires a normal Authorization header.
router.post('/token', requireAuth, exportLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const token = signPurposeToken(userId, 'export', user.token_version ?? 0, '5m');
  res.json({ token });
});

router.get('/conversations', exportLimiter, (req, res) => {
  // Resolve the requester. Accept, in order of preference:
  //   1. An Authorization header (already resolved into req.ctx.userId).
  //   2. A short-lived, purpose-scoped export token in ?token= (preferred for
  //      browser download links that can't send custom headers).
  //   3. (Legacy) a full session JWT in ?token= — still honored for backward
  //      compatibility during the frontend transition, but the export token
  //      path above is the intended, low-blast-radius mechanism.
  let userId = req.ctx?.userId ?? null;

  if (!userId && req.query.token) {
    const purpose = verifyPurposeToken(req.query.token, 'export');
    if (purpose) {
      userId = purpose.sub;
    } else {
      // Legacy session-JWT fallback. verifyToken runs the same
      // version/suspension/existence check as requireAuth.
      userId = verifyToken(req.query.token);
    }
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  // The export URL is sensitive (carries a bearer token in the query string).
  // Prevent it from being cached by any proxy/CDN and strip the Referer so the
  // token can't leak to third parties via a follow-on navigation.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

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
    // Timestamps are coarsened per the no-raw-time product rule; display names
    // and message bodies are the requester's OWN conversation data and are
    // intentionally exported at full fidelity.
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
