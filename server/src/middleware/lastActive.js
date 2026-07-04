// Lazy "last active" DATE tracker (admin-only signal — 046_last_active.sql).
//
// Runs after optionalAuth + contextMiddleware. When an authenticated user makes
// a request and their stored last_active_at is not today's UTC date, we stamp
// today. At most ONE write per user per day. DATE only (never a timestamp), and
// this value is exposed ONLY through the admin member endpoints — never in any
// public/member response. Never blocks the request.

import { utcDay } from '../telemetry/salt.js';

export function lastActiveMiddleware(db) {
  return (req, _res, next) => {
    const userId = req.ctx?.userId || req.user?.id;
    if (userId) {
      try {
        const today = utcDay();
        const row = db.prepare('SELECT last_active_at FROM users WHERE id = ?').get(userId);
        if (row && row.last_active_at !== today) {
          db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(today, userId);
        }
      } catch { /* telemetry is best-effort — never block the request */ }
    }
    next();
  };
}
