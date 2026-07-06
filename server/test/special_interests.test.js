// D-17 Phase 1 — structured special_interests (DISPLAY + SOFT-SCORE ONLY).
//
// Boots a minimal app wired like src/index.js against a throwaway on-disk SQLite
// DB and drives it over HTTP (mirrors identity_wave_b2.test.js). Matching
// assertions call getCandidates() directly against the same shared DB.
//
// THE LOAD-BEARING CHECKS:
//  - special_interests round-trips on the profile payload (display) and adds
//    soft-score weight, BUT
//  - the SET of candidate userIds is IDENTICAL whether or not special_interests
//    is populated (only score/order may differ), and
//  - a shared special interest can NEVER rescue someone the gender/seeking/age/
//    location filter excludes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-special-interests-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-special-interests-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const { getCandidates } = await import('../src/matching/candidates.js');

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ interests = ['hiking'], dob = '1990-01-01' } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, paused, updated_at) VALUES (?,?,?,?,?,0,?)'
  ).run(id, `Name ${id}`, 'A bio here.', 'https://x/p.jpg', dob, Date.now());
  for (const it of interests) db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, it);
  return id;
}

function makeConversation(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const matchId = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at) VALUES (?,?,?,?)')
    .run(matchId, ua, ub, Date.now());
  return matchId;
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

async function setProfile(id, fields) {
  return api('/profile/me', { token: signToken(id, 0), method: 'PUT', body: fields });
}

function candidateIdSet(viewerId) {
  return new Set(getCandidates(db, viewerId, ['hiking']).map((c) => c.user_id));
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/profile', profileRouter);
  app.use('/matching', matchingRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('D-17: special_interests round-trips (display)', () => {
  it('saves + reads back the list on PUT /me and GET /me', async () => {
    const u = makeUser();
    const put = await setProfile(u, { specialInterests: ['Trains', 'Astronomy'] });
    expect(put.status).toBe(200);
    expect(put.json.specialInterests).toEqual(['Trains', 'Astronomy']);
    const get = await api('/profile/me', { token: signToken(u, 0) });
    expect(get.json.specialInterests).toEqual(['Trains', 'Astronomy']);
  });

  it('an empty list clears back to [] (unset === empty)', async () => {
    const u = makeUser();
    await setProfile(u, { specialInterests: ['Fossils'] });
    const cleared = await setProfile(u, { specialInterests: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.json.specialInterests).toEqual([]);
  });

  it('surfaces on a matched public profile (display)', async () => {
    const viewer = makeUser();
    const subject = makeUser();
    await setProfile(subject, { specialInterests: ['Marine biology'] });
    makeConversation(viewer, subject);
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    expect(r.json.specialInterests).toEqual(['Marine biology']);
  });
});

describe('D-17: special_interests caps + safety validation', () => {
  it('rejects more than 3 items', async () => {
    const u = makeUser();
    const r = await setProfile(u, { specialInterests: ['a', 'b', 'c', 'd'] });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/specialInterests can have at most 3 items/i);
  });

  it('rejects an item longer than 40 characters', async () => {
    const u = makeUser();
    const r = await setProfile(u, { specialInterests: ['x'.repeat(41)] });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/specialInterests item must be 40 characters or fewer/i);
  });

  it('slur-screens each item', async () => {
    const u = makeUser();
    // containsSlur flags unambiguous slurs; reuse the same token the name screen blocks.
    const r = await setProfile(u, { specialInterests: ['fag'] });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/offensive language/i);
  });
});

describe('D-17 SAFETY: special_interests is soft-score only, NEVER a filter', () => {
  it('candidate id-SET is IDENTICAL whether or not special_interests is populated', async () => {
    const viewer = makeUser();
    const a = makeUser();
    const b = makeUser();
    const c = makeUser();

    // Baseline — nobody has special interests yet.
    const before = candidateIdSet(viewer);
    expect(before.has(a)).toBe(true);
    expect(before.has(b)).toBe(true);
    expect(before.has(c)).toBe(true);

    // Populate: viewer + `a` share (case-insensitive), `c` has ZERO overlap, `b` unset.
    await setProfile(viewer, { specialInterests: ['Trains', 'Astronomy'] });
    await setProfile(a, { specialInterests: ['trains'] });
    await setProfile(c, { specialInterests: ['Knitting'] });

    const after = candidateIdSet(viewer);

    // The SET of candidate ids is byte-identical — only score/order may have moved.
    // (No user was added or removed between the two calls.)
    expect(after).toEqual(before);
    // Explicitly: the zero-overlap person is STILL in the deck.
    expect(after.has(c)).toBe(true);
  });

  it('a shared special interest CANNOT rescue a filter-excluded person', async () => {
    const viewer = makeUser();
    await setProfile(viewer, { gender: 'woman', seeking: 'woman', specialInterests: ['Trains'] });

    // gender_group 'man' — the viewer seeks only 'woman', so the mutual gender
    // filter drops this person regardless of any shared special interest.
    const excluded = makeUser();
    await setProfile(excluded, { gender: 'man', seeking: 'woman', specialInterests: ['Trains'] });

    // They share a special interest, but the gender filter excludes them — score
    // can never override an eligibility exclusion.
    expect(candidateIdSet(viewer).has(excluded)).toBe(false);
  });
});

describe('D-17: special_interests adds soft-score weight (reorders, never excludes)', () => {
  it('a candidate who shares a special interest outranks one who does not', async () => {
    const viewer = makeUser();
    await setProfile(viewer, { specialInterests: ['Trains'] });

    const sharer = makeUser();
    await setProfile(sharer, { specialInterests: ['trains'] }); // +3 (case-insensitive)

    const nonSharer = makeUser();
    await setProfile(nonSharer, { specialInterests: ['Gardening'] }); // +0, still present

    const scored = getCandidates(db, viewer, ['hiking']);
    const sharerRow = scored.find((c) => c.user_id === sharer);
    const nonSharerRow = scored.find((c) => c.user_id === nonSharer);
    expect(sharerRow).toBeTruthy();
    expect(nonSharerRow).toBeTruthy(); // zero overlap is NOT dropped
    expect(sharerRow.score).toBeGreaterThan(nonSharerRow.score);
    expect(sharerRow.whyReasons).toContain('You could both talk for hours about trains');
  });
});

// Moderation effectiveness: suspend/ban lives on users (users.suspended /
// users.banned) and does NOT pause the profile, so before this fix a
// suspended/banned member — who can't even log in — still surfaced as a live,
// swipeable candidate to everyone. A ban must remove them from Discover.
describe('deck excludes suspended and banned members', () => {
  it('a normal candidate is present; suspended and banned ones are not', () => {
    const viewer = makeUser();
    const normal = makeUser();
    const suspended = makeUser();
    const banned = makeUser();
    db.prepare('UPDATE users SET suspended = 1 WHERE id = ?').run(suspended);
    db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(banned);

    const deck = candidateIdSet(viewer);
    expect(deck.has(normal)).toBe(true);
    expect(deck.has(suspended)).toBe(false);
    expect(deck.has(banned)).toBe(false);
  });
});
