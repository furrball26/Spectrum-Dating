// Per-user rate limiters for mutation / abuse-vector endpoints.
//
// These run AFTER requireAuth + contextMiddleware, so req.ctx.userId is
// always set when they execute. We key on userId rather than IP so that:
//   (a) Shared IPs (NAT/mobile CGNAT) don't bleed into each other's limits.
//   (b) IP-spoofing / header-rotation attacks can't bypass the limit.
//
// Both limiters store their window in memory (the default MemoryStore), which
// is per-process. Railway currently runs a single process; if horizontal
// scaling ever happens, swap in a Redis store.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Key on userId when available — never on raw IP for authenticated routes.
// Falls back to the IPv6-normalized IP (via ipKeyGenerator) only if somehow
// the context hasn't been set yet. Prefixing userId with "u:" ensures a UUID
// is never confused with an IP address by the validator.
function userOrIpKey(req) {
  const userId = req.ctx?.userId;
  if (userId) return `u:${userId}`;
  return ipKeyGenerator(req.ip);
}

// ── Mutation limiter ─────────────────────────────────────────────────────────
// Covers high-frequency actions: swipe, photo presign, push subscribe.
// 100 requests per user per minute — generous for real use, blocks automation.
export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests. Please slow down.' },
  skipSuccessfulRequests: false,
});

// ── Abuse-report limiter (feedback / verification) ───────────────────────────
// Covers non-safety moderation-queue endpoints: /feedback, verification-request.
// 10 requests per user per 15 minutes — enough for genuine use, prevents queue
// flooding. Deliberately does NOT cover /report + /block (see safetyActionLimiter
// below): feedback spam must never rate-starve a safety report or block.
export const abuseReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many reports or feedback submissions. Please wait 15 minutes before trying again.' },
  skipSuccessfulRequests: false,
});

// ── Account-security limiter (change-password / change-email) ────────────────
// Guards the credential-change endpoints. Each request runs bcrypt.compare on
// the supplied current password (rounds=12, deliberately CPU-heavy), so an
// attacker holding a stolen session token could both brute-force the current
// password AND exhaust CPU by hammering these routes. A tight ceiling —
// 10 attempts per user per 15 minutes — is plenty for a real person changing
// their own credentials. DELIBERATELY a SEPARATE bucket from the safety-action
// and abuse-report limiters so credential-change spam can never rate-starve a
// user's ability to file a report or block a bad actor.
export const accountSecurityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many security changes. Please wait a few minutes before trying again.' },
  skipSuccessfulRequests: false,
});

// ── Safety-action limiter (report / block) ───────────────────────────────────
// SEPARATE bucket from feedback/verification so non-safety spam can never
// exhaust a user's ability to report or block a bad actor. A more generous
// ceiling than the abuse-report limiter: a user should be able to block/report
// several people in a session (e.g. a spam wave) without being throttled.
export const safetyActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many report or block actions. Please wait a few minutes before trying again.' },
  skipSuccessfulRequests: false,
});
