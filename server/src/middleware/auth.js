import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';

// Fail fast: never silently fall back to a public dev secret in production —
// an unset JWT_SECRET there would let anyone forge tokens (incl. admin).
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET is not set in production. Refusing to start with an insecure fallback.');
  }
  return 'dev-secret-change-in-production';
})();

export function signToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, tv }, JWT_SECRET, { expiresIn: '30d' });
}

// Verify a raw token AND its version/suspension/existence. Returns the userId
// or null. Use this everywhere a token is accepted (header, ?token=, socket).
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Reject purpose-scoped tokens (reset/export/etc.) here: they must never be
    // accepted as a full session credential. A leaked short-lived reset or
    // export token could otherwise be replayed against any session-authed route.
    if (payload.purpose) return null;
    if (!checkTokenVersion(payload)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// Purpose-scoped short-lived tokens (e.g. password reset). Carrying the user's
// current token_version makes them single-use: a successful reset bumps the
// version, so the same token can't be replayed.
export function signPurposeToken(sub, purpose, tv, expiresIn) {
  return jwt.sign({ sub, purpose, tv }, JWT_SECRET, { expiresIn });
}

export function verifyPurposeToken(token, purpose) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== purpose) return null;
    // Purpose tokens carry the user's token_version at mint time. Re-run the
    // shared version/suspension/existence check so a purpose token minted before
    // the user signed out / was suspended / bumped their token_version is no
    // longer honored within its (short) validity window.
    if (!checkTokenVersion(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function checkTokenVersion(decoded) {
  const db = getDb();
  const user = db.prepare('SELECT token_version, suspended FROM users WHERE id = ?').get(decoded.sub);
  if (!user) return false; // user deleted
  if ((decoded.tv ?? -1) !== user.token_version) return false; // token revoked
  if (user.suspended) return false; // suspended — treat as logged out
  return true;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    // Reject purpose-scoped tokens (reset/export/etc.) — they must never be
    // accepted as a full session credential (mirrors verifyToken's guard).
    if (payload.purpose) return res.status(401).json({ error: 'Unauthorized' });
    if (!checkTokenVersion(payload)) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      // Purpose-scoped tokens (reset/export/etc.) are never a full session —
      // don't populate req.user from one (mirrors verifyToken's guard).
      if (!payload.purpose && checkTokenVersion(payload)) {
        req.user = { id: payload.sub };
      }
    } catch { /* no-op */ }
  }
  next();
}
