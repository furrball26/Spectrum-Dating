import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { requireAuth, signToken } from '../middleware/auth.js';
import { accountSecurityLimiter } from '../middleware/rateLimits.js';
import { emailConfigured, sendVerificationEmail } from '../email/resend.js';
import { deleteUserCascade } from '../data/deleteUser.js';

const router = Router();
const BCRYPT_ROUNDS = 12;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /account/change-password — verify current, set new, keep this session
// logged in (fresh token) while invalidating other sessions (token_version bump).
router.post('/change-password', requireAuth, accountSecurityLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Please choose a password with at least 8 characters.' });
  }
  const user = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(403).json({ error: "That current password doesn't match. Please check it and try again." });
  }
  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const newTv = (user.token_version ?? 0) + 1;
  db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?').run(newHash, newTv, userId);
  return res.json({ ok: true, token: signToken(userId, newTv) });
});

// POST /account/change-email — verify password, ensure not taken, update; if
// email verification is configured, mark unverified + send a new link.
router.post('/change-email', requireAuth, accountSecurityLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const { newEmail, currentPassword } = req.body ?? {};
  if (typeof newEmail !== 'string' || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'New email and current password are required.' });
  }
  const email = newEmail.trim().toLowerCase();
  if (!emailRegex.test(email)) return res.status(400).json({ error: "That email address doesn't look complete. Please check it." });
  const user = db.prepare('SELECT password_hash, email, token_version FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(403).json({ error: "That current password doesn't match. Please check it and try again." });
  }
  if (email === user.email) return res.status(400).json({ error: "That's already your email address — no change needed." });
  // E18: don't confirm that the target address belongs to another account — a
  // distinct "already in use" reply lets an authenticated attacker enumerate
  // registered emails. Return a generic message that doesn't reveal existence.
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, userId)) {
    return res.status(409).json({ error: 'We couldn’t change your email to that address. Please try a different one.' });
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

// DELETE /account/me — permanently delete the user and all their data via the
// shared cascade (DB rows in a transaction, then best-effort R2 object cleanup).
// T5: this is irreversible, so it re-verifies the password — exactly like
// change-password / change-email above. Without it a hijacked (but not
// password-knowing) session could nuke the whole account. The admin bulk purge
// calls deleteUserCascade directly and is unaffected.
router.delete('/me', requireAuth, accountSecurityLimiter, async (req, res) => {
  const { db, userId } = req.ctx;
  const { password } = req.body ?? {};
  if (!password) {
    return res.status(400).json({ error: 'Please enter your password to confirm.' });
  }
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(403).json({ error: "That password doesn't match. Please check it and try again." });
  }
  try {
    deleteUserCascade(db, userId);
  } catch (e) {
    console.error('Account deletion error:', e);
    return res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
  res.json({ ok: true, deleted: true });
});

export default router;
