import { Router } from 'express';
import bcrypt from 'bcrypt';
import { newId } from '../utils/ids.js';
import { signToken } from '../middleware/auth.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

router.post('/register', async (req, res) => {
  const { email, password } = req.body ?? {};

  // Validate input
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes('@')) {
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

  const token = signToken(userId);
  return res.status(201).json({ token, userId });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const { db } = req.ctx;
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(normalizedEmail);

  // Use constant-time comparison even if user not found (timing safety)
  const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000000';
  const hashToCheck = user ? user.password_hash : dummyHash;
  const valid = await bcrypt.compare(password, hashToCheck);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user.id);
  return res.json({ token, userId: user.id });
});

export default router;
