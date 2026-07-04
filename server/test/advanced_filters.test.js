// Deeper compatibility filters — the SECOND Companion-gated feature
// (audit/MONETIZATION_STRATEGY.md §5 #3). Boots a minimal app wired like
// src/index.js (optionalAuth + context + the matching router) over a throwaway
// on-disk DB, mirroring the best_fits/billing test setup.
//
// THE LOAD-BEARING CHECKS:
//  - PUT /matching/advanced-filters is requirePaid-gated: a free caller gets 402
//    { error:'upgrade_required', upgrade:true }; a Companion persists.
//  - Validation: a Companion PUT with a bad facet value → 400; a good one saves,
//    and unknown keys are stripped.
//  - The Companion deck is POST-SCORE re-ranked: a candidate matching the saved
//    comm-style pref ranks HIGHER, and the deck is NEVER emptied (count preserved).
//  - The GATE is real: a FREE viewer's deck is byte-identical whether or not a
//    filter set is stored on their profile (advanced filters never apply to free).
//  - DELETE clears the stored set (revert to base deck).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-adv-filters-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-adv-filters-suite';
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

// A visible candidate: complete profile, unpaused, one interest, valid 18+ DOB.
// `facets` sets the comm/sensory columns the advanced re-rank reads.
function makeUser({ interests = ['hiking'], dob = '1990-01-01', facets = {} } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, 'x', Date.now());
  const cols = ['user_id', 'display_name', 'bio', 'photo_url', 'date_of_birth', 'paused', 'updated_at'];
  const vals = [id, `Name ${id}`, 'A bio here.', 'https://x/p.jpg', dob, 0, Date.now()];
  for (const [col, v] of Object.entries(facets)) { cols.push(col); vals.push(v); }
  const placeholders = cols.map(() => '?').join(',');
  db.prepare(`INSERT INTO profiles (${cols.join(',')}) VALUES (${placeholders})`).run(...vals);
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
describe('PUT /matching/advanced-filters — the paid gate', () => {
  it('401 when unauthenticated', async () => {
    const { status } = await api('/matching/advanced-filters', { method: 'PUT', body: { commDirectness: 'direct' } });
    expect(status).toBe(401);
  });

  it('402 upgrade_required for a free (non-Companion) caller', async () => {
    const free = makeUser();
    const { status, json } = await api('/matching/advanced-filters', {
      token: tok(free), method: 'PUT', body: { commDirectness: 'direct' },
    });
    expect(status).toBe(402);
    expect(json).toEqual({ error: 'upgrade_required', upgrade: true });
    // Nothing was persisted for a free caller.
    const row = db.prepare('SELECT discover_advanced_filters FROM profiles WHERE user_id = ?').get(free);
    expect(row.discover_advanced_filters).toBe('');
  });

  it('a Companion PUT persists valid prefs and strips unknown keys', async () => {
    const member = makeUser();
    grantCompanion(member);
    const { status, json } = await api('/matching/advanced-filters', {
      token: tok(member), method: 'PUT',
      body: { commDirectness: 'direct', sensoryEnvironment: 'quiet', prioritizeSharedInterests: true, bogusKey: 'x' },
    });
    expect(status).toBe(200);
    expect(json.filters).toEqual({ commDirectness: 'direct', sensoryEnvironment: 'quiet', prioritizeSharedInterests: true });
    const row = db.prepare('SELECT discover_advanced_filters FROM profiles WHERE user_id = ?').get(member);
    expect(JSON.parse(row.discover_advanced_filters)).toEqual(json.filters);
  });

  it('a Companion PUT with a bad facet value → 400 (validation)', async () => {
    const member = makeUser();
    grantCompanion(member);
    const { status } = await api('/matching/advanced-filters', {
      token: tok(member), method: 'PUT', body: { commDirectness: 'not-a-real-value' },
    });
    expect(status).toBe(400);
  });

  it('GET returns the caller\'s saved prefs and their tier', async () => {
    const member = makeUser();
    grantCompanion(member);
    await api('/matching/advanced-filters', { token: tok(member), method: 'PUT', body: { commCadence: 'daily' } });
    const { status, json } = await api('/matching/advanced-filters', { token: tok(member) });
    expect(status).toBe(200);
    expect(json.filters).toEqual({ commCadence: 'daily' });
    expect(json.tier).toBe('companion');
  });

  it('DELETE clears the saved set for anyone', async () => {
    const member = makeUser();
    grantCompanion(member);
    await api('/matching/advanced-filters', { token: tok(member), method: 'PUT', body: { commLiteral: 'literal' } });
    const { status, json } = await api('/matching/advanced-filters', { token: tok(member), method: 'DELETE' });
    expect(status).toBe(200);
    expect(json.filters).toEqual({});
    const row = db.prepare('SELECT discover_advanced_filters FROM profiles WHERE user_id = ?').get(member);
    expect(row.discover_advanced_filters).toBe('');
  });
});

describe('GET /matching/candidates — post-score re-rank (Companion only)', () => {
  it('boosts candidates matching the saved comm-style pref WITHOUT emptying the deck', async () => {
    const viewer = makeUser();
    grantCompanion(viewer);
    // Three candidates with identical base score (all share "hiking"), differing
    // only by comm_directness. Without a filter they tie on score and order by
    // recency; with a `softened` preference the softened candidate must lead.
    const directA = makeUser({ facets: { comm_directness: 'direct' } });
    const softened = makeUser({ facets: { comm_directness: 'softened' } });
    const directB = makeUser({ facets: { comm_directness: 'direct' } });

    // Baseline (no filter stored) — deck has all three.
    const before = await api('/matching/candidates', { token: tok(viewer) });
    const beforeIds = before.json.map((c) => c.memberId);
    expect(beforeIds).toContain(directA);
    expect(beforeIds).toContain(softened);
    expect(beforeIds).toContain(directB);

    // Save a `softened` preference, then re-fetch.
    await api('/matching/advanced-filters', { token: tok(viewer), method: 'PUT', body: { commDirectness: 'softened' } });
    const after = await api('/matching/candidates', { token: tok(viewer) });
    const afterIds = after.json.map((c) => c.memberId);

    // Count preserved — the re-rank NEVER hard-excludes (deck can't be emptied).
    expect(afterIds.length).toBe(beforeIds.length);
    expect(afterIds).toEqual(expect.arrayContaining(beforeIds));
    // The softened candidate now ranks above BOTH direct ones.
    expect(afterIds.indexOf(softened)).toBeLessThan(afterIds.indexOf(directA));
    expect(afterIds.indexOf(softened)).toBeLessThan(afterIds.indexOf(directB));
  });

  it('a FREE viewer\'s deck is byte-identical with or without stored filters (gate)', async () => {
    const free = makeUser();
    // Same candidate mix as above.
    makeUser({ facets: { comm_directness: 'direct' } });
    makeUser({ facets: { comm_directness: 'softened' } });
    makeUser({ facets: { comm_directness: 'direct' } });

    const before = await api('/matching/candidates', { token: tok(free) });

    // Force a stored filter set directly onto the free profile (they can't via the
    // PUT, which 402s — this simulates a downgraded ex-Companion). The route must
    // IGNORE it for a free viewer, so the deck is unchanged.
    db.prepare('UPDATE profiles SET discover_advanced_filters = ? WHERE user_id = ?')
      .run(JSON.stringify({ commDirectness: 'softened' }), free);

    const after = await api('/matching/candidates', { token: tok(free) });
    expect(JSON.stringify(after.json)).toBe(JSON.stringify(before.json));
  });
});
