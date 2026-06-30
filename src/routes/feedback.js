import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { newId } from '../utils/ids.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /feedback — always-on "tell us what felt wrong" channel.
// Body: { message }. Non-empty string, ≤ 2000 chars (400 otherwise).
// ---------------------------------------------------------------------------
router.post('/', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { message } = req.body ?? {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message exceeds 2000 characters.' });
  }

  db.prepare(
    'INSERT INTO feedback (id, user_id, message, created_at) VALUES (?, ?, ?, ?)'
  ).run(newId(), userId, message.trim(), Date.now());

  res.json({ ok: true });
});

export default router;
