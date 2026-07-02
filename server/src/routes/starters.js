import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const TEMPLATES = [
  (shared) => `What got you into ${shared[0]}?`,
  (shared) => `Do you prefer ${shared[0]} solo or with others?`,
  (shared) => `What's something about ${shared[0]} that most people don't know?`,
  (shared) => `I noticed we both like ${shared[0]} — how long have you been into it?`,
  (shared) => `If you had a free weekend, would you spend it on ${shared[0]}?`,
];

const GENERIC_TEMPLATES = [
  () => `What's something you've been wanting to try recently?`,
  () => `How do you usually like to spend a quiet evening?`,
  () => `What's one thing you're really passionate about right now?`,
];

function isConversationMember(db, convId, userId) {
  const conv = db.prepare('SELECT user_a_id, user_b_id FROM conversations WHERE id = ?').get(convId);
  if (!conv) return null;
  if (conv.user_a_id !== userId && conv.user_b_id !== userId) return null;
  return conv;
}

router.get('/conversations/:conversationId', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { conversationId } = req.params;

  const conv = isConversationMember(db, conversationId, userId);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found or access denied' });
  }

  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;

  // Fetch interests for both users
  const myInterests = db.prepare(
    'SELECT interest FROM user_interests WHERE user_id = ?'
  ).all(userId).map((r) => r.interest);

  const theirInterests = db.prepare(
    'SELECT interest FROM user_interests WHERE user_id = ?'
  ).all(otherId).map((r) => r.interest);

  const theirSet = new Set(theirInterests);
  const shared = myInterests.filter((i) => theirSet.has(i));

  const starters = [];
  const seen = new Set();

  // Prefer templates that reference shared interests
  if (shared.length > 0) {
    for (const tpl of TEMPLATES) {
      if (starters.length >= 3) break;
      const text = tpl(shared);
      if (!seen.has(text)) {
        seen.add(text);
        starters.push(text);
      }
    }
  }

  // Fill remaining slots with generic templates
  for (const tpl of GENERIC_TEMPLATES) {
    if (starters.length >= 3) break;
    const text = tpl();
    if (!seen.has(text)) {
      seen.add(text);
      starters.push(text);
    }
  }

  // Starters are never stored -- generated on the fly each request
  return res.json({ starters: starters.slice(0, 3) });
});

export default router;
