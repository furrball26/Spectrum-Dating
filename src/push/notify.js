import { sendPush } from './webpush.js';

/**
 * Send a push notification to all subscriptions for a user.
 * Silently removes expired subscriptions (410 Gone).
 */
export async function notifyUser(db, userId, payload) {
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const sub of subs) {
    try {
      await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}
