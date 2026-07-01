import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { requireAuth, signToken } from '../middleware/auth.js';
import { emailConfigured, sendVerificationEmail } from '../email/resend.js';
import { deleteObject } from '../storage/r2.js';

const router = Router();
const BCRYPT_ROUNDS = 12;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /account/change-password — verify current, set new, keep this session
// logged in (fresh token) while invalidating other sessions (token_version bump).
router.post('/change-password', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(403).json({ error: 'Current password is incorrect.' });
  }
  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const newTv = (user.token_version ?? 0) + 1;
  db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?').run(newHash, newTv, userId);
  return res.json({ ok: true, token: signToken(userId, newTv) });
});

// POST /account/change-email — verify password, ensure not taken, update; if
// email verification is configured, mark unverified + send a new link.
router.post('/change-email', requireAuth, async (req, res) => {
  const { db, userId } = req.ctx;
  const { newEmail, currentPassword } = req.body ?? {};
  if (typeof newEmail !== 'string' || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'New email and current password are required.' });
  }
  const email = newEmail.trim().toLowerCase();
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  const user = db.prepare('SELECT password_hash, email, token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(403).json({ error: 'Current password is incorrect.' });
  }
  if (email === user.email) return res.status(400).json({ error: 'That is already your email.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, userId)) {
    return res.status(409).json({ error: 'That email is already in use.' });
  }
  const verifyOn = emailConfigured();
  // Bump token_version to invalidate OTHER sessions on an email change — matches
  // change-password's behavior (an email change is a security-sensitive event;
  // stale sessions on other devices should not survive it). Re-issue a fresh
  // token for THIS session so the caller stays signed in.
  const newTv = (user.token_version ?? 0) + 1;
  db.prepare('UPDATE users SET email = ?, email_verified = ?, token_version = ? WHERE id = ?')
    .run(email, verifyOn ? 0 : 1, newTv, userId);
  if (verifyOn) {
    const vt = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO email_verifications (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(vt, userId, Date.now() + 24 * 60 * 60 * 1000, Date.now());
    sendVerificationEmail(email, vt).catch(() => {});
  }
  return res.json({ ok: true, email, emailVerified: !verifyOn, token: signToken(userId, newTv) });
});

// DELETE /account/me — permanently delete the user and all their data
router.delete('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  // Right-to-erasure: collect the user's object-storage keys BEFORE the DB
  // cascade removes the rows. Otherwise the FK cascade drops the DB records but
  // the actual photo/attachment objects stay world-fetchable in the public R2
  // bucket forever. We delete the objects AFTER the DB transaction commits, so a
  // storage error can never roll back (or block) the account deletion itself.
  const photoKeys = db.prepare(
    'SELECT storage_key FROM profile_photos WHERE user_id = ? AND storage_key IS NOT NULL AND storage_key != ?'
  ).all(userId, '').map(r => r.storage_key);
  let attachmentKeys = [];
  try {
    attachmentKeys = db.prepare(
      'SELECT storage_key FROM message_attachments WHERE uploader_id = ? AND storage_key IS NOT NULL AND storage_key != ?'
    ).all(userId, '').map(r => r.storage_key);
  } catch {
    // message_attachments may not exist / be relevant in all deployments.
    attachmentKeys = [];
  }
  const storageKeys = [...new Set([...photoKeys, ...attachmentKeys])];

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
  } catch (e) {
    console.error('Account deletion error:', e);
    return res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }

  // Best-effort object cleanup — after the commit, never awaited/blocking, and
  // never able to fail the request (the account is already gone from the DB).
  for (const key of storageKeys) {
    deleteObject(key).catch((err) => {
      console.error('[account-delete] failed to delete R2 object', key, '-', err?.message);
    });
  }

  res.json({ ok: true, deleted: true });
});

export default router;
