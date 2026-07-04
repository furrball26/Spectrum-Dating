// Data export (ZIP) regression tests.
//
// Boots a minimal Express app wired like src/index.js (optionalAuth ->
// contextMiddleware -> exportRouter) against a throwaway on-disk SQLite DB, then
// drives GET /export/archive over HTTP and unzips the response to inspect its
// entries. The R2 storage module is mocked so we can exercise both the
// photos-included and photos-absent / storage-unavailable paths deterministically.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-export-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-export-suite';
process.env.NODE_ENV = 'test';

// Toggleable R2 mock: tests flip h.r2Ready to simulate configured/unconfigured
// storage; a storage_key ending in 'BAD' simulates an object that can't be read.
const h = vi.hoisted(() => ({ r2Ready: false, bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]) }));
vi.mock('../src/storage/r2.js', () => ({
  r2Configured: () => h.r2Ready,
  getObjectBytes: async (key) => {
    if (!h.r2Ready) throw new Error('R2 not configured');
    if (key.endsWith('BAD')) throw new Error('object not found');
    return h.bytes;
  },
  // photos.js imports these at module load; unused in these tests.
  getPresignedUploadUrl: async () => 'https://x',
  getPublicUrl: (k) => `https://cdn/${k}`,
  deleteObject: async () => {},
}));

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken, signPurposeToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const exportRouter = (await import('../src/routes/export.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ email, profile = {} } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended, email_verified) VALUES (?, ?, ?, ?, 0, 0, ?)')
    .run(id, email || `${id}@t.dev`, 'x', Date.now(), profile.emailVerified ? 1 : 0);
  db.prepare(
    `INSERT INTO profiles (user_id, display_name, tagline, bio, date_of_birth, paused, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, profile.displayName || `Name ${id}`, profile.tagline || '', profile.bio || 'A calm bio.', '1990-01-01', Date.now());
  for (const it of profile.interests || ['hiking']) {
    db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, it);
  }
  for (const pr of profile.prompts || []) {
    db.prepare('INSERT INTO profile_prompts (id, user_id, prompt_key, answer, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`pp${++uid}`, id, pr.key, pr.answer, 0, Date.now());
  }
  return id;
}

function addPhoto(userId, { storageKey, description = '', primary = false, position = 0, review = 'approved' } = {}) {
  const id = `ph${++uid}`;
  db.prepare(
    'INSERT INTO profile_photos (id, user_id, storage_key, url, description, is_primary, position, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, storageKey ?? `profile-photos/${userId}/${id}.jpg`, `https://cdn/${id}.jpg`, description, primary ? 1 : 0, position, review, Date.now());
  return id;
}

function match(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const id = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?, ?, ?, ?, NULL)')
    .run(id, ua, ub, Date.now());
  return id;
}

function conversation(matchId, a, b) {
  const id = `c${++uid}`;
  db.prepare('INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, matchId, a, b, Date.now());
  return id;
}

function message(convId, senderId, body, { deleted = false, sentAt = Date.now() } = {}) {
  const id = `msg${++uid}`;
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, body, deleted, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, convId, senderId, body, deleted ? 1 : 0, sentAt);
  return id;
}

async function fetchArchive(path, { token, header } = {}) {
  const headers = {};
  if (header) headers.authorization = `Bearer ${header}`;
  const url = token ? `${baseUrl}${path}?token=${encodeURIComponent(token)}` : `${baseUrl}${path}`;
  const res = await fetch(url, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, res, buf };
}

