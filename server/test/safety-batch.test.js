// SAFETY-2 (profile-photo review) + JRN-1 (name screening) + G4 (locationGeocodable)
// integration tests. Boots a minimal app wired like src/index.js against a
// throwaway on-disk SQLite DB and drives it over HTTP, mirroring security.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-safety-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-safety-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const matchingRouter = (await import('../src/routes/matching.js')).default;
const photosRouter = (await import('../src/routes/photos.js')).default;
const adminRouter = (await import('../src/routes/admin.js')).default;
const { getCandidates } = await import('../src/matching/candidates.js');

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminCreated = false;

function makeUser({ admin = false, photoUrl = '', displayName, paused = 0, interests = ['hiking'], dob = '1990-01-01', email: emailOverride } = {}) {
  const id = `u${++uid}`;
  const email = emailOverride || (admin ? 'admin@t.dev' : `${id}@t.dev`);
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, email, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, photo_url, date_of_birth, paused, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, displayName || `Name ${id}`, 'A bio here.', photoUrl, dob, paused, Date.now());
  for (const it of interests) db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, it);
  return id;
}

function makeAdmin() {
  if (adminCreated) throw new Error('admin already created');
  adminCreated = true;
  return makeUser({ admin: true });
}

function addPhotoRow(userId, { url = 'https://x/g.jpg', status = 'pending_review', primary = 0, pos = 0 } = {}) {
  const id = `ph${++uid}`;
  db.prepare(
    'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, review_status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, userId, `profile-photos/${userId}/${id}.jpg`, url, pos, primary, status, Date.now());
  return id;
}

function match(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,NULL)')
    .run(`m${++uid}`, ua, ub, Date.now());
}

