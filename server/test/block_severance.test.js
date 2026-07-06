// Trust-&-safety regression: a block must SEVER an existing relationship, not
// just gate future sends. Two confirmed bugs are locked down here:
//
//   Bug 1 — blocking did not remove the conversation. After A blocks B the
//   thread must vanish from BOTH A's and B's conversation lists (and archived
//   list), and GET /conversations/:id must read as a neutral "ended" thread for
//   BOTH — never leaking that it was specifically a block.
//
//   Bug 2 — the Activity feed leaked blocked users. A blocked person (either
//   direction) must not appear in incomingLikes or recentMatches.
//
// A NORMAL (non-blocked) pair must be completely unaffected. Boots a minimal app
// wired like src/index.js against a throwaway SQLite DB (mirrors security.test.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-block-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-block-severance';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const messagingRouter = (await import('../src/routes/messaging.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const profileRouter = (await import('../src/routes/profile.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser() {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, paused, updated_at) VALUES (?,?,?,?,?,0,?)'
  ).run(id, `Name ${id}`, 'A bio here.', 'https://x/p.jpg', '1990-01-01', Date.now());
  return id;
}

// matches use canonical order (smaller id first), like /swipe.
function makeMatch(a, b, { minutesAgo = 1 } = {}) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const id = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,NULL)')
    .run(id, ua, ub, Date.now() - minutesAgo * 60 * 1000);
  return id;
}

// conversations store creator-first (user_a = creator), NOT canonical — the
// queries check both columns, so this mirrors POST /conversations exactly.
function makeConversation(matchId, creator, other, { archivedByCreator = false } = {}) {
  const id = `c${++uid}`;
  db.prepare(
    'INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at, archived_by_a, archived_by_b) VALUES (?,?,?,?,?,?,?)'
  ).run(id, matchId, creator, other, Date.now(), archivedByCreator ? 1 : 0, 0);
  return id;
}

