// Validation + security hardening batch (3 focused backend hardenings):
//   1. POST /messaging/report — `reason` must be one of the canonical
//      safety-reason enum values (mirrors src/safetyReasons.js), not free text.
//   2. PUT /profile/me — once a DOB is on file it can't be self-edited (age gate);
//      the FIRST-TIME set still works and re-submitting the SAME value is a no-op.
//   3. Admin routers get a per-admin rate limiter (its own bucket, keyed on the
//      admin user id); GET /admin/me is exempt so the dashboard poll never 429s.
//
// Boots a minimal app wired like src/index.js against a throwaway on-disk SQLite
// DB and drives it over HTTP, mirroring safety-batch.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-hardening-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-hardening-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev,admin2@t.dev';
// Small admin-limiter cap so the 429 backstop is exercisable in-test. Read per
// request via the limiter's `limit` function, so setting it here is enough.
process.env.ADMIN_MAX_PER_WINDOW = '5';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const { adminApiLimiter } = await import('../src/middleware/rateLimits.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const messagingRouter = (await import('../src/routes/messaging.js')).default;
const adminRouter = (await import('../src/routes/admin.js')).default;
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;
const adminPopulationRouter = (await import('../src/routes/adminPopulation.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

// Insert a user + profile. `dob` may be '' to model a not-yet-set DOB (the
// onboarding first-save case — the column is NOT NULL, so unset is the empty
// string). Admin users get an admin email so requireAdmin passes.
function makeUser({ email, dob = '1990-01-01', displayName } = {}) {
  const id = `u${++uid}`;
  const addr = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, addr, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(id, displayName || `Name ${id}`, 'A bio here.', '', dob, Date.now());
  return id;
}

function dobOf(userId) {
  return db.prepare('SELECT date_of_birth FROM profiles WHERE user_id = ?').get(userId).date_of_birth;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/profile', profileRouter);
  app.use('/messaging', messagingRouter);
  // Mirror src/index.js: the limiter is attached to the FIRST /admin mount only,
  // so it runs exactly once for every /admin/* request across all three routers.
  app.use('/admin', adminApiLimiter, adminRouter);
  app.use('/admin', adminTelemetryRouter);
  app.use('/admin', adminPopulationRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Report-reason enum enforced server-side.
// ---------------------------------------------------------------------------
describe('Hardening #1: POST /messaging/report enforces the reason enum', () => {
  it('rejects a non-enum reason with 400 (no report row created)', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'i-made-this-up' },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/reason must be one of/i);
    const row = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE reporter_id = ?').get(reporter).c;
    expect(row).toBe(0);
  });

  it('accepts a valid enum reason (201) and stores it, with free-text details intact', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', details: 'they kept messaging after I asked to stop' },
    });
    expect(r.status).toBe(201);
    expect(r.json.reported).toBe(true);
    const row = db.prepare(
      'SELECT reason, details FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    expect(row.reason).toBe('harassment');
    // `details` stays free text — only `reason` is enum-locked.
    expect(row.details).toBe('they kept messaging after I asked to stop');
  });

  it('accepts every canonical enum value (incl. the severe minor_safety / off_platform_harm)', async () => {
    // minor_safety is offered by the reporter UI and off_platform_harm is a
    // severe clause in communityStandards — both must be acceptable at the
    // endpoint, or the most serious safety report 400s and never files.
    for (const reason of ['harassment', 'inappropriate', 'spam', 'fake_profile', 'minor_safety', 'off_platform_harm', 'other']) {
      const reporter = makeUser();
      const reported = makeUser();
      const r = await api('/messaging/report', {
        token: signToken(reporter, 0), method: 'POST',
        body: { reportedUserId: reported, reason },
      });
      expect(r.status).toBe(201);
      const row = db.prepare('SELECT reason FROM reports WHERE reporter_id = ?').get(reporter);
      expect(row.reason).toBe(reason);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Age-gate lock: DOB is set-once via PUT /profile/me.
// ---------------------------------------------------------------------------
describe('Hardening #2: DOB is set-once via PUT /profile/me', () => {
  it('first-time set (no DOB yet — empty string) succeeds and persists', async () => {
    const u = makeUser({ dob: '' });
    expect(dobOf(u)).toBe('');
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { dateOfBirth: '1990-05-15' },
    });
    expect(r.status).toBe(200);
    expect(dobOf(u)).toBe('1990-05-15');
  });

  it('changing an already-set DOB is rejected with 403 and leaves it unchanged', async () => {
    const u = makeUser({ dob: '1990-01-01' });
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { dateOfBirth: '2010-01-01' },
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/already set/i);
    // Unchanged — the underage value never landed.
    expect(dobOf(u)).toBe('1990-01-01');
  });

  it('re-submitting the SAME DOB is a harmless no-op (200), and other fields still save', async () => {
    const u = makeUser({ dob: '1988-03-03' });
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { dateOfBirth: '1988-03-03', displayName: 'Sam' },
    });
    expect(r.status).toBe(200);
    expect(dobOf(u)).toBe('1988-03-03');
    expect(r.json.displayName).toBe('Sam');
  });

  it('a profile save that omits dateOfBirth entirely is unaffected', async () => {
    const u = makeUser({ dob: '1985-07-07' });
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { displayName: 'Jordan' },
    });
    expect(r.status).toBe(200);
    expect(dobOf(u)).toBe('1985-07-07');
    expect(r.json.displayName).toBe('Jordan');
  });
});

// ---------------------------------------------------------------------------
// 3. Admin-endpoint rate limiting (per-admin bucket; /admin/me exempt).
// ---------------------------------------------------------------------------
describe('Hardening #3: admin routers are rate-limited (per admin), /admin/me exempt', () => {
  it('returns 429 once a single admin exceeds the window cap on a moderation route', async () => {
    const admin = makeUser({ email: 'admin@t.dev' });
    const token = signToken(admin, 0);
    const statuses = [];
    // Cap is 5 (ADMIN_MAX_PER_WINDOW). The 6th non-exempt admin request trips it.
    for (let i = 0; i < 6; i++) {
      const r = await api('/admin/stats', { token });
      statuses.push(r.status);
    }
    // First 5 succeed (admin route), the 6th is throttled.
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('GET /admin/me is exempt — polled well past the cap, it never 429s', async () => {
    // A DISTINCT admin (own bucket). /admin/me is skipped by the limiter, so even
    // more calls than the cap all return 200.
    const admin2 = makeUser({ email: 'admin2@t.dev' });
    const token = signToken(admin2, 0);
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const r = await api('/admin/me', { token });
      statuses.push(r.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
    // And it really is reporting admin — proves the route ran, not a bounce.
    const last = await api('/admin/me', { token });
    expect(last.json.isAdmin).toBe(true);
  });
});
