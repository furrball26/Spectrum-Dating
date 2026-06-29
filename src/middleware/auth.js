import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(userId, tv = 0) {
  return jwt.sign({ sub: userId, tv }, JWT_SECRET, { expiresIn: '30d' });
}

function checkTokenVersion(decoded) {
  const db = getDb();
  const user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.sub);
  if (!user) return false; // user deleted
  if ((decoded.tv ?? -1) !== user.token_version) return false; // token revoked
  return true;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
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
      if (checkTokenVersion(payload)) {
        req.user = { id: payload.sub };
      }
    } catch { /* no-op */ }
  }
  next();
}
