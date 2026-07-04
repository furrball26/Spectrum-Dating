// Daily-rotating HMAC salt for the cookieless unique-visitor session_hash.
//
// PRIVACY: session_hash = HMAC(dailySalt, ip + userAgent). The salt rotates
// every UTC day and old salts are pruned (>2 days) by the scheduler. Because
// the key that produced a given day's hashes is destroyed, the hash is
// non-reversible AND cannot be correlated across days — "we do not track
// individuals" holds by construction. Raw ip/ua are used only to compute the
// hash and are never stored or logged.

import crypto from 'crypto';

// In-process cache so the hot ingest path avoids a DB read per request.
let _cache = { day: null, salt: null };

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Return today's salt, lazily creating a fresh random one on first use of a new
// day. INSERT OR IGNORE keeps concurrent first-writes race-safe.
export function getDailySalt(db, day = utcDay()) {
  if (_cache.day === day && _cache.salt) return _cache.salt;
  let row = db.prepare('SELECT salt FROM telemetry_salt WHERE day = ?').get(day);
  if (!row) {
    const salt = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR IGNORE INTO telemetry_salt (day, salt) VALUES (?, ?)').run(day, salt);
    row = db.prepare('SELECT salt FROM telemetry_salt WHERE day = ?').get(day);
  }
  _cache = { day, salt: row.salt };
  return row.salt;
}

// Compute the unique-visitor hash from the RAW ip+ua for the current day's salt.
// Callers MUST discard ip/ua immediately after — this function never retains them.
export function computeSessionHash(db, ip, ua, day = utcDay()) {
  const salt = getDailySalt(db, day);
  return crypto.createHmac('sha256', salt).update(`${ip || ''}|${ua || ''}`).digest('hex');
}

// Rotate: ensure today's salt exists (fresh random) and drop salts older than
// ~2 days so cross-day correlation is impossible.
export function rotateSalt(db, now = Date.now()) {
  getDailySalt(db, utcDay(now));
  const cutoff = utcDay(now - 2 * 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM telemetry_salt WHERE day < ?').run(cutoff);
}

// Test-only: clear the in-process cache so a test can force a DB re-read.
export function _resetSaltCache() {
  _cache = { day: null, salt: null };
}
