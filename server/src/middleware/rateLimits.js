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

// ── Telemetry beacon limiter (public, per-IP) ────────────────────────────────
// The pageview beacon is public (no auth), so it MUST key on IP, not userId.
// A generous per-IP ceiling absorbs normal multi-tab browsing while capping a
// flood. On limit we respond 204 (fire-and-forget — the beacon never surfaces
// an error to the tab) rather than a 429 with a body.
export const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 120,                  // ~2/sec per IP — well above real page-view rates
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (_req, res) => res.status(204).end(),
});

// ── Intro-request limiters (message-request / first-contact) ─────────────────
// First-contact intros to NON-matches are a fresh inbound-abuse surface, so they
// get their OWN buckets (never sharing with messaging/report/block limiters — a
// flood on one must not rate-starve the others). TWO windows enforce both a
// short-burst ceiling and a daily ceiling. Keyed per-user. The `limit` is read
// from env at request time so ops can tune (and tests can exercise) the cap
// without a redeploy; defaults are 5/hour and 15/day.
export const introRequestHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: () => Number(process.env.INTRO_MAX_PER_HOUR) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "You've sent a lot of intros in a short time. Please take a break and try again later." },
  skipSuccessfulRequests: false,
});

export const introRequestDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: () => Number(process.env.INTRO_MAX_PER_DAY) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "You've reached your intros for today. Please try again tomorrow." },
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

// ── Admin-endpoint limiter (moderation backstop) ─────────────────────────────
// The admin routers (admin.js / adminTelemetry.js / adminPopulation.js) perform
// the most destructive actions on the platform — suspend / ban / verify / purge.
// They had NO rate limit, so a compromised admin token could hammer them
// unbounded. This is its OWN bucket (never shares a window with member-facing
// limiters), keyed per-admin (userId) so one admin can't starve another. The cap
// is deliberately GENEROUS — a real moderation sweep touches many members — but a
// hard backstop against abuse/automation. `limit` is read from env at request
// time so ops can tune (and tests can exercise) the cap without a redeploy;
// default is 300 requests / 15 min. GET /admin/me is exempted at the mount (the
// dashboard polls it) so normal dashboard use is never throttled — see index.js.
export const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  limit: () => Number(process.env.ADMIN_MAX_PER_WINDOW) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many admin requests. Please wait a few minutes before trying again.' },
  // GET /admin/me is the frontend's admin-status poll — never throttle it.
  // req.path is mount-relative ('/me') because this runs at the '/admin' mount.
  skip: (req) => req.method === 'GET' && req.path === '/me',
  skipSuccessfulRequests: false,
});