function photoUrlOf(userId) {
  return db.prepare('SELECT photo_url FROM profiles WHERE user_id = ?').get(userId).photo_url;
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
  app.use('/photos', photosRouter);
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

describe('SAFETY-2: profile photos require admin approval', () => {
  it('a newly added photo enters pending_review and is NOT mirrored to photo_url', async () => {
    const u = makeUser({ photoUrl: '' });
    const r = await api('/photos/profile-add', {
      token: signToken(u, 0), method: 'POST', body: { key: `profile-photos/${u}/new.jpg` },
    });
    expect(r.status).toBe(200);
    expect(r.json.photos).toHaveLength(1);
    expect(r.json.photos[0].pending).toBe(true);
    expect(r.json.photos[0].reviewStatus).toBe('pending_review');
    // Not mirrored to the public avatar while pending.
    expect(photoUrlOf(u)).toBe('');
  });

  it('rejects a crafted key with a bad shape (path traversal / extra segment / bad ext)', async () => {
    const u = makeUser({ photoUrl: '' });
    const bad = [
      `profile-photos/${u}/../${u}/evil.jpg`, // traversal out of the segment
      `profile-photos/${u}/sub/dir.jpg`,      // extra path part
      `profile-photos/${u}/file.exe`,         // disallowed extension
      `profile-photos/${u}/nodotjpg`,         // no extension
    ];
    for (const key of bad) {
      const r = await api('/photos/profile-add', { token: signToken(u, 0), method: 'POST', body: { key } });
      expect(r.status).toBe(403);
    }
    // A well-formed key still works.
    const ok = await api('/photos/profile-add', {
      token: signToken(u, 0), method: 'POST', body: { key: `profile-photos/${u}/ok_1.jpg` },
    });
    expect(ok.status).toBe(200);
  });

  it('rejects re-confirming a key that already backs a photo row (reused-key guard)', async () => {
    const u = makeUser({ photoUrl: '' });
    const key = `profile-photos/${u}/dup.jpg`;
    const first = await api('/photos/profile-add', { token: signToken(u, 0), method: 'POST', body: { key } });
    expect(first.status).toBe(200);
    const again = await api('/photos/profile-add', { token: signToken(u, 0), method: 'POST', body: { key } });
    expect(again.status).toBe(409);
    // Still only one row for that key.
    expect(db.prepare('SELECT COUNT(*) AS n FROM profile_photos WHERE storage_key = ?').get(key).n).toBe(1);
  });

  it('a pending-only user is NOT in another viewer’s candidates', () => {
    const viewer = makeUser();
    const subject = makeUser({ photoUrl: '' });
    addPhotoRow(subject, { status: 'pending_review', primary: 1 });
    const cands = getCandidates(db, viewer, ['hiking']).map((c) => c.user_id);
    expect(cands).not.toContain(subject);
  });

  it('the OWNER sees their own pending photo via /profile/me (with pending flag)', async () => {
    const owner = makeUser({ photoUrl: '' });
    addPhotoRow(owner, { status: 'pending_review', primary: 1 });
    const r = await api('/profile/me', { token: signToken(owner, 0) });
    expect(r.status).toBe(200);
    expect(r.json.photos.some((p) => p.pending)).toBe(true);
  });

  it('a matched viewer does NOT receive the pending photo in /profile/:id', async () => {
    const viewer = makeUser();
    const subject = makeUser({ photoUrl: '' });
    addPhotoRow(subject, { status: 'pending_review', primary: 1 });
    match(viewer, subject);
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    expect(r.json.photos).toHaveLength(0);
    expect(r.json.photoUrl).toBe('');
  });

  it('admin approve makes the photo servable (photo_url synced + shown to matched viewer + candidate)', async () => {
    const admin = makeAdmin();
    const subject = makeUser({ photoUrl: '' });
    const pid = addPhotoRow(subject, { status: 'pending_review', primary: 1, url: 'https://x/appr.jpg' });

    // Queue lists it.
    const q = await api('/admin/profile-photos/pending', { token: signToken(admin, 0) });
    expect(q.status).toBe(200);
    expect(q.json.photos.some((p) => p.id === pid)).toBe(true);

    // Approve.
    const ra = await api(`/admin/profile-photos/${pid}/review`, {
      token: signToken(admin, 0), method: 'POST', body: { decision: 'approve' },
    });
    expect(ra.status).toBe(200);
    expect(ra.json.status).toBe('approved');
    expect(photoUrlOf(subject)).toBe('https://x/appr.jpg');

    // Matched viewer now sees it.
    const viewer = makeUser();
    match(viewer, subject);
    const rp = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(rp.json.photos.some((p) => p.url === 'https://x/appr.jpg')).toBe(true);
    expect(rp.json.photoUrl).toBe('https://x/appr.jpg');

    // And they now surface as a candidate to a fresh viewer.
    const freshViewer = makeUser();
    expect(getCandidates(db, freshViewer, ['hiking']).map((c) => c.user_id)).toContain(subject);
  });

  it('admin reject: photo becomes non-servable and photo_url is not populated', async () => {
    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@t.dev'").get().id;
    const subject = makeUser({ photoUrl: '' });
    const pid = addPhotoRow(subject, { status: 'pending_review', primary: 1, url: 'https://x/bad.jpg' });

    const rr = await api(`/admin/profile-photos/${pid}/review`, {
      token: signToken(admin, 0), method: 'POST', body: { decision: 'reject', note: 'nudity' },
    });
    expect(rr.status).toBe(200);
    expect(rr.json.status).toBe('rejected');
    expect(db.prepare('SELECT review_status FROM profile_photos WHERE id = ?').get(pid).review_status).toBe('rejected');
    expect(photoUrlOf(subject)).toBe('');
  });

  it('backfilled (approved) photos remain served', async () => {
    const viewer = makeUser();
    const subject = makeUser({ photoUrl: 'https://x/legacy.jpg' });
    addPhotoRow(subject, { status: 'approved', primary: 1, url: 'https://x/legacy.jpg' });
    match(viewer, subject);
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.json.photos.some((p) => p.url === 'https://x/legacy.jpg')).toBe(true);
    expect(getCandidates(db, makeUser(), ['hiking']).map((c) => c.user_id)).toContain(subject);
  });

  // The moderation queues must not fill with QA-harness / demo activity: a
  // ~500-item false photo backlog buried the real items a moderator needs to see.
  // Same exclusion now covers photo / audio / attachment / verification.
  it('pending photos from test/demo accounts are excluded from the queue + counts, real ones stay', async () => {
    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@t.dev'").get().id;
    const token = signToken(admin, 0);

    const testAcct = makeUser({ photoUrl: '', email: `qa+x${++uid}@spectrum-test.dev` });
    const demoAcct = makeUser({ photoUrl: '', email: `telemetry-demo-${++uid}@sample.spectrum-dating.app` });
    const realAcct = makeUser({ photoUrl: '' });
    const tPid = addPhotoRow(testAcct, { status: 'pending_review', primary: 1, url: 'https://x/qa.jpg' });
    const dPid = addPhotoRow(demoAcct, { status: 'pending_review', primary: 1, url: 'https://x/demo.jpg' });
    const rPid = addPhotoRow(realAcct, { status: 'pending_review', primary: 1, url: 'https://x/real.jpg' });

    const q = await api('/admin/profile-photos/pending', { token });
    expect(q.status).toBe(200);
    const ids = q.json.photos.map((p) => p.id);
    expect(ids).toContain(rPid);
    expect(ids).not.toContain(tPid);
    expect(ids).not.toContain(dPid);

    // The stats + queue-count depths only count the real one, not test/demo.
    const priorStats = await api('/admin/stats', { token });
    const priorCounts = await api('/admin/queue-counts', { token });
    // At least the real photo is counted; the two excluded ones are not double-counted.
    expect(priorStats.json.pendingProfilePhotos).toBe(ids.length);
    expect(priorCounts.json.pendingProfilePhotos).toBe(ids.length);
  });

  it('audio / attachment / verification queues also exclude test/demo (count delta = real only)', async () => {
    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@t.dev'").get().id;
    const token = signToken(admin, 0);

    const before = (await api('/admin/stats', { token })).json;

    const t = makeUser({ email: `qa+y${++uid}@spectrum-test.dev` });
    const d = makeUser({ email: `telemetry-demo-${++uid}@sample.spectrum-dating.app` });
    const r = makeUser();

    // One pending row per queue, per account.
    for (const u of [t, d, r]) {
      db.prepare(
        `INSERT INTO profile_audio (id, user_id, prompt_key, storage_key, url, transcript, duration_ms, mime_type, review_status, position, created_at)
         VALUES (?, ?, 'q1', ?, ?, 'hi', 5000, 'audio/webm', 'pending_review', 0, ?)`
      ).run(`au${++uid}`, u, `profile-audio/${u}/a.webm`, `https://cdn/a-${u}.webm`, Date.now());
      db.prepare(
        `INSERT INTO message_attachments (id, uploader_id, storage_key, public_url, mime_type, file_size_bytes, upload_status, created_at)
         VALUES (?, ?, ?, ?, 'image/jpeg', 1000, 'pending_review', ?)`
      ).run(`at${++uid}`, u, `att/${u}/x.jpg`, `https://cdn/att-${u}.jpg`, Date.now());
      db.prepare(
        "INSERT INTO verification_requests (id, user_id, status, requested_at) VALUES (?, ?, 'pending', ?)"
      ).run(`vr${++uid}`, u, Date.now());
    }

    const after = (await api('/admin/stats', { token })).json;
    // Exactly one new real item per queue; the test+demo rows are excluded.
    expect(after.pendingProfileAudio - before.pendingProfileAudio).toBe(1);
    expect(after.pendingAttachments - before.pendingAttachments).toBe(1);
    expect(after.pendingVerifications - before.pendingVerifications).toBe(1);

    // List endpoints: real owner present, test/demo absent.
    const vlist = (await api('/admin/verification-requests', { token })).json.requests.map((x) => x.userId);
    expect(vlist).toContain(r);
    expect(vlist).not.toContain(t);
    expect(vlist).not.toContain(d);

    const alist = (await api('/admin/attachments', { token })).json.attachments.map((x) => x.uploaderId);
    expect(alist).toContain(r);
    expect(alist).not.toContain(t);
    expect(alist).not.toContain(d);
  });
});

