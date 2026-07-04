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

// Combined admin resolution: env allowlist OR the DB `is_admin` flag (migration
// 055). The ADMIN_EMAILS allowlist is the IMMUTABLE ROOT — an env-listed admin
// is always an admin regardless of the DB flag (and the /admin/roles endpoint
// refuses to modify an env-listed target, so the owner can never be locked out).
// A `users` row (with at least email + is_admin) is expected; tolerant of null.
export function isAdminUser(row) {
  if (!row) return false;
  return isAdminEmail(row.email) || !!row.is_admin;
}

// requireAdmin must run AFTER requireAuth (needs req.user.id / req.ctx.userId)
export function requireAdmin(req, res, next) {
  const db = getDb();
  const userId = req.ctx?.userId || req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const row = db.prepare('SELECT email, is_admin FROM users WHERE id = ?').get(userId);
  if (!isAdminUser(row)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}
