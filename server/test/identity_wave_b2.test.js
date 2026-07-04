// DIFFERENTIATION Wave B-2 — D-14 (relationship structure, DISPLAY ONLY) and
// D-15 (pronouns carried on the messaging serializers).
//
// Boots a minimal app wired like src/index.js against a throwaway on-disk SQLite
// DB and drives it over HTTP (mirrors gender.test.js). Matching assertions call
// getCandidates() directly against the same shared DB.
//
// THE LOAD-BEARING CHECK: relationship_structure is validated + round-trips on
// the profile payloads but is NEVER read by matching — setting it cannot change
// who appears in anyone's deck (exactly like orientation).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-waveb2-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-waveb2-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const messagingRouter = (await import('../src/routes/messaging.js')).default;
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

// Create a match + conversation between two users (canonical a<b order) and
// return the conversation id.
function makeConversation(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const matchId = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at) VALUES (?,?,?,?)')
    .run(matchId, ua, ub, Date.now());
  const convId = `c${++uid}`;
  db.prepare('INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at) VALUES (?,?,?,?,?)')
    .run(convId, matchId, ua, ub, Date.now());
  return convId;
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

function candidateIds(viewerId) {
  return getCandidates(db, viewerId, ['hiking']).map((c) => c.user_id);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/profile', profileRouter);
  app.use('/matching', matchingRouter);
  app.use('/messaging', messagingRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('D-14: relationship_structure round-trips (display only)', () => {
  it('saves + reads back a valid relationship structure on GET /me and PUT /me', async () => {
    const u = makeUser();
    const put = await setProfile(u, { relationshipStructure: 'polyamorous' });
    expect(put.status).toBe(200);
    expect(put.json.relationshipStructure).toBe('polyamorous');
    const get = await api('/profile/me', { token: signToken(u, 0) });
    expect(get.json.relationshipStructure).toBe('polyamorous');
  });

  it('coexists with (and is separate from) relationship_goal', async () => {
    const u = makeUser();
    const put = await setProfile(u, { relationshipGoal: 'long-term', relationshipStructure: 'monogamous' });
    expect(put.status).toBe(200);
    expect(put.json.relationshipGoal).toBe('long-term');
    expect(put.json.relationshipStructure).toBe('monogamous');
  });

  it('accepts every allowed enum value and empty (unset)', async () => {
    for (const v of ['', 'monogamous', 'open', 'polyamorous', 'queerplatonic', 'figuring-it-out']) {
      const u = makeUser();
      const put = await setProfile(u, { relationshipStructure: v });
      expect(put.status).toBe(200);
      expect(put.json.relationshipStructure).toBe(v);
    }
  });

  it('rejects a relationship structure outside the enum', async () => {
    const u = makeUser();
    const r = await setProfile(u, { relationshipStructure: 'situationship' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/relationshipStructure must be one of/i);
  });

  it('surfaces on a matched public profile (display), never leaking gender_group', async () => {
    const viewer = makeUser();
    const subject = makeUser();
    await setProfile(subject, { gender: 'woman', relationshipStructure: 'queerplatonic' });
    makeConversation(viewer, subject); // also creates the match that gates the profile
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    expect(r.json.relationshipStructure).toBe('queerplatonic');
    expect(r.json.genderGroup).toBeUndefined();
  });
});

describe('D-14: relationship_structure does NOT affect candidates', () => {
  it('two people with opposite structures still match on gender_group alone', async () => {
    const viewer = makeUser();
    await setProfile(viewer, { gender: 'man', seeking: 'woman', relationshipStructure: 'monogamous' });
    const subject = makeUser();
    await setProfile(subject, { gender: 'woman', seeking: '', relationshipStructure: 'polyamorous' });
    // Opposite relationship structures, but gender_group is compatible → shown.
    expect(candidateIds(viewer)).toContain(subject);
  });

  it('setting a structure never removes a candidate who would otherwise appear', async () => {
    const viewer = makeUser();
    await setProfile(viewer, { gender: 'woman', seeking: 'man' });
    const subject = makeUser();
    await setProfile(subject, { gender: 'man', seeking: '' });
    const before = candidateIds(viewer);
    expect(before).toContain(subject);
    await setProfile(subject, { relationshipStructure: 'open' });
    const after = candidateIds(viewer);
    expect(after).toContain(subject); // unchanged — structure is display-only
  });
});

describe('D-15: pronouns are carried on the messaging serializers', () => {
  it('includes otherUser.pronouns on the conversation list AND detail', async () => {
    const me = makeUser();
    const them = makeUser();
    await setProfile(them, { pronouns: 'they/them' });
    const convId = makeConversation(me, them);

    const list = await api('/messaging/conversations', { token: signToken(me, 0) });
    expect(list.status).toBe(200);
    const row = list.json.conversations.find((c) => c.id === convId);
    expect(row).toBeTruthy();
    expect(row.otherUser.pronouns).toBe('they/them');

    const detail = await api(`/messaging/conversations/${convId}`, { token: signToken(me, 0) });
    expect(detail.status).toBe(200);
    expect(detail.json.conversation.otherUser.pronouns).toBe('they/them');
  });

  it('includes otherUser.pronouns on the matches list', async () => {
    const me = makeUser();
    const them = makeUser();
    await setProfile(them, { pronouns: 'she/her' });
    makeConversation(me, them);
    const r = await api('/matching/matches', { token: signToken(me, 0) });
    expect(r.status).toBe(200);
    const match = r.json.matches.find((m) => m.otherUser.userId === them);
    expect(match).toBeTruthy();
    expect(match.otherUser.pronouns).toBe('she/her');
  });
});
