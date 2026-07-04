// Message-request / intro — Phase 1 BACKEND safety-critical regression suite.
//
// The load-bearing guarantees under test:
//   1. Silent-failure INDISTINGUISHABILITY — every "insert nothing" branch
//      (recipient missing / suspended / blocked / already-matched / existing row)
//      returns a response BYTE-IDENTICAL to a real delivered intro.
//   2. Sender NEVER learns of a decline — GET /requests/sent returns only
//      pending + accepted; a declined request is invisible; re-send is a no-op.
//   3. ONE directed intro per pair EVER (UNIQUE + never-delete).
//   4. Accept mints+dedupes a real match via the shared path, respects the convo
//      cap, and the conversation then appears in the normal inbox.
//   5. Server-side intro screening (slur hard-400; off-platform/money refused +
//      auto-flagged); rate-limit + durable pending-cap; block/suspend/swipe wiring.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-msgreq-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-message-requests';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@spectrum-test.dev';
// Keep the in-memory velocity limiters out of the way for the functional tests;
// a dedicated block flips these low to prove the limiter actually fires.
process.env.INTRO_MAX_PER_HOUR = '1000';
process.env.INTRO_MAX_PER_DAY = '1000';

const express = (await import('express')).default;
const { createServer } = await import('http');
const Database = (await import('better-sqlite3')).default;
const { getDb, runMigrations } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const messagingRouter = (await import('../src/routes/messaging.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const messageRequestsRouter = (await import('../src/routes/messageRequests.js')).default;
const adminRouter = (await import('../src/routes/admin.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ email, suspended = 0, profile = {} } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,?)')
    .run(id, email || `${id}@t.dev`, 'x', Date.now(), suspended);
  db.prepare(
    `INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, dist_city,
       context_card, helps_me, hard_for_me, paused, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`
  ).run(
    id,
    profile.display_name || `Name ${id}`,
    profile.bio || 'A calm bio here.',
    profile.photo_url || 'https://x/p.jpg',
    '1990-01-01',
    profile.dist_city || 'Phoenix, AZ 85001',
    profile.context_card || 'POST-MATCH secret context.',
    profile.helps_me || 'quiet spaces',
    profile.hard_for_me || 'loud rooms',
    Date.now()
  );
  return id;
}

function makeMatchRow(a, b, { ended = false } = {}) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const id = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,?)')
    .run(id, ua, ub, Date.now(), ended ? Date.now() : null);
  return id;
}

function makeConversationRow(matchId, creator, other) {
  const id = `c${++uid}`;
  db.prepare(
    'INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at, archived_by_a, archived_by_b) VALUES (?,?,?,?,?,0,0)'
  ).run(id, matchId, creator, other, Date.now());
  return id;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  const raw = await res.text();
  try { json = raw ? JSON.parse(raw) : null; } catch { /* no body */ }
  return { status: res.status, json, raw };
}

const tok = (id) => signToken(id, 0);
const sendIntro = (from, to, intro) =>
  api('/messaging/requests', { token: tok(from), method: 'POST', body: { recipientId: to, intro } });
