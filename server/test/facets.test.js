// F28 — structured "about me" facets. Boots a minimal app wired like src/index.js
// against a throwaway on-disk SQLite DB and drives it over HTTP, mirroring
// safety-batch.test.js. Covers save+read round-trip, cap/list-length validation,
// empty-is-fine, serialisation cleanup, and payload shape across the three
// surfaces (candidate deck card, matched-profile GET, matches list).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-facets-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-facets-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;

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

function match(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,NULL)')
    .run(`m${++uid}`, ua, ub, Date.now());
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

describe('F28: about-me facets round-trip', () => {
  it('saves and reads back all four facets (lists as arrays)', async () => {
    const u = makeUser();
    const put = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT',
      body: {
        occupation: 'Librarian',
        languages: 'English, ASL',
        helpsMe: ['Clear plans', 'Text over calls'],
        hardForMe: ['Loud places', 'Last-minute changes'],
      },
    });
    expect(put.status).toBe(200);
    expect(put.json.occupation).toBe('Librarian');
    expect(put.json.languages).toBe('English, ASL');
    expect(put.json.helpsMe).toEqual(['Clear plans', 'Text over calls']);
    expect(put.json.hardForMe).toEqual(['Loud places', 'Last-minute changes']);

    const get = await api('/profile/me', { token: signToken(u, 0) });
    expect(get.status).toBe(200);
    expect(get.json.occupation).toBe('Librarian');
    expect(get.json.languages).toBe('English, ASL');
    expect(get.json.helpsMe).toEqual(['Clear plans', 'Text over calls']);
    expect(get.json.hardForMe).toEqual(['Loud places', 'Last-minute changes']);
  });

  it('trims and drops empty list items, capping serialisation', async () => {
    const u = makeUser();
    const put = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT',
      body: { helpsMe: ['  Clear plans  ', '', '   ', 'Text first'] },
    });
    expect(put.status).toBe(200);
    expect(put.json.helpsMe).toEqual(['Clear plans', 'Text first']);
  });

  it('empty values are fine and read back as "" / []', async () => {
    const u = makeUser();
    const put = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT',
      body: { occupation: '', languages: '', helpsMe: [], hardForMe: [] },
    });
    expect(put.status).toBe(200);
    expect(put.json.occupation).toBe('');
    expect(put.json.languages).toBe('');
    expect(put.json.helpsMe).toEqual([]);
    expect(put.json.hardForMe).toEqual([]);
  });
});

describe('F28: validation rejects over-limit input with a calm 400', () => {
  it('rejects occupation over 80 chars', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { occupation: 'x'.repeat(81) },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/occupation/i);
  });

  it('rejects languages over 120 chars', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { languages: 'x'.repeat(121) },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/languages/i);
  });

  it('rejects a facet list with more than 5 items', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT',
      body: { helpsMe: ['a', 'b', 'c', 'd', 'e', 'f'] },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/at most 5/i);
  });

  it('rejects a facet item over 60 chars', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT',
      body: { hardForMe: ['x'.repeat(61)] },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/60 characters/i);
  });

  it('rejects a non-list facet value', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { helpsMe: 'not a list' },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/must be a list/i);
  });
});

describe('F28: payload shape across surfaces', () => {
  it('deck card carries occupation + languages but NOT the helps/hard lists', async () => {
    const viewer = makeUser({ interests: ['hiking'] });
    const subject = makeUser({ interests: ['hiking'] });
    await api('/profile/me', {
      token: signToken(subject, 0), method: 'PUT',
      body: {
        occupation: 'Baker', languages: 'English',
        helpsMe: ['Clear plans'], hardForMe: ['Loud places'],
      },
    });
    const r = await api('/matching/candidates', { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    const card = r.json.find((c) => c.memberId === subject);
    expect(card).toBeTruthy();
    expect(card.occupation).toBe('Baker');
    expect(card.languages).toBe('English');
    // The lists are intentionally absent from the deck card (calm Discover).
    expect(card.helpsMe).toBeUndefined();
    expect(card.hardForMe).toBeUndefined();
  });

  it('matched-profile GET /profile/:id returns all four facets', async () => {
    const viewer = makeUser();
    const subject = makeUser();
    await api('/profile/me', {
      token: signToken(subject, 0), method: 'PUT',
      body: {
        occupation: 'Nurse', languages: 'English, Spanish',
        helpsMe: ['Clear plans'], hardForMe: ['Loud places', 'Bright lights'],
      },
    });
    match(viewer, subject);
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    expect(r.json.occupation).toBe('Nurse');
    expect(r.json.languages).toBe('English, Spanish');
    expect(r.json.helpsMe).toEqual(['Clear plans']);
    expect(r.json.hardForMe).toEqual(['Loud places', 'Bright lights']);
  });

  it('matches list otherUser includes all four facets', async () => {
    const viewer = makeUser();
    const subject = makeUser();
    await api('/profile/me', {
      token: signToken(subject, 0), method: 'PUT',
      body: { occupation: 'Teacher', languages: 'English', helpsMe: ['Text first'], hardForMe: ['Phone calls'] },
    });
    match(viewer, subject);
    const r = await api('/matching/matches', { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    const m = r.json.matches.find((x) => x.otherUser.userId === subject);
    expect(m).toBeTruthy();
    expect(m.otherUser.occupation).toBe('Teacher');
    expect(m.otherUser.languages).toBe('English');
    expect(m.otherUser.helpsMe).toEqual(['Text first']);
    expect(m.otherUser.hardForMe).toEqual(['Phone calls']);
  });
});

// B24: age-range cross-check must catch an inverted range even when only ONE
// bound is sent (a single-field Discover-filter update). Before the fix the
// check ran only when BOTH bounds were in the same request, so a lone update
// could persist min>max and silently empty the deck.
describe('B24: prefAge single-bound update is validated against the stored bound', () => {
  it('rejects a lone prefAgeMin above the stored max, and a lone prefAgeMax below the stored min', async () => {
    const u = makeUser();
    const t = signToken(u, 0);

    // Lower the stored max to 40 (default min is 18) — valid on its own.
    const setMax = await api('/profile/me', { token: t, method: 'PUT', body: { prefAgeMax: 40 } });
    expect(setMax.status).toBe(200);

    // A lone prefAgeMin above the stored max (40) must 400, not silently invert.
    const badMin = await api('/profile/me', { token: t, method: 'PUT', body: { prefAgeMin: 60 } });
    expect(badMin.status).toBe(400);

    // A valid lone prefAgeMin (≤ stored max) still passes.
    const okMin = await api('/profile/me', { token: t, method: 'PUT', body: { prefAgeMin: 30 } });
    expect(okMin.status).toBe(200);

    // Now stored range is 30–40. A lone prefAgeMax below the stored min (30) 400s.
    const badMax = await api('/profile/me', { token: t, method: 'PUT', body: { prefAgeMax: 20 } });
    expect(badMax.status).toBe(400);
  });
});
