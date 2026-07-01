import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { randomBytes } from 'crypto';
import { newId } from '../utils/ids.js';
import { signToken, requireAuth, signPurposeToken, verifyPurposeToken } from '../middleware/auth.js';
import { isAdminEmail } from '../middleware/admin.js';
import { disconnectUser } from '../socket/index.js';
import { emailConfigured, sendVerificationEmail, sendPasswordResetEmail } from '../email/resend.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false,
  // Key on req.ip — Express derives this safely from X-Forwarded-For using the
  // `trust proxy` setting (1 hop, set in index.js for Railway), so it's the real
  // client IP and NOT attacker-spoofable. Reading raw x-real-ip/x-forwarded-for
  // headers directly would let an attacker rotate their rate-limit key per
  // request and bypass the limit entirely. ipKeyGenerator normalises IPv6.
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// Tighter, dedicated limiter for /forgot-password. It sits in front of an email
// send, so it's an email-bomb + enumeration-at-volume vector — a stricter
// ceiling than the shared authLimiter (which is generous for interactive
// login/register). Keyed on the real client IP (trust proxy = 1 hop).
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  // Validate input
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { db } = req.ctx;

  // Check for duplicate email
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const userId = newId();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = Date.now();

  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertProfile = db.prepare(
    'INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)'
  );

  db.transaction(() => {
    insertUser.run(userId, normalizedEmail, passwordHash, now);
    insertProfile.run(userId, now);
  })();

  if (emailConfigured()) {
    const verifyToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
    db.prepare('INSERT INTO email_verifications (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(verifyToken, userId, expiresAt, Date.now());
    sendVerificationEmail(normalizedEmail, verifyToken).catch(() => {});
  }

  const token = signToken(userId, 0);
  return res.status(201).json({
    token,
    userId,
    emailVerified: false,
    emailVerificationEnabled: emailConfigured(),
    isAdmin: isAdminEmail(normalizedEmail),
  });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const { db } = req.ctx;
  const user = db.prepare('SELECT id, password_hash, token_version, email_verified, suspended, email FROM users WHERE email = ?').get(normalizedEmail);

  // Use constant-time comparison even if user not found (timing safety)
  const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000000';
  const hashToCheck = user ? user.password_hash : dummyHash;
  const valid = await bcrypt.compare(password, hashToCheck);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Suspended accounts cannot obtain a token.
  if (user.suspended) {
    return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  }

  const tv = user.token_version ?? 0;
  const token = signToken(user.id, tv);
  return res.json({
    token,
    userId: user.id,
    emailVerified: !!user.email_verified,
    emailVerificationEnabled: emailConfigured(),
    isAdmin: isAdminEmail(user.email),
  });
});

// POST /auth/sign-out — invalidate current user's tokens
router.post('/sign-out', requireAuth, (req, res) => {
  const { db } = req.ctx;
  const userId = req.user.id;
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  // Tear down any live sockets — the bumped token_version now makes them stale,
  // but the socket auth check only runs at connect time.
  disconnectUser(req.app.locals.io, userId);
  res.json({ ok: true });
});

// POST /auth/sign-out-all — same effect but clearly named
router.post('/sign-out-all', requireAuth, (req, res) => {
  const { db } = req.ctx;
  const userId = req.user.id;
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  disconnectUser(req.app.locals.io, userId);
  res.json({ ok: true });
});

// POST /auth/forgot-password — start a password reset.
// Always returns 200 (never reveals whether an email is registered). If the
// account exists, emails a 1-hour, single-use reset link.
router.post('/forgot-password', forgotPasswordLimiter, (req, res) => {
  const { db } = req.ctx;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  const user = db.prepare('SELECT id, email, token_version FROM users WHERE email = ?').get(email);
  if (user) {
    const token = signPurposeToken(user.id, 'reset', user.token_version ?? 0, '1h');
    sendPasswordResetEmail(user.email, token).catch(() => {});
  }
  // Same response whether or not the account exists.
  return res.json({ ok: true });
});

// POST /auth/reset-password — complete a password reset with the emailed token.
router.post('/reset-password', authLimiter, async (req, res) => {
  const { db } = req.ctx;
  const { token, password } = req.body ?? {};
  if (typeof token !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const payload = verifyPurposeToken(token, 'reset');
  if (!payload) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  const user = db.prepare('SELECT id, token_version FROM users WHERE id = ?').get(payload.sub);
  // Single-use: the token carries the token_version at issue time; once a reset
  // (or any sign-out) bumps the version, the link no longer works.
  if (!user || (payload.tv ?? -1) !== (user.token_version ?? 0)) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // Bump token_version too: sets the new password AND logs out all old sessions.
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(password_hash, user.id);
  return res.json({ ok: true });
});

// GET /auth/verify?token=xxx — mark email verified
router.get('/verify', (req, res) => {
  const { db } = req.ctx;
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });

  const row = db.prepare('SELECT token, user_id, expires_at FROM email_verifications WHERE token = ?').get(token);
  if (!row) return res.status(404).json({ error: 'Invalid or expired verification link.' });
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);
    return res.status(410).json({ error: 'Verification link has expired. Please request a new one.' });
  }

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
  db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);
  res.json({ ok: true, verified: true });
});

// POST /auth/resend-verification — resend the verification email
router.post('/resend-verification', requireAuth, (req, res) => {
  const { db } = req.ctx;
  const userId = req.user.id;
  if (!emailConfigured()) return res.status(503).json({ error: 'Email sending is not configured.' });

  const user = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  // Clear old tokens for this user
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
  const verifyToken = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO email_verifications (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(verifyToken, userId, expiresAt, Date.now());
  sendVerificationEmail(user.email, verifyToken).catch(() => {});
  res.json({ ok: true });
});

export default router;
