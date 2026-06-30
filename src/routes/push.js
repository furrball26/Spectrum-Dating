import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mutationLimiter } from '../middleware/rateLimits.js';
import { newId } from '../utils/ids.js';
import { isPushConfigured, sendPush } from '../push/webpush.js';

const router = Router();

// GET /push/vapid-public-key
router.get('/vapid-public-key', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured.' });
  res.json({ publicKey: key });
});

// POST /push/subscribe
router.post('/subscribe', requireAuth, mutationLimiter, (req, res) => {
  const { db, userId } = req.ctx;
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys (p256dh, auth) are required.' });
  }

  // Upsert by endpoint
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (existing) {
    db.prepare('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ? WHERE endpoint = ?')
      .run(userId, keys.p256dh, keys.auth, endpoint);
  } else {
    db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), userId, endpoint, keys.p256dh, keys.auth, Date.now());
  }

  res.json({ ok: true });
});

// DELETE /push/subscribe
router.delete('/subscribe', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required.' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  res.json({ ok: true });
});

export default router;