describe('JRN-1: abusive display-name screening', () => {
  it('rejects a slur display name on save with a calm 400', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { displayName: 'faggot' },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/offensive language/i);
  });

  it('accepts a normal display name', async () => {
    const u = makeUser();
    const r = await api('/profile/me', {
      token: signToken(u, 0), method: 'PUT', body: { displayName: 'Alex' },
    });
    expect(r.status).toBe(200);
    expect(r.json.displayName).toBe('Alex');
  });

  it('excludes an already-offending name from candidates but keeps a clean one', () => {
    const viewer = makeUser();
    const offender = makeUser({ displayName: 'nigger', photoUrl: 'https://x/o.jpg' });
    addPhotoRow(offender, { status: 'approved', primary: 1, url: 'https://x/o.jpg' });
    const clean = makeUser({ displayName: 'Jordan', photoUrl: 'https://x/c.jpg' });
    addPhotoRow(clean, { status: 'approved', primary: 1, url: 'https://x/c.jpg' });

    const cands = getCandidates(db, viewer, ['hiking']).map((c) => c.user_id);
    expect(cands).not.toContain(offender);
    expect(cands).toContain(clean);
  });
});

describe('PROD-6: viewer photo gallery is approved-only and primary-first', () => {
  it('exposes approved photos primary-first and excludes pending on /profile/:id', async () => {
    const subject = makeUser({ photoUrl: '' });
    // approved, NON-primary, low position — should come SECOND.
    addPhotoRow(subject, { status: 'approved', primary: 0, pos: 0, url: 'https://p6/a.jpg' });
    // pending — must be excluded entirely.
    addPhotoRow(subject, { status: 'pending_review', primary: 0, pos: 1, url: 'https://p6/pending.jpg' });
    // approved PRIMARY at a HIGHER position — must sort FIRST regardless.
    addPhotoRow(subject, { status: 'approved', primary: 1, pos: 2, url: 'https://p6/primary.jpg' });

    const viewer = makeUser();
    match(viewer, subject);
    const r = await api(`/profile/${subject}`, { token: signToken(viewer, 0) });
    expect(r.status).toBe(200);
    const urls = r.json.photos.map((p) => p.url);
    // Pending excluded (approved-only), primary first, then by position.
    expect(urls).not.toContain('https://p6/pending.jpg');
    expect(urls).toEqual(['https://p6/primary.jpg', 'https://p6/a.jpg']);
    expect(r.json.photos[0].isPrimary).toBe(true);
    // Minimal viewer shape — no id/position/reviewStatus/pending leak.
    expect(Object.keys(r.json.photos[0]).sort()).toEqual(['description', 'isPrimary', 'url']);
  });

  it('exposes the same approved-only, primary-first gallery on the Discover deck', async () => {
    const subject = makeUser({ photoUrl: '' });
    addPhotoRow(subject, { status: 'approved', primary: 0, pos: 0, url: 'https://p6d/a.jpg' });
    addPhotoRow(subject, { status: 'pending_review', primary: 0, pos: 1, url: 'https://p6d/pending.jpg' });
    addPhotoRow(subject, { status: 'approved', primary: 1, pos: 2, url: 'https://p6d/primary.jpg' });
    // Candidate eligibility requires photo_url != '' (the approved primary).
    db.prepare('UPDATE profiles SET photo_url = ? WHERE user_id = ?').run('https://p6d/primary.jpg', subject);

    const viewer = makeUser();
    // Paginate the whole deck to find the subject (the endpoint caps each page).
    let hit = null;
    for (let offset = 0; offset < 400 && !hit; offset += 20) {
      const r = await api(`/matching/candidates?limit=20&offset=${offset}`, { token: signToken(viewer, 0) });
      const page = Array.isArray(r.json) ? r.json : [];
      hit = page.find((c) => c.memberId === subject) || null;
      if (page.length < 20) break;
    }
    expect(hit).not.toBeNull();
    const urls = hit.photos.map((p) => p.url);
    expect(urls).not.toContain('https://p6d/pending.jpg');
    expect(urls).toEqual(['https://p6d/primary.jpg', 'https://p6d/a.jpg']);
    expect(hit.photos[0].isPrimary).toBe(true);
  });
});

describe('G4: locationGeocodable flag on /profile/me', () => {
  it('is true for a supported metro and false for an ungeocodable city', async () => {
    const u = makeUser();
    db.prepare('UPDATE profiles SET dist_city = ? WHERE user_id = ?').run('Phoenix, AZ', u);
    const r1 = await api('/profile/me', { token: signToken(u, 0) });
    expect(r1.json.locationGeocodable).toBe(true);

    db.prepare('UPDATE profiles SET dist_city = ? WHERE user_id = ?').run('Nowheresville, ZZ', u);
    const r2 = await api('/profile/me', { token: signToken(u, 0) });
    expect(r2.json.locationGeocodable).toBe(false);
  });
});
