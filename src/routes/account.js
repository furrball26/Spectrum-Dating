import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// DELETE /account/me — permanently delete the user and all their data
router.delete('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  // Foreign keys with ON DELETE CASCADE handle profiles, interests, swipes,
  // matches, conversations, messages, reactions, blocks, push_subscriptions.
  // Delete in a transaction for safety.
  const deleteUser = db.transaction((uid) => {
    // Explicitly clean up tables that may not cascade (defensive)
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(uid);
    // Matches/conversations reference user via two columns — delete both sides
    db.prepare('DELETE FROM matches WHERE user_a_id = ? OR user_b_id = ?').run(uid, uid);
    db.prepare('DELETE FROM conversations WHERE user_a_id = ? OR user_b_id = ?').run(uid, uid);
    db.prepare('DELETE FROM swipes WHERE swiper_id = ? OR swiped_id = ?').run(uid, uid);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
    db.prepare('DELETE FROM profiles WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });

  try {
    deleteUser(userId);
    res.json({ ok: true, deleted: true });
  } catch (e) {
    console.error('Account deletion error:', e);
    res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
});

export default router;