function unzip(buf) {
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((e) => e.entryName);
  const text = (name) => zip.getEntry(name)?.getData().toString('utf8');
  const raw = (name) => zip.getEntry(name)?.getData();
  return { names, text, raw };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/export', exportRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('GET /export/archive — ZIP structure', () => {
  it('returns a ZIP with the four parts (index.html, data.json, README.txt, photos/)', async () => {
    h.r2Ready = true;
    const me = makeUser({ profile: { displayName: 'Alex', prompts: [{ key: 'talk_for_hours', answer: 'trains' }] } });
    addPhoto(me, { description: 'me smiling', primary: true });
    const { status, res, buf } = await fetchArchive('/export/archive', { header: signToken(me) });

    expect(status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('spectrum-dating-export.zip');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const { names } = unzip(buf);
    expect(names).toContain('index.html');
    expect(names).toContain('data.json');
    expect(names).toContain('README.txt');
    expect(names.some((n) => n.startsWith('photos/'))).toBe(true);
  });

  it('bundles the actual photo bytes at photos/profile-01.<ext>', async () => {
    h.r2Ready = true;
    const me = makeUser();
    addPhoto(me, { primary: true });
    const { buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    const { names, raw } = unzip(buf);
    expect(names).toContain('photos/profile-01.jpg');
    expect(raw('photos/profile-01.jpg')).toEqual(h.bytes);
  });

  it('data.json includes the full profile + conversations', async () => {
    h.r2Ready = true;
    const me = makeUser({ profile: { displayName: 'Jordan', bio: 'I love tide pools.', interests: ['birds', 'chess'], prompts: [{ key: 'a_perfect_day', answer: 'a quiet beach' }] } });
    const other = makeUser({ profile: { displayName: 'Sam' } });
    const c = conversation(match(me, other), me, other);
    message(c, me, 'hello there');
    message(c, other, 'hi!');

    const { buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    const data = JSON.parse(unzip(buf).text('data.json'));

    expect(data.profile.displayName).toBe('Jordan');
    expect(data.profile.bio).toBe('I love tide pools.');
    expect(data.profile.interests).toEqual(expect.arrayContaining(['birds', 'chess']));
    expect(data.profile.prompts[0]).toMatchObject({ promptKey: 'a_perfect_day', answer: 'a quiet beach' });
    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].withUser).toBe('Sam');
    expect(data.conversations[0].messages.map((m) => m.body)).toEqual(['hello there', 'hi!']);
    expect(data.conversations[0].messages[0].from).toBe('me');
    expect(data.conversations[0].messages[1].from).toBe('them');
  });

  it('HTML-escapes all user-supplied strings (bio + message body)', async () => {
    h.r2Ready = true;
    const me = makeUser({ profile: { displayName: 'Robert"><b>', bio: '<script>alert(1)</script>' } });
    const other = makeUser({ profile: { displayName: 'Eve' } });
    const c = conversation(match(me, other), me, other);
    message(c, me, 'evil <img src=x onerror="alert(2)">');

    const { buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    const html = unzip(buf).text('index.html');

    // Injected markup must be escaped, never live.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;img src=x onerror=');
    expect(html).not.toContain('<img src=x onerror="alert(2)">');
    // The escaped display name too (no live <b>, no raw ").
    expect(html).toContain('Robert&quot;&gt;&lt;b&gt;');
  });

  it("keeps the other party minimized (name + direction only — no bio/email leak)", async () => {
    h.r2Ready = true;
    const me = makeUser();
    const other = makeUser({ email: 'secret-other@private.dev', profile: { displayName: 'Dana', bio: 'OTHER_PARTY_SECRET_BIO' } });
    addPhoto(other, { description: 'other-photo' });
    const c = conversation(match(me, other), me, other);
    message(c, other, 'a message from them');

    const { buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    const z = unzip(buf);
    const jsonText = z.text('data.json');
    const htmlText = z.text('index.html');

    // Other party's private data must never appear anywhere in the export.
    expect(jsonText).not.toContain('OTHER_PARTY_SECRET_BIO');
    expect(jsonText).not.toContain('secret-other@private.dev');
    expect(htmlText).not.toContain('OTHER_PARTY_SECRET_BIO');
    // The conversation object exposes only conversationId, withUser, messages.
    const conv = JSON.parse(jsonText).conversations[0];
    expect(Object.keys(conv).sort()).toEqual(['conversationId', 'messages', 'withUser']);
    expect(conv.withUser).toBe('Dana');
  });

  it('preserves coarse timestamps (no raw epochs) and redacts deleted messages', async () => {
    h.r2Ready = true;
    const me = makeUser();
    const other = makeUser();
    const c = conversation(match(me, other), me, other);
    const sentAt = Date.now();
    message(c, me, 'kept message', { sentAt });
    message(c, me, 'this was removed', { deleted: true, sentAt });

    const { buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    const jsonText = unzip(buf).text('data.json');
    const data = JSON.parse(jsonText);

    expect(data.exportedAt).toBe('Today');
    expect(data.conversations[0].messages[0].timeGroup).toBe('Today');
    // The raw epoch must not appear anywhere in the payload.
    expect(jsonText).not.toContain(String(sentAt));
    // Deleted message body redacted.
    expect(data.conversations[0].messages[1].body).toBe('[deleted]');
  });

  it('still produces a valid ZIP when R2 is unconfigured (no photos bundled)', async () => {
    h.r2Ready = false;
    const me = makeUser();
    addPhoto(me, { description: 'wont be included' }); // has a row, but storage is down
    const { status, buf } = await fetchArchive('/export/archive', { header: signToken(me) });

    expect(status).toBe(200);
    const z = unzip(buf);
    expect(z.names).toContain('index.html');
    expect(z.names).toContain('data.json');
    expect(z.names.some((n) => n.startsWith('photos/'))).toBe(false);

    const data = JSON.parse(z.text('data.json'));
    expect(data.photos.included).toBe(0);
    expect(data.photos.storageAvailable).toBe(false);
    expect(z.text('index.html')).toContain('No photos were included');
    expect(z.text('README.txt')).toContain('storage was unavailable');
  });

  it('skips an unreadable photo object without failing the whole export', async () => {
    h.r2Ready = true;
    const me = makeUser();
    addPhoto(me, { storageKey: `profile-photos/${me}/good.jpg`, description: 'good', position: 0 });
    addPhoto(me, { storageKey: `profile-photos/${me}/wontloadBAD`, description: 'broken', position: 1 });
    const { status, buf } = await fetchArchive('/export/archive', { header: signToken(me) });

    expect(status).toBe(200);
    const z = unzip(buf);
    expect(z.names.filter((n) => n.startsWith('photos/'))).toHaveLength(1);
    const data = JSON.parse(z.text('data.json'));
    expect(data.photos.included).toBe(1);
    expect(data.photos.notIncluded).toHaveLength(1);
  });

  it('works for a free-tier user (export is never gated)', async () => {
    h.r2Ready = true;
    const me = makeUser(); // no subscriptions row => free
    const { status, buf } = await fetchArchive('/export/archive', { header: signToken(me) });
    expect(status).toBe(200);
    const data = JSON.parse(unzip(buf).text('data.json'));
    expect(data.profile.tier).toBe('free');
  });
});

describe('GET /export/archive — auth', () => {
  it('accepts a short-lived purpose-scoped export token via ?token=', async () => {
    h.r2Ready = false;
    const me = makeUser();
    const token = signPurposeToken(me, 'export', 0, '5m');
    const { status, buf } = await fetchArchive('/export/archive', { token });
    expect(status).toBe(200);
    const data = JSON.parse(unzip(buf).text('data.json'));
    expect(data.userId).toBe(me);
  });

  it('rejects an invalid token with 401', async () => {
    const { status } = await fetchArchive('/export/archive', { token: 'not-a-real-token' });
    expect(status).toBe(401);
  });
});
