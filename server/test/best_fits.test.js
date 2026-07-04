// "Your best fits" — the first Companion-gated feature (audit/MONETIZATION_STRATEGY
// §5 #4). Boots a minimal app wired like src/index.js (optionalAuth + context +
// the matching router) over a throwaway on-disk DB, mirroring special_interests
// and billing test setup.
//
// THE LOAD-BEARING CHECKS:
//  - GET /matching/best-fits is requirePaid-gated: a free/non-Companion caller
//    gets 402 { error:'upgrade_required', upgrade:true }; an active Companion
//    gets the list.
//  - Returns up to 5 top-scored candidates in the SAME per-card shape /candidates
//    uses (memberId, displayName, whyReasons, distCity coarse, etc.).
//  - The post-match-gated contextCard is NEVER present on a best-fits card.
//  - Excludes people the viewer has already swiped on and blocked pairs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-best-fits-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-best-fits-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const matchingRouter = (await import('../src/routes/matching.js')).default;
const { setEntitlement } = await import('../src/billing/entitlements.js');

const db = getDb();

let server;
let baseUrl;
let uid = 0;

// A candidate the viewer can see: complete profile (name/bio/photo), unpaused,
// has an interest, valid 18+ DOB, and a context_card set so we can prove it is
// never leaked pre-match.
function makeUser({ interests = ['hiking'], dob = '1990-01-01', contextCard = 'How to talk to me: be direct.' } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, context_card, paused, updated_at) VALUES (?,?,?,?,?,?,0,?)'
  ).run(id, `Name ${id}`, 'A bio here.', 'https://x/p.jpg', dob, contextCard, Date.now());
  for (const it of interests) db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, it);
  return id;
}

function grantCompanion(id) {
  setEntitlement(db, id, { tier: 'companion', status: 'active', source: 'admin_demo' });
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

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
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

// ---------------------------------------------------------------------------
describe('GET /matching/best-fits — Companion gate', () => {
  it('401 when unauthenticated', async () => {
    const { status } = await api('/matching/best-fits');
    expect(status).toBe(401);
  });

  it('402 upgrade_required for a free (non-Companion) caller', async () => {
    const viewer = makeUser({ interests: ['hiking'] });
    // Some candidates exist, but a free caller never reaches the list.
    makeUser({ interests: ['hiking'] });
    const { status, json } = await api('/matching/best-fits', { token: tok(viewer) });
    expect(status).toBe(402);
    expect(json).toEqual({ error: 'upgrade_required', upgrade: true });
  });

  it('a Companion caller gets up to 5 top-scored candidates in the card shape', async () => {
    const viewer = makeUser({ interests: ['hiking'] });
    grantCompanion(viewer);
    // Seed 7 shared-interest candidates → the list must clamp to 5.
    for (let i = 0; i < 7; i++) makeUser({ interests: ['hiking'] });

    const { status, json } = await api('/matching/best-fits', { token: tok(viewer) });
    expect(status).toBe(200);
    expect(Array.isArray(json.bestFits)).toBe(true);
    expect(json.bestFits.length).toBe(5);

    const card = json.bestFits[0];
    // Same per-card shape /candidates maps to.
    expect(card).toHaveProperty('memberId');
    expect(card).toHaveProperty('displayName');
    expect(card).toHaveProperty('whyReasons');
    expect(card).toHaveProperty('distCity');
    expect(card).toHaveProperty('age');
    expect(card).toHaveProperty('photos');
    // The post-match-gated contextCard must NEVER appear pre-match.
    for (const c of json.bestFits) {
      expect(c).not.toHaveProperty('contextCard');
      expect(c).not.toHaveProperty('context_card');
    }
  });

  it('excludes already-swiped and blocked people', async () => {
    const viewer = makeUser({ interests: ['hiking'] });
    grantCompanion(viewer);
    const swiped = makeUser({ interests: ['hiking'] });
    const blockedPerson = makeUser({ interests: ['hiking'] });
    const visible = makeUser({ interests: ['hiking'] });

    // Viewer already skipped `swiped`.
    db.prepare('INSERT INTO swipes (id, swiper_id, swiped_id, decision, created_at) VALUES (?,?,?,?,?)')
      .run(`s${++uid}`, viewer, swiped, 'skip', Date.now());
    // Viewer blocked `blockedPerson`.
    db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?,?,?,?,?)')
      .run(`b${++uid}`, viewer, blockedPerson, 'other', Date.now());

    const { status, json } = await api('/matching/best-fits', { token: tok(viewer) });
    expect(status).toBe(200);
    const ids = json.bestFits.map((c) => c.memberId);
    expect(ids).not.toContain(swiped);
    expect(ids).not.toContain(blockedPerson);
    expect(ids).toContain(visible);
  });
});