const dbStatus = (reqId) => db.prepare('SELECT status FROM message_requests WHERE id = ?').get(reqId)?.status;
const pendingRowId = (from, to) =>
  db.prepare("SELECT id FROM message_requests WHERE sender_id = ? AND recipient_id = ?").get(from, to)?.id;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/messaging', messagingRouter);
  app.use('/messaging/requests', messageRequestsRouter);
  app.use('/matching', matchingRouter);
  app.use('/admin', adminRouter);
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
describe('migration 047 boots clean ×3 (idempotent)', () => {
  it('creates message_requests + indexes and survives three runs', () => {
    const d = mkdtempSync(join(tmpdir(), 'spectrum-mig047-'));
    const mdb = new Database(join(d, 'test.db'));
    mdb.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(mdb)).not.toThrow();
      expect(() => runMigrations(mdb)).not.toThrow();
      expect(() => runMigrations(mdb)).not.toThrow();
      const t = mdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_requests'").get();
      expect(t).toBeTruthy();
      const idx = mdb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_msgreq_recipient','idx_msgreq_sender')").all();
      expect(idx.length).toBe(2);
      // UNIQUE(sender_id, recipient_id) is enforced.
      mdb.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('a', 'a@t.dev', 'x', 1);
      mdb.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('b', 'b@t.dev', 'x', 1);
      mdb.prepare("INSERT INTO message_requests (id,sender_id,recipient_id,intro,status,created_at) VALUES (?,?,?,?, 'pending',?)").run('r1', 'a', 'b', 'hi', 1);
      expect(() =>
        mdb.prepare("INSERT INTO message_requests (id,sender_id,recipient_id,intro,status,created_at) VALUES (?,?,?,?, 'pending',?)").run('r2', 'a', 'b', 'hi again', 1)
      ).toThrow(/UNIQUE/);
    } finally {
      mdb.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
describe('silent-failure indistinguishability (byte-identical to a real send)', () => {
  it('a REAL successful send returns 201 {"ok":true}', async () => {
    const s = makeUser();
    const r = makeUser();
    const res = await sendIntro(s, r, 'Hi, I liked your profile — no rush to reply.');
    expect(res.status).toBe(201);
    expect(res.raw).toBe('{"ok":true}');
    // ...and it actually inserted a pending row.
    expect(dbStatus(pendingRowId(s, r))).toBe('pending');
  });

  it('recipient MISSING → byte-identical, inserts nothing', async () => {
    const s = makeUser();
    const res = await sendIntro(s, 'does-not-exist', 'Hello there.');
    expect(res.status).toBe(201);
    expect(res.raw).toBe('{"ok":true}');
    expect(pendingRowId(s, 'does-not-exist')).toBeUndefined();
  });

  it('recipient SUSPENDED → byte-identical, inserts nothing', async () => {
    const s = makeUser();
    const r = makeUser({ suspended: 1 });
    const res = await sendIntro(s, r, 'Hello there.');
    expect(res.status).toBe(201);
    expect(res.raw).toBe('{"ok":true}');
    expect(pendingRowId(s, r)).toBeUndefined();
  });

  it('BLOCKED pair (either direction) → BYTE-IDENTICAL, inserts nothing (anti-probe)', async () => {
    // Recipient blocked the prober.
    const prober = makeUser();
    const target = makeUser();
    await api('/messaging/block', { token: tok(target), method: 'POST', body: { blockedUserId: prober, reason: 'harassment' } });
    const blockedRes = await sendIntro(prober, target, 'Hi, I liked your profile — no rush to reply.');

    // A genuine send by an unrelated pair, same intro text.
    const s = makeUser();
    const r = makeUser();
    const realRes = await sendIntro(s, r, 'Hi, I liked your profile — no rush to reply.');

    // The blocked prober's CLEAN send must be BYTE-for-BYTE the real one.
    expect(blockedRes.status).toBe(realRes.status);
    expect(blockedRes.raw).toBe(realRes.raw);
    expect(blockedRes.raw).toBe('{"ok":true}');
    // ...and nothing was inserted for the blocked pair.
    expect(pendingRowId(prober, target)).toBeUndefined();
  });

  it('content-probe CLOSED: a BAD intro is BYTE-IDENTICAL across block state (screening runs first)', async () => {
    // Screening runs BEFORE the target-dependent guards, so the CONTENT of a
    // message can never reveal block status. A prober who sends a slur/link to a
    // pair that BLOCKED them gets the SAME 400 as anyone sending bad content to a
    // normal pair — 'bad content' is indistinguishable across block state.
    const SLUR = 'hey you retard, wanna chat';
    const LINK = 'hi! add me on whatsapp';

    // Blocked pair — recipient blocked the prober.
    const prober = makeUser();
    const target = makeUser();
    await api('/messaging/block', { token: tok(target), method: 'POST', body: { blockedUserId: prober, reason: 'harassment' } });

    // Normal (un-blocked) pair.
    const s = makeUser();
    const r = makeUser();

    // SLUR: blocked-pair response must equal the normal-pair response, byte-for-byte.
    const blockedSlur = await sendIntro(prober, target, SLUR);
    const normalSlur = await sendIntro(s, r, SLUR);
    expect(blockedSlur.status).toBe(400);
    expect(blockedSlur.status).toBe(normalSlur.status);
    expect(blockedSlur.raw).toBe(normalSlur.raw);

    // LINK (off-platform): same — 400, byte-identical across block state.
    const blockedLink = await sendIntro(prober, target, LINK);
    const normalLink = await sendIntro(s, makeUser(), LINK);
    expect(blockedLink.status).toBe(400);
    expect(blockedLink.status).toBe(normalLink.status);
    expect(blockedLink.raw).toBe(normalLink.raw);

    // And a CLEAN intro from the blocked prober STILL returns the identical 201
    // SEND_OK as a real send (the clean-path indistinguishability is preserved).
    const blockedClean = await sendIntro(prober, target, 'Hello, would you like to chat sometime?');
    const realClean = await sendIntro(makeUser(), makeUser(), 'Hello, would you like to chat sometime?');
    expect(blockedClean.status).toBe(201);
    expect(blockedClean.raw).toBe(realClean.raw);
    expect(blockedClean.raw).toBe('{"ok":true}');

    // Nothing was ever inserted for the blocked pair, across all probes.
    expect(pendingRowId(prober, target)).toBeUndefined();
  });

  it('ALREADY MATCHED (incl. ended) → byte-identical, inserts nothing', async () => {
    const a = makeUser();
    const b = makeUser();
    makeMatchRow(a, b);
    const res = await sendIntro(a, b, 'Hello there.');
    expect(res.status).toBe(201);
    expect(res.raw).toBe('{"ok":true}');
    expect(pendingRowId(a, b)).toBeUndefined();

    // An ENDED match still blocks a re-contact intro.
    const c = makeUser();
    const d = makeUser();
    makeMatchRow(c, d, { ended: true });
    const res2 = await sendIntro(c, d, 'Hello there.');
    expect(res2.raw).toBe('{"ok":true}');
    expect(pendingRowId(c, d)).toBeUndefined();
  });

  it('DECLINED sender re-send is an UNDETECTABLE no-op (existing row, any status)', async () => {
    const s = makeUser();
    const r = makeUser();
    const first = await sendIntro(s, r, 'First intro attempt.');
    expect(first.raw).toBe('{"ok":true}');
    const reqId = pendingRowId(s, r);
    // Recipient declines.
    const dec = await api(`/messaging/requests/${reqId}/decline`, { token: tok(r), method: 'POST' });
    expect(dec.status).toBe(200);
    expect(dbStatus(reqId)).toBe('declined');
    // Sender re-sends — must look EXACTLY like a real send, but change nothing.
    const resend = await sendIntro(s, r, 'Trying again, please?');
    expect(resend.status).toBe(201);
    expect(resend.raw).toBe('{"ok":true}');
    // The row is untouched: still declined, still the original text, no new row.
    const rows = db.prepare('SELECT intro, status FROM message_requests WHERE sender_id = ? AND recipient_id = ?').all(s, r);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('declined');
    expect(rows[0].intro).toBe('First intro attempt.');
  });
});

// ---------------------------------------------------------------------------
describe('sender contract — GET /requests/sent NEVER exposes a decline', () => {
  it('shows pending + accepted, but a declined request is invisible', async () => {
    const s = makeUser();
    const rPending = makeUser();
    const rDeclined = makeUser();
    const rAccepted = makeUser();

    await sendIntro(s, rPending, 'Pending intro.');
    await sendIntro(s, rDeclined, 'Declined intro.');
    await sendIntro(s, rAccepted, 'Accepted intro.');

    const declinedId = pendingRowId(s, rDeclined);
    await api(`/messaging/requests/${declinedId}/decline`, { token: tok(rDeclined), method: 'POST' });
    const acceptedId = pendingRowId(s, rAccepted);
    await api(`/messaging/requests/${acceptedId}/accept`, { token: tok(rAccepted), method: 'POST' });

    const sent = await api('/messaging/requests/sent', { token: tok(s) });
    expect(sent.status).toBe(200);
    const byRecipient = Object.fromEntries(sent.json.requests.map((x) => [x.recipient.userId, x]));
    expect(byRecipient[rPending]?.status).toBe('pending');
    expect(byRecipient[rAccepted]?.status).toBe('accepted');
    expect(byRecipient[rAccepted]?.conversationId).toBeTruthy();
    // The DECLINED one is entirely absent.
    expect(byRecipient[rDeclined]).toBeUndefined();
    // No decided/seen/read field is EVER serialized.
    for (const req of sent.json.requests) {
      expect(req).not.toHaveProperty('decidedAt');
      expect(req).not.toHaveProperty('decided_at');
      expect(req).not.toHaveProperty('seen');
      expect(req).not.toHaveProperty('read');
    }
  });
});

// ---------------------------------------------------------------------------
describe('recipient inbox — Discover-level projection ONLY', () => {
  it('GET /requests shows sender coarse city but NEVER context_card/helps_me/hard_for_me', async () => {
    const s = makeUser({ profile: { dist_city: 'Tucson, AZ 85701', context_card: 'SECRET', helps_me: 'SECRET-H', hard_for_me: 'SECRET-X' } });
    const r = makeUser();
    await sendIntro(s, r, 'Hello, would you like to chat?');

    const inbox = await api('/messaging/requests', { token: tok(r) });
    expect(inbox.status).toBe(200);
    const card = inbox.json.requests.find((x) => x.sender.userId === s);
    expect(card).toBeTruthy();
    expect(card.intro).toBe('Hello, would you like to chat?');
    // Coarse city (ZIP stripped) present.
    expect(card.sender.distCity).toBe('Tucson, AZ');
    // Post-match disclosures MUST NOT be present.
    expect(card.sender).not.toHaveProperty('contextCard');
    expect(card.sender).not.toHaveProperty('helpsMe');
    expect(card.sender).not.toHaveProperty('hardForMe');
    // Raw serialization contains none of the secret strings either.
    expect(inbox.raw).not.toContain('SECRET');
  });
});

// ---------------------------------------------------------------------------
describe('server-side intro screening', () => {
  it('a slur intro → hard 400, nothing inserted', async () => {
    const s = makeUser();
    const r = makeUser();
    const res = await sendIntro(s, r, 'hey you retard, wanna chat');
    expect(res.status).toBe(400);
    expect(pendingRowId(s, r)).toBeUndefined();
  });

  it('an off-platform/money intro → refused 400 + auto-flagged to mods, nothing inserted', async () => {
    const s = makeUser();
    const r = makeUser();
    const res = await sendIntro(s, r, 'hi! add me on whatsapp and send a steam card');
    expect(res.status).toBe(400);
    expect(pendingRowId(s, r)).toBeUndefined();
    // Auto-flag landed in the mod trail, invisible to the sender.
    const flag = db.prepare(
      "SELECT id FROM moderation_log WHERE actor_id = ? AND action = 'intro_safety_signal' AND target_id = ?"
    ).get(s, r);
    expect(flag).toBeTruthy();
  });

  it('length bounds: empty/blank and >300 chars → 400', async () => {
    const s = makeUser();
    const r = makeUser();
    expect((await sendIntro(s, r, '   ')).status).toBe(400);
    expect((await sendIntro(s, makeUser(), 'x'.repeat(301))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('durable pending-cap (≤10) + velocity rate-limit', () => {
  it('an 11th pending outbound intro → 422 PENDING_CAP', async () => {
    const s = makeUser();
    for (let i = 0; i < 10; i++) {
      const r = makeUser();
      const res = await sendIntro(s, r, `Intro number ${i}, hello.`);
      expect(res.status).toBe(201);
    }
    const overflow = await sendIntro(s, makeUser(), 'One too many.');
    expect(overflow.status).toBe(422);
    expect(overflow.json.code).toBe('PENDING_CAP');
    expect(db.prepare("SELECT COUNT(*) c FROM message_requests WHERE sender_id = ? AND status='pending'").get(s).c).toBe(10);
  });

  it('the hourly velocity limiter fires (own bucket)', async () => {
    process.env.INTRO_MAX_PER_HOUR = '3';
    try {
      const s = makeUser();
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await sendIntro(s, makeUser(), `Rate test ${i}.`)).status);
      }
      // First 3 pass, the 4th is throttled (429).
      expect(statuses.slice(0, 3)).toEqual([201, 201, 201]);
      expect(statuses[3]).toBe(429);
    } finally {
      process.env.INTRO_MAX_PER_HOUR = '1000';
    }
  });
});

// ---------------------------------------------------------------------------
describe('accept mints + dedupes a real match, respects cap, appears in inbox', () => {
  it('accept creates a match + conversation that shows in BOTH normal inboxes', async () => {
    const s = makeUser();
    const r = makeUser();
    await sendIntro(s, r, 'Hi — would you like to talk?');
    const reqId = pendingRowId(s, r);

    const acc = await api(`/messaging/requests/${reqId}/accept`, { token: tok(r), method: 'POST' });
    expect(acc.status).toBe(201);
    const convId = acc.json.conversationId;
    expect(convId).toBeTruthy();
    expect(dbStatus(reqId)).toBe('accepted');

    // Exactly one canonical match row exists.
    const [ua, ub] = s < r ? [s, r] : [r, s];
    const matches = db.prepare('SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?').all(ua, ub);
    expect(matches.length).toBe(1);

    // The conversation is in the normal inbox for BOTH people.
    const rInbox = await api('/messaging/conversations', { token: tok(r) });
    const sInbox = await api('/messaging/conversations', { token: tok(s) });
    expect(rInbox.json.conversations.map((c) => c.id)).toContain(convId);
    expect(sInbox.json.conversations.map((c) => c.id)).toContain(convId);

    // The intro was seeded as the sender's first message.
    const thread = await api(`/messaging/conversations/${convId}`, { token: tok(r) });
    expect(thread.json.messages.some((m) => m.senderId === s && m.body === 'Hi — would you like to talk?')).toBe(true);
  });

  it('swipe-races-accept can NOT duplicate the match (accept dedupes on the existing row)', async () => {
    const s = makeUser();
    const r = makeUser();
    await sendIntro(s, r, 'Intro before the race.');
    const reqId = pendingRowId(s, r);
    // Simulate the race: a match row already exists (a swipe won) WHILE the intro
    // is still pending. Accept must reuse it, not insert a second matches row.
    makeMatchRow(s, r);
    const acc = await api(`/messaging/requests/${reqId}/accept`, { token: tok(r), method: 'POST' });
    expect(acc.status).toBe(201);
    const [ua, ub] = s < r ? [s, r] : [r, s];
    const matches = db.prepare('SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?').all(ua, ub);
    expect(matches.length).toBe(1); // deduped — no duplicate
  });

  it('accept respects the recipient active-conversation cap (5) → 422, stays pending', async () => {
    const r = makeUser();
    // Fill R to the cap with 5 real matches + conversations.
    for (let i = 0; i < 5; i++) {
      const other = makeUser();
      const m = makeMatchRow(r, other);
      makeConversationRow(m, r, other);
    }
    const s = makeUser();
    await sendIntro(s, r, 'Would love to chat when you have space.');
    const reqId = pendingRowId(s, r);
    const acc = await api(`/messaging/requests/${reqId}/accept`, { token: tok(r), method: 'POST' });
    expect(acc.status).toBe(422);
    expect(acc.json.code).toBe('CAP_REACHED');
    expect(dbStatus(reqId)).toBe('pending'); // untouched
  });

  it('accept re-checks block → silently declines, mints nothing (defense-in-depth)', async () => {
    // Normally /block already nukes the pending intro (see block-nuke test), so
    // this guard is defense-in-depth for a block that reached the DB by another
    // path while the request was still pending. Insert the block row DIRECTLY to
    // exercise exactly that: a pending intro + an active block.
    const s = makeUser();
    const r = makeUser();
    await sendIntro(s, r, 'Hi there!');
    const reqId = pendingRowId(s, r);
    db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?,?,?,?,?)')
      .run(`blk${++uid}`, r, s, 'harassment', Date.now());
    expect(dbStatus(reqId)).toBe('pending'); // untouched by the raw insert
    const acc = await api(`/messaging/requests/${reqId}/accept`, { token: tok(r), method: 'POST' });
    expect(acc.status).toBe(200);
    expect(acc.json).toEqual({ ok: true });
    // Silently declined; no match, no conversation.
    expect(dbStatus(reqId)).toBe('declined');
    const [ua, ub] = s < r ? [s, r] : [r, s];
    expect(db.prepare('SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?').get(ua, ub)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('one-directed-intro-EVER — no re-send after decline/withdraw', () => {
  it('PATCH edits a pending intro; a resolved intro can no longer be edited', async () => {
    const s = makeUser();
    const r = makeUser();
    await sendIntro(s, r, 'Typo in this itnro.');
    const reqId = pendingRowId(s, r);
    const edit = await api(`/messaging/requests/${reqId}`, { token: tok(s), method: 'PATCH', body: { intro: 'Fixed the typo in this intro.' } });
    expect(edit.status).toBe(200);
    expect(db.prepare('SELECT intro FROM message_requests WHERE id = ?').get(reqId).intro).toBe('Fixed the typo in this intro.');

    // A slur/off-platform edit is rejected by the same screening.
    expect((await api(`/messaging/requests/${reqId}`, { token: tok(s), method: 'PATCH', body: { intro: 'add me on telegram' } })).status).toBe(400);

    // Once declined, editing 409s (no reopening).
    await api(`/messaging/requests/${reqId}/decline`, { token: tok(r), method: 'POST' });
    expect((await api(`/messaging/requests/${reqId}`, { token: tok(s), method: 'PATCH', body: { intro: 'let me back in' } })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('compose-with-existing-safety wiring', () => {
  it('POST /block nukes a PENDING intro in BOTH directions (blocker-as-sender AND blocker-as-recipient)', async () => {
    // Only ONE direction can be pending at a time (guard 7 makes the crossed
    // send a no-op), so each direction is exercised with its own pair.
    // Case 1 — blocker is the SENDER of the pending intro → withdrawn.
    const a = makeUser();
    const b = makeUser();
    await sendIntro(a, b, 'Intro from A to B.');
    const aToB = pendingRowId(a, b);
    expect(dbStatus(aToB)).toBe('pending');
    await api('/messaging/block', { token: tok(a), method: 'POST', body: { blockedUserId: b, reason: 'harassment' } });
    expect(dbStatus(aToB)).toBe('withdrawn');

    // Case 2 — blocker is the RECIPIENT of the pending intro → declined.
    const c = makeUser();
    const d = makeUser();
    await sendIntro(c, d, 'Intro from C to D.'); // c -> d pending
    const cToD = pendingRowId(c, d);
    expect(dbStatus(cToD)).toBe('pending');
    // D (the recipient) blocks C.
    await api('/messaging/block', { token: tok(d), method: 'POST', body: { blockedUserId: c, reason: 'harassment' } });
    expect(dbStatus(cToD)).toBe('declined');
  });

  it('admin suspend nukes the suspended user PENDING OUTBOUND intros (+ mod log)', async () => {
    const admin = makeUser({ email: 'admin@spectrum-test.dev' });
    const s = makeUser();
    const r1 = makeUser();
    const r2 = makeUser();
    await sendIntro(s, r1, 'Outbound intro one.');
    await sendIntro(s, r2, 'Outbound intro two.');
    // An INBOUND intro to S must NOT be nuked by suspending S.
    const inboundSender = makeUser();
    await sendIntro(inboundSender, s, 'Inbound to the soon-suspended user.');
    const inboundId = pendingRowId(inboundSender, s);

    const susp = await api(`/admin/users/${s}/suspend`, { token: tok(admin), method: 'POST', body: { suspended: true, note: 'abuse' } });
    expect(susp.status).toBe(200);

    expect(dbStatus(pendingRowId(s, r1))).toBe('withdrawn');
    expect(dbStatus(pendingRowId(s, r2))).toBe('withdrawn');
    expect(dbStatus(inboundId)).toBe('pending'); // inbound untouched
    const log = db.prepare("SELECT id FROM moderation_log WHERE action = 'nuke_intros' AND target_id = ?").get(s);
    expect(log).toBeTruthy();
  });

  it('a mutual /swipe while an intro is pending resolves (withdraws) the stale intro', async () => {
    const a = makeUser();
    const b = makeUser();
    await sendIntro(a, b, 'Intro before we both swiped.');
    const reqId = pendingRowId(a, b);
    // Mutual like via the real swipe path.
    await api('/matching/swipe', { token: tok(b), method: 'POST', body: { candidateId: a, decision: 'like' } });
    const swipe = await api('/matching/swipe', { token: tok(a), method: 'POST', body: { candidateId: b, decision: 'like' } });
    expect(swipe.json.matched).toBe(true);
    // The stale pending intro was withdrawn (not left orphaned).
    expect(dbStatus(reqId)).toBe('withdrawn');
  });

  it('POST /report with requestId snapshots the intro into reports.reported_message', async () => {
    const s = makeUser();
    const r = makeUser();
    await sendIntro(s, r, 'This intro will be reported by the recipient.');
    const reqId = pendingRowId(s, r);
    const rep = await api('/messaging/report', { token: tok(r), method: 'POST', body: { reportedUserId: s, reason: 'harassment', requestId: reqId } });
    expect(rep.status).toBe(201);
    const row = db.prepare('SELECT reported_message FROM reports WHERE reporter_id = ? AND reported_id = ?').get(r, s);
    expect(row.reported_message).toBe('This intro will be reported by the recipient.');
    // Report does NOT decide the request.
    expect(dbStatus(reqId)).toBe('pending');
  });
});
