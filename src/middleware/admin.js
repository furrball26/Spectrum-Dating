import { getDb } from '../db.js';

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

// requireAdmin must run AFTER requireAuth (needs req.user.id / req.ctx.userId)
export function requireAdmin(req, res, next) {
  const db = getDb();
  const userId = req.ctx?.userId || req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!row || !isAdminEmail(row.email)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}
