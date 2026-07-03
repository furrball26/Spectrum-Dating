// Security / data-isolation regression tests (BE-1..BE-5).
//
// These boot a minimal Express app wired exactly like src/index.js (optionalAuth
// -> contextMiddleware -> routers) against a throwaway on-disk SQLite DB, then
// drive it over HTTP with Node's built-in fetch. Pure-function checks
// (getCandidates, verifyPurposeToken) call into the same shared getDb().
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Must be set BEFORE importing anything that resolves getDb() / JWT_SECRET.
const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-sec-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-security-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken, signPurposeToken, verifyPurposeToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const pushRouter = (await import('../src/routes/push.js')).default;
const { getCandidates } = await import('../src/matching/candidates.js');

const db = getDb();

let server;
let baseUrl;

let uid = 0;
function makeUser({ tv = 0, suspended = 0, withProfile = true, interests = ['hiking'] } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, `${id}@t.dev`, 'x', Date.now(), tv, suspended);
  if (withProfile) {
    db.prepare(
      `INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, paused, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(id, `Name ${id}`, 'A bio here.', 'https://x/p.jpg', '1990-01-01', Date.now());
    for (const it of interests) {
      db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, it);
    }
  }
  return id;
}

function block(blockerId, blockedId) {
  db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`b${++uid}`, blockerId, blockedId, 'other', '', Date.now());
}

function match(a, b, { ended = false } = {}) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const id = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, ua, ub, Date.now(), ended ? Date.now() : null);
  return id;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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
  app.use('/matching', matchingRouter);
  app.use('/push', pushRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('BE-2: requireAuth rejects purpose-scoped tokens', () => {
  it('rejects a reset purpose token on a requireAuth route (401)', async () => {
    const id = makeUser();
    const purposeToken = signPurposeToken(id, 'reset', 0, '5m');
    const r = await api(`/profile/${id}`, { token: purposeToken });
    expect(r.status).toBe(401);
  });

  it('still accepts a normal session token on the same route', async () => {
    const id = makeUser();
    const sessionToken = signToken(id, 0);
    const r = await api(`/profile/${id}`, { token: sessionToken });
    expect(r.status).toBe(200);
  });
});

describe('BE-4: verifyPurposeToken enforces token_version / suspension', () => {
  it('rejects a purpose token whose token_version is stale', () => {
    const id = makeUser({ tv: 0 });
    const token = signPurposeToken(id, 'export', 0, '5m');
    expect(verifyPurposeToken(token, 'export')?.sub).toBe(id);
    db.prepare('UPDATE users SET token_version = 1 WHERE id = ?').run(id);
    expect(verifyPurposeToken(token, 'export')).toBeNull();
  });

  it('rejects a purpose token for a suspended user', () => {
    const id = makeUser({ tv: 0 });
    const token = signPurposeToken(id, 'export', 0, '5m');
    db.prepare('UPDATE users SET suspended = 1 WHERE id = ?').run(id);
    expect(verifyPurposeToken(token, 'export')).toBeNull();
  });
});

describe('BE-1: blocked users excluded from candidates & swipe', () => {
  it('A blocks B => B not in A candidates and A not in B candidates', () => {
    const a = makeUser();
    const b = makeUser();
    block(a, b);
    const aInterests = ['hiking'];
    const aCands = getCandidates(db, a, aInterests).map(c => c.user_id);
    const bCands = getCandidates(db, b, aInterests).map(c => c.user_id);
    expect(aCands).not.toContain(b);
    expect(bCands).not.toContain(a);
  });

  it('a mutual like across a block does not create a matches row', async () => {
    const a = makeUser();
    const b = makeUser();
    block(a, b); // A blocked B
    // B likes A first (recorded), then A likes B — normally a mutual match.
    const bLikesA = await api('/matching/swipe', {
      token: signToken(b, 0), method: 'POST', body: { candidateId: a, decision: 'like' },
    });
    expect(bLikesA.status).toBe(200);
    const aLikesB = await api('/matching/swipe', {
      token: signToken(a, 0), method: 'POST', body: { candidateId: b, decision: 'like' },
    });
    expect(aLikesB.status).toBe(200);
    expect(aLikesB.json.matched).toBe(false);
    const [ua, ub] = a < b ? [a, b] : [b, a];
    const row = db.prepare('SELECT 1 FROM matches WHERE user_a_id = ? AND user_b_id = ?').get(ua, ub);
    expect(row).toBeUndefined();
  });
});

describe('BE-3: GET /profile/:id excludes ended matches', () => {
  it('returns full profile while matched, 403 after unmatch (ended_at set)', async () => {
    const a = makeUser();
    const b = makeUser();
    const mid = match(a, b);
    const active = await api(`/profile/${b}`, { token: signToken(a, 0) });
    expect(active.status).toBe(200);
    expect(active.json).toHaveProperty('contextCard');
    // Soft-end the match (unmatch).
    db.prepare('UPDATE matches SET ended_at = ? WHERE id = ?').run(Date.now(), mid);
    const ended = await api(`/profile/${b}`, { token: signToken(a, 0) });
    expect(ended.status).toBe(403);
  });
});

describe('BE-5: POST /push/subscribe cannot hijack another user endpoint', () => {
  const endpoint = 'https://push.example/ep-shared';
  const keys = { p256dh: 'k1', auth: 'k2' };

  it('lets the owner subscribe and re-subscribe (refresh keys)', async () => {
    const a = makeUser();
    const r1 = await api('/push/subscribe', {
      token: signToken(a, 0), method: 'POST', body: { endpoint, keys },
    });
    expect(r1.status).toBe(200);
    const r2 = await api('/push/subscribe', {
      token: signToken(a, 0), method: 'POST', body: { endpoint, keys: { p256dh: 'new', auth: 'new2' } },
    });
    expect(r2.status).toBe(200);
    const row = db.prepare('SELECT user_id, p256dh FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    expect(row.user_id).toBe(a);
    expect(row.p256dh).toBe('new');
  });

  it('rejects a different user claiming the same endpoint (409) and does not reassign', async () => {
    const owner = db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint).user_id;
    const attacker = makeUser();
    const r = await api('/push/subscribe', {
      token: signToken(attacker, 0), method: 'POST', body: { endpoint, keys: { p256dh: 'evil', auth: 'evil2' } },
    });
    expect(r.status).toBe(409);
    const row = db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    expect(row.user_id).toBe(owner);
  });
});
