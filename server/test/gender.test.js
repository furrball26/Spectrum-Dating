// D-11/D-12/D-13 — expanded gender (display) with a matchable-core `gender_group`
// that drives matching, self-describe free text, and display-only orientation.
//
// Boots a minimal app wired like src/index.js against a throwaway on-disk SQLite
// DB and drives it over HTTP (mirrors facets.test.js / security.test.js). The
// matching assertions call getCandidates() directly against the same shared DB.
//
// THE LOAD-BEARING CHECK: matching must filter on gender_group (the 3-value
// core), so a trans-woman is shown to a viewer seeking women, a trans-man to a
// viewer seeking men, an agender person to a viewer seeking nonbinary — while
// legacy woman/man/nonbinary matching is unchanged, and orientation never
// affects the deck.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-gender-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-gender-suite';
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

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// Set identity fields via the REAL route so gender_group is computed by the app.
async function setIdentity(id, fields) {
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
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('D-12: gender_group derivation is stored + returned', () => {
  it('computes gender_group from an expanded gender on PUT (trans-woman → woman)', async () => {
    const u = makeUser();
    const put = await setIdentity(u, { gender: 'trans-woman' });
    expect(put.status).toBe(200);
    expect(put.json.gender).toBe('trans-woman');       // expanded DISPLAY value preserved
    expect(put.json.genderGroup).toBe('woman');        // matchable core derived
    const get = await api('/profile/me', { token: signToken(u, 0) });
    expect(get.json.gender).toBe('trans-woman');
    expect(get.json.genderGroup).toBe('woman');
  });

  it('maps every new non-binary identity to the nonbinary core', async () => {
    for (const g of ['agender', 'genderfluid', 'genderqueer', 'bigender', 'two-spirit', 'intersex', 'questioning', 'other']) {
      const u = makeUser();
      const put = await setIdentity(u, { gender: g });
      expect(put.status).toBe(200);
      expect(put.json.genderGroup).toBe('nonbinary');
    }
  });

  it('trans-man → man; legacy core values unchanged', async () => {
    const tm = makeUser();
    expect((await setIdentity(tm, { gender: 'trans-man' })).json.genderGroup).toBe('man');
    for (const g of ['woman', 'man', 'nonbinary']) {
      const u = makeUser();
      expect((await setIdentity(u, { gender: g })).json.genderGroup).toBe(g);
    }
    const none = makeUser();
    expect((await setIdentity(none, { gender: '' })).json.genderGroup).toBe('');
  });

  it('rejects a gender outside the expanded enum', async () => {
    const u = makeUser();
    const r = await setIdentity(u, { gender: 'not-a-gender' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/gender must be one of/i);
  });
});

describe('D-12: gender_group drives matching (the real fix)', () => {
  it('a trans-woman is shown to a viewer seeking women', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: 'woman' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'trans-woman', seeking: '' }); // open to everyone
    expect(candidateIds(viewer)).toContain(subject);
  });

  it('a trans-man is shown to a viewer seeking men', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'woman', seeking: 'man' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'trans-man', seeking: '' });
    expect(candidateIds(viewer)).toContain(subject);
  });

  it('an agender person is shown to a viewer seeking nonbinary', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'woman', seeking: 'nonbinary' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'agender', seeking: '' });
    expect(candidateIds(viewer)).toContain(subject);
  });

  it('a viewer seeking women does NOT see a trans-man (core = man)', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: 'woman' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'trans-man', seeking: '' });
    expect(candidateIds(viewer)).not.toContain(subject);
  });

  it('mutual: a person seeking men sees a trans-man viewer back (both sides use gender_group)', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'trans-man', seeking: 'woman' }); // core man
    const subject = makeUser();
    await setIdentity(subject, { gender: 'woman', seeking: 'man' });      // seeks men → wants the viewer's core (man)
    expect(candidateIds(viewer)).toContain(subject); // mutual passes both directions
  });
});

