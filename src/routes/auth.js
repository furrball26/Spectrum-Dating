import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { randomBytes } from 'crypto';
import { newId } from '../utils/ids.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { emailConfigured, sendVerificationEmail } from '../email/resend.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false,
  // Use real client IP from proxy headers (Railway / Cloudflare) before
  // falling back to req.ip, which is the proxy address behind Railway.
  keyGenerator: (req) => {
    // Prefer real client IP from proxy headers (Railway / Cloudflare), then
    // normalise through the IPv6-safe helper required by express-rate-limit v8
    // (avoids ERR_ERL_KEY_GEN_IPV6 at startup).
    const ip =
      req.headers['x-real-ip'] ||
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip;
    return ipKeyGenerator(ip);
  },
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
  const user = db.prepare('SELECT id, password_hash, token_version, email_verified FROM users WHERE email = ?').get(normalizedEmail);

  // Use constant-time comparison even if user not found (timing safety)
  const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000000';
  const hashToCheck = user ? user.password_hash : dummyHash;
  const valid = await bcrypt.compare(password, hashToCheck);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const tv = user.token_version ?? 0;
  const token = signToken(user.id, tv);
  return res.json({
    token,
    userId: user.id,
    emailVerified: !!user.email_verified,
    emailVerificationEnabled: emailConfigured(),
  });
});

// POST /auth/sign-out — invalidate current user's tokens
router.post('/sign-out', requireAuth, (req, res) => {
  const { db } = req.ctx;
  const userId = req.user.id;
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  res.json({ ok: true });
});

// POST /auth/sign-out-all — same effect but clearly named
router.post('/sign-out-all', requireAuth, (req, res) => {
  const { db } = req.ctx;
  const userId = req.user.id;
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  res.json({ ok: true });
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