function like(swiper, swiped) {
  db.prepare('INSERT INTO swipes (id, swiper_id, swiped_id, decision, created_at) VALUES (?,?,?,?,?)')
    .run(`s${++uid}`, swiper, swiped, 'like', Date.now());
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

const tok = (id) => signToken(id, 0);
const convIds = (payload) => (payload.conversations || []).map(c => c.id);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/messaging', messagingRouter);
  app.use('/matching', matchingRouter);
  app.use('/profile', profileRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('Bug 1: block severs an existing conversation (both directions)', () => {
  let A, B, convAB;
  let N1, N2, convN;

  beforeAll(async () => {
    // Blocked pair: matched, with a conversation. Then A blocks B.
    A = makeUser();
    B = makeUser();
    const mAB = makeMatch(A, B);
    convAB = makeConversation(mAB, A, B);

    // Normal control pair: matched + conversation, never blocked.
    N1 = makeUser();
    N2 = makeUser();
    const mN = makeMatch(N1, N2);
    convN = makeConversation(mN, N1, N2);

    // BEFORE the block, both A and B see the thread (proves the setup is real).
    const beforeA = await api('/messaging/conversations', { token: tok(A) });
    const beforeB = await api('/messaging/conversations', { token: tok(B) });
    expect(convIds(beforeA.json)).toContain(convAB);
    expect(convIds(beforeB.json)).toContain(convAB);

    // A blocks B.
    const blk = await api('/messaging/block', {
      token: tok(A), method: 'POST', body: { blockedUserId: B, reason: 'harassment' },
    });
    expect(blk.status).toBe(201);
    // The block response is silent — { blocked: true } only, no notify path is
    // invoked (the /block route never calls notifyUser). B is never told.
    expect(blk.json).toEqual({ blocked: true });
  });

  it('the conversation is ABSENT from the blocker (A) conversation list', async () => {
    const r = await api('/messaging/conversations', { token: tok(A) });
    expect(r.status).toBe(200);
    expect(convIds(r.json)).not.toContain(convAB);
  });

  it('the conversation is ABSENT from the blocked person (B) conversation list', async () => {
    const r = await api('/messaging/conversations', { token: tok(B) });
    expect(r.status).toBe(200);
    // B no longer keeps the blocker's name/photo, and the thread does not return
    // on reload — this is the server-side fix (client-only drop was the old gap).
    expect(convIds(r.json)).not.toContain(convAB);
  });

  it('the conversation is ABSENT from BOTH archived lists', async () => {
    const ra = await api('/messaging/conversations/archived', { token: tok(A) });
    const rb = await api('/messaging/conversations/archived', { token: tok(B) });
    expect(convIds(ra.json)).not.toContain(convAB);
    expect(convIds(rb.json)).not.toContain(convAB);
  });

  it('GET /conversations/:id reads as a neutral ENDED thread for the blocked person (B)', async () => {
    const r = await api(`/messaging/conversations/${convAB}`, { token: tok(B) });
    expect(r.status).toBe(200);
    // Same payload an unmatched/ended thread returns — read-only, composer hidden.
    // It never says "blocked", so B can't tell an unmatch from a block.
    expect(r.json.conversation.ended).toBe(true);
  });

  it('GET /conversations/:id reads as ENDED for the blocker (A) too', async () => {
    const r = await api(`/messaging/conversations/${convAB}`, { token: tok(A) });
    expect(r.status).toBe(200);
    expect(r.json.conversation.ended).toBe(true);
  });

  it('a NORMAL (non-blocked) pair keeps its conversation in BOTH lists, not ended', async () => {
    const r1 = await api('/messaging/conversations', { token: tok(N1) });
    const r2 = await api('/messaging/conversations', { token: tok(N2) });
    expect(convIds(r1.json)).toContain(convN);
    expect(convIds(r2.json)).toContain(convN);
    const det = await api(`/messaging/conversations/${convN}`, { token: tok(N2) });
    expect(det.json.conversation.ended).toBe(false);
  });
});

describe('Bug 2: activity feed excludes blocked users (both directions)', () => {
  let D, C;        // C liked D (incoming like to D); D then blocks C.
  let E, F;        // E and F matched recently; F then blocks E.
  let V, L, MV;    // control viewer V: L liked V (incoming), MV matched V — no blocks.

  beforeAll(async () => {
    // Incoming-like pair. C likes D, no match. D blocks C.
    D = makeUser();
    C = makeUser();
    like(C, D);
    await api('/messaging/block', { token: tok(D), method: 'POST', body: { blockedUserId: C, reason: 'harassment' } });

    // Recent-match pair. E & F matched recently. F blocks E.
    E = makeUser();
    F = makeUser();
    makeMatch(E, F, { minutesAgo: 30 });
    await api('/messaging/block', { token: tok(F), method: 'POST', body: { blockedUserId: E, reason: 'spam' } });

    // Control viewer V — an incoming like from L and a recent match with MV,
    // NO blocks anywhere. Must be fully unaffected.
    V = makeUser();
    L = makeUser();
    MV = makeUser();
    like(L, V);
    makeMatch(V, MV, { minutesAgo: 30 });
  });

  it('the blocked liker (C) does NOT appear in the blocker (D) incomingLikes', async () => {
    const r = await api('/matching/activity', { token: tok(D) });
    expect(r.status).toBe(200);
    expect(r.json.incomingLikes.map(x => x.userId)).not.toContain(C);
  });

  it('the blocker (D) does NOT appear anywhere in the blocked liker (C) activity', async () => {
    const r = await api('/matching/activity', { token: tok(C) });
    expect(r.status).toBe(200);
    expect(r.json.incomingLikes.map(x => x.userId)).not.toContain(D);
    expect(r.json.recentMatches.map(x => x.userId)).not.toContain(D);
  });

  it('a blocked recent match is gone from BOTH parties recentMatches', async () => {
    const rf = await api('/matching/activity', { token: tok(F) });
    const re = await api('/matching/activity', { token: tok(E) });
    expect(rf.json.recentMatches.map(x => x.userId)).not.toContain(E);
    expect(re.json.recentMatches.map(x => x.userId)).not.toContain(F);
  });

  it('a NORMAL viewer still sees incoming likes and recent matches', async () => {
    const r = await api('/matching/activity', { token: tok(V) });
    expect(r.status).toBe(200);
    expect(r.json.incomingLikes.map(x => x.userId)).toContain(L);
    expect(r.json.recentMatches.map(x => x.userId)).toContain(MV);
  });
});

// Bug 3: a block must sever GET /profile/:userId visibility in BOTH directions.
// Prior bug: profile visibility was gated only on a live match, and a block does
// NOT end the match row — so a blocked (or blocking) user could still fetch the
// other person's full profile (photos, audio, coarse city) straight around the
// block. The 403 is uniform (same as "not matched") so it never reveals a block.
describe('Bug 3: block severs GET /profile/:userId (both directions)', () => {
  let G, H;    // G & H matched; then G blocks H.
  let P, Q;    // control matched pair, never blocked.

  beforeAll(async () => {
    G = makeUser();
    H = makeUser();
    makeMatch(G, H);
    // Both can see each other BEFORE the block (proves the setup is real).
    const pre = await api(`/profile/${H}`, { token: tok(G) });
    expect(pre.status).toBe(200);
    await api('/messaging/block', { token: tok(G), method: 'POST', body: { blockedUserId: H, reason: 'harassment' } });

    P = makeUser();
    Q = makeUser();
    makeMatch(P, Q);
  });

  it('the blocker (G) can no longer fetch the blocked person (H) profile', async () => {
    const r = await api(`/profile/${H}`, { token: tok(G) });
    expect(r.status).toBe(403);
  });

  it('the blocked person (H) can no longer fetch the blocker (G) profile', async () => {
    const r = await api(`/profile/${G}`, { token: tok(H) });
    expect(r.status).toBe(403);
  });

  it('a NORMAL matched pair can still fetch each other', async () => {
    const rp = await api(`/profile/${Q}`, { token: tok(P) });
    const rq = await api(`/profile/${P}`, { token: tok(Q) });
    expect(rp.status).toBe(200);
    expect(rq.status).toBe(200);
  });

  it('self-fetch is always allowed, block or not', async () => {
    const r = await api(`/profile/${G}`, { token: tok(G) });
    expect(r.status).toBe(200);
  });
});