describe('D-12 regression: legacy woman/man/nonbinary matching is UNCHANGED', () => {
  it('viewer seeking women sees a woman, not a man or nonbinary person', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: 'woman' });
    const aWoman = makeUser();     await setIdentity(aWoman, { gender: 'woman', seeking: '' });
    const aMan = makeUser();       await setIdentity(aMan, { gender: 'man', seeking: '' });
    const aNb = makeUser();        await setIdentity(aNb, { gender: 'nonbinary', seeking: '' });
    const ids = candidateIds(viewer);
    expect(ids).toContain(aWoman);
    expect(ids).not.toContain(aMan);
    expect(ids).not.toContain(aNb);
  });

  it('a candidate with no gender set (group "") always passes (inclusive)', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: 'woman' });
    const unset = makeUser(); // never sets gender → gender_group ''
    expect(candidateIds(viewer)).toContain(unset);
  });
});

describe('D-13: orientation round-trips and does NOT affect candidates', () => {
  it('saves + reads back a multi-select orientation (deduped, valid tokens only)', async () => {
    const u = makeUser();
    const put = await setIdentity(u, { orientation: 'bisexual, queer, bisexual' });
    expect(put.status).toBe(200);
    expect(put.json.orientation).toBe('bisexual,queer');
    const get = await api('/profile/me', { token: signToken(u, 0) });
    expect(get.json.orientation).toBe('bisexual,queer');
  });

  it('rejects an orientation token outside the allowed set', async () => {
    const u = makeUser();
    const r = await setIdentity(u, { orientation: 'straight, wizard' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/orientation tokens must be from/i);
  });

  it('orientation never changes who appears in Discover (display only)', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: 'woman', orientation: 'straight' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'woman', seeking: '', orientation: 'lesbian' });
    // Opposite orientations, but gender_group is compatible → still shown.
    expect(candidateIds(viewer)).toContain(subject);
  });
});

describe('D-11: gender_custom is slur-screened + capped and surfaces on display payloads', () => {
  it('accepts a valid self-describe value and returns it', async () => {
    const u = makeUser();
    const put = await setIdentity(u, { gender: 'other', genderCustom: 'Demigirl' });
    expect(put.status).toBe(200);
    expect(put.json.genderCustom).toBe('Demigirl');
  });

  it('rejects a self-describe value over 40 chars', async () => {
    const u = makeUser();
    const r = await setIdentity(u, { genderCustom: 'x'.repeat(41) });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/genderCustom must be 40/i);
  });

  it('rejects a self-describe value containing a slur', async () => {
    const u = makeUser();
    const r = await setIdentity(u, { genderCustom: 'faggot' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/offensive language/i);
  });

  it('exposes gender + genderCustom (not gender_group) on the candidate deck card', async () => {
    const viewer = makeUser();
    await setIdentity(viewer, { gender: 'man', seeking: '' });
    const subject = makeUser();
    await setIdentity(subject, { gender: 'other', genderCustom: 'Demiboy', orientation: 'queer' });
    const r = await api('/matching/candidates', { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    const card = r.json.find((c) => c.memberId === subject);
    expect(card).toBeTruthy();
    expect(card.gender).toBe('other');
    expect(card.genderCustom).toBe('Demiboy');
    expect(card.orientation).toBe('queer');
    expect(card.genderGroup).toBeUndefined(); // internal to matching — never leaked
  });

  it('matched public profile returns gender + genderCustom + orientation, not gender_group', async () => {
    const viewer = makeUser();
    const subject = makeUser();
    await setIdentity(subject, { gender: 'genderqueer', genderCustom: 'Genderqueer femme', orientation: 'pansexual' });
    // Create a match so the public profile is viewable.
    const [ua, ub] = viewer < subject ? [viewer, subject] : [subject, viewer];
    db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,NULL)')
      .run(`m${++uid}`, ua, ub, Date.now());
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    expect(r.json.gender).toBe('genderqueer');
    expect(r.json.genderCustom).toBe('Genderqueer femme');
    expect(r.json.orientation).toBe('pansexual');
    expect(r.json.genderGroup).toBeUndefined();
  });
});
