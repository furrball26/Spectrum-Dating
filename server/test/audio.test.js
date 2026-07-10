// Profile AUDIO prompt-answer safety spine — regression suite.
//
// Proves the trust-safety model from audit/AUDIO_PROMPTS_MODERATION.md:
//   • Companion PUT/confirm creates a 'pending_review' row; a FREE member is 402.
//   • Empty transcript → 400, NO row created.
//   • A non-owner (public profile view) NEVER sees pending audio — only approved.
//   • Approve makes it public; reject requires a note + is terminal (409 re-action).
//   • DELETE /audio/:id works for a FREE (downgraded) owner + hard-deletes R2.
//   • deleteUserRows collects profile_audio R2 keys; /export bundles audio+transcript.
//   • Report-an-audio writes reported_audio_id + a transcript snapshot.
//   • pendingProfileAudio surfaces in /admin/stats + /admin/queue-counts.
//   • The transcript runs through the off-platform/scam detector (signal logged).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-audio-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-audio-suite';
process.env.NODE_ENV = 'test';

// R2 mock — configured; records deleted keys; a storage_key ending 'BAD' can't
// be read (for the export best-effort-skip path).
const h = vi.hoisted(() => ({
  deleted: [],
  bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // webm magic-ish
}));
vi.mock('../src/storage/r2.js', () => ({
  r2Configured: () => true,
  getPresignedUploadUrl: async (key) => `https://upload/${key}`,
  getPresignedGetUrl: async (key) => `https://presigned-get/${key}?sig=abc`,
  getPublicUrl: (key) => `https://cdn/${key}`,
  getObjectBytes: async (key) => {
    if (key.endsWith('BAD')) throw new Error('object not found');
    return h.bytes;
  },
  deleteObject: async (key) => { h.deleted.push(key); },
}));

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const { setEntitlement } = await import('../src/billing/entitlements.js');
const { deleteUserRows } = await import('../src/data/deleteUser.js');
const audioRouter = (await import('../src/routes/audio.js'));
const profileRouter = (await import('../src/routes/profile.js')).default;
const messagingRouter = (await import('../src/routes/messaging.js')).default;
const exportRouter = (await import('../src/routes/export.js')).default;
const adminRouter = (await import('../src/routes/admin.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ email, admin = false } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, is_admin) VALUES (?,?,?,?,0,?)')
    .run(id, em, 'x', Date.now(), admin ? 1 : 0);
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, `Name ${id}`, Date.now());
  return id;
}

function grantCompanion(id) {
  setEntitlement(db, id, { tier: 'companion', status: 'active', source: 'admin_demo' });
}

function matchUsers(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?, ?, ?, ?, NULL)')
    .run(`m${++uid}`, ua, ub, Date.now());
}

// Insert an audio row directly (bypasses R2/confirm) for tests that exercise the
// admin/report/export/delete paths.
function addAudio(userId, { promptKey = 'talk_for_hours', transcript = 'I love trains.', status = 'pending_review', position = 0 } = {}) {
  const id = `a${++uid}`;
  const key = `profile-audio/${userId}/${id}.webm`;
  db.prepare(
    `INSERT INTO profile_audio (id, user_id, prompt_key, storage_key, url, transcript, duration_ms, mime_type, review_status, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'audio/webm', ?, ?, ?)`
  ).run(id, userId, promptKey, key, `https://cdn/${key}`, transcript, 5000, status, position, Date.now());
  return { id, key };
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  app.use('/audio', audioRouter.default);
  app.use('/admin', audioRouter.adminAudioRouter);
  app.use('/admin', adminRouter);
  app.use('/profile', profileRouter);
  app.use('/messaging', messagingRouter);
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

describe('record/confirm gating (Companion) + transcript keystone', () => {
  it('Companion upload-url → key, then confirm creates a pending_review row', async () => {
    const me = makeUser(); grantCompanion(me);
    const up = await api('/audio/profile-upload-url', {
      token: tok(me), method: 'POST',
      body: { mimeType: 'audio/webm', fileSizeBytes: 100000, durationMs: 8000 },
    });
    expect(up.status).toBe(200);
    expect(up.json.key).toMatch(new RegExp(`^profile-audio/${me}/`));

    const conf = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key: up.json.key, promptKey: 'talk_for_hours', transcript: 'I could talk for hours about trains.', durationMs: 8000 },
    });
    expect(conf.status).toBe(201);
    expect(conf.json.status).toBe('pending_review');

    const row = db.prepare('SELECT review_status, transcript FROM profile_audio WHERE id = ?').get(conf.json.id);
    expect(row.review_status).toBe('pending_review');
    expect(row.transcript).toContain('trains');
  });

  it('a FREE member is 402 on upload-url AND on confirm (record is Companion)', async () => {
    const free = makeUser(); // no subscription => free
    const up = await api('/audio/profile-upload-url', {
      token: tok(free), method: 'POST',
      body: { mimeType: 'audio/webm', fileSizeBytes: 100000 },
    });
    expect(up.status).toBe(402);

    const conf = await api('/audio/profile-confirm', {
      token: tok(free), method: 'POST',
      body: { key: `profile-audio/${free}/x.webm`, promptKey: 'talk_for_hours', transcript: 'hi' },
    });
    expect(conf.status).toBe(402);
  });

  it('empty/whitespace transcript → 400 and NO row is created', async () => {
    const me = makeUser(); grantCompanion(me);
    const before = db.prepare('SELECT COUNT(*) AS n FROM profile_audio WHERE user_id = ?').get(me).n;
    const conf = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key: `profile-audio/${me}/x.webm`, promptKey: 'talk_for_hours', transcript: '   ' },
    });
    expect(conf.status).toBe(400);
    const after = db.prepare('SELECT COUNT(*) AS n FROM profile_audio WHERE user_id = ?').get(me).n;
    expect(after).toBe(before);
  });

  it('rejects a key that is not the caller-owned prefix (403)', async () => {
    const me = makeUser(); grantCompanion(me);
    const other = makeUser();
    const conf = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key: `profile-audio/${other}/x.webm`, promptKey: 'talk_for_hours', transcript: 'hello' },
    });
    expect(conf.status).toBe(403);
  });

  it('L3: rejects a malformed key (traversal / extra segment / bad ext) even under the owner prefix (403)', async () => {
    const me = makeUser(); grantCompanion(me);
    for (const key of [
      `profile-audio/${me}/../x.webm`,      // traversal segment
      `profile-audio/${me}/sub/x.webm`,     // extra path segment
      `profile-audio/${me}/x.exe`,          // disallowed extension
      `profile-audio/${me}/x`,              // no extension
    ]) {
      const conf = await api('/audio/profile-confirm', {
        token: tok(me), method: 'POST',
        body: { key, promptKey: 'talk_for_hours', transcript: 'hello there' },
      });
      expect(conf.status).toBe(403);
    }
  });

  it('L3: rejects re-confirming a storage key that already backs a row (409)', async () => {
    const me = makeUser(); grantCompanion(me);
    const key = `profile-audio/${me}/dup.webm`;
    const first = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key, promptKey: 'talk_for_hours', transcript: 'first answer' },
    });
    expect(first.status).toBe(201);
    const second = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key, promptKey: 'a_perfect_day', transcript: 'second answer, same key' },
    });
    expect(second.status).toBe(409); // one object → one row
  });

  it('logs an off-platform safety signal when the transcript trips the detector', async () => {
    const me = makeUser(); grantCompanion(me);
    const conf = await api('/audio/profile-confirm', {
      token: tok(me), method: 'POST',
      body: { key: `profile-audio/${me}/scam.webm`, promptKey: 'a_perfect_day', transcript: 'add me on telegram to chat more' },
    });
    expect(conf.status).toBe(201);
    const sig = db.prepare('SELECT signal_kind, message_id FROM chat_safety_signals WHERE user_id = ?').get(me);
    expect(sig).toBeTruthy();
    expect(sig.signal_kind).toBe('off_platform');
    expect(sig.message_id).toBe(conf.json.id);
  });
});

describe('approved-only serving (human-review-before-serve)', () => {
  it('a matched viewer sees ONLY approved audio — never pending/rejected', async () => {
    const owner = makeUser(); grantCompanion(owner);
    const viewer = makeUser();
    matchUsers(owner, viewer);

    const approved = addAudio(owner, { promptKey: 'talk_for_hours', transcript: 'APPROVED CLIP', status: 'approved' });
    addAudio(owner, { promptKey: 'a_perfect_day', transcript: 'PENDING CLIP', status: 'pending_review', position: 1 });
    addAudio(owner, { promptKey: 'green_flags', transcript: 'REJECTED CLIP', status: 'rejected', position: 2 });

    const view = await api(`/profile/${owner}`, { token: tok(viewer) });
    expect(view.status).toBe(200);
    const transcripts = view.json.audio.map((a) => a.transcript);
    expect(transcripts).toEqual(['APPROVED CLIP']);
    expect(view.json.audio[0].promptKey).toBe('talk_for_hours');
    // The approved clip's URL and transcript are both present (FREE to view).
    expect(view.json.audio[0].url).toContain(approved.key);
  });

  it('the owner sees their own pending clips (no public URL leaked for pending)', async () => {
    const owner = makeUser(); grantCompanion(owner);
    addAudio(owner, { status: 'pending_review' });
    const mine = await api('/audio/mine', { token: tok(owner) });
    expect(mine.status).toBe(200);
    expect(mine.json.audio).toHaveLength(1);
    expect(mine.json.audio[0].pending).toBe(true);
    expect(mine.json.audio[0].url).toBe(''); // pending never exposes its stable URL
  });
});

describe('pending-clip access protection (presigned GET, owner/admin only)', () => {
  it('non-owner gets 404 for a pending clip playback URL; owner gets a presigned URL', async () => {
    const owner = makeUser(); grantCompanion(owner);
    const stranger = makeUser();
    const { id } = addAudio(owner, { status: 'pending_review' });

    const asStranger = await api(`/audio/${id}/playback-url`, { token: tok(stranger) });
    expect(asStranger.status).toBe(404);

    const asOwner = await api(`/audio/${id}/playback-url`, { token: tok(owner) });
    expect(asOwner.status).toBe(200);
    expect(asOwner.json.url).toContain('presigned-get');
  });

  it('an admin can fetch a presigned playback URL for any pending clip', async () => {
    const owner = makeUser(); grantCompanion(owner);
    const admin = makeUser({ email: 'mod@t.dev', admin: true });
    const { id } = addAudio(owner, { status: 'pending_review' });
    const asAdmin = await api(`/audio/${id}/playback-url`, { token: tok(admin) });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.json.url).toContain('presigned-get');
  });
});

describe('DELETE /audio/:id — ungated, owner-only, hard delete', () => {
  it('a FREE (downgraded) owner can delete their own clip + the R2 object is removed', async () => {
    const owner = makeUser(); // FREE — never granted Companion
    const { id, key } = addAudio(owner, { status: 'approved' });
    h.deleted.length = 0;
    const del = await api(`/audio/${id}`, { token: tok(owner), method: 'DELETE' });
    expect(del.status).toBe(200);
    const row = db.prepare('SELECT id FROM profile_audio WHERE id = ?').get(id);
    expect(row).toBeUndefined();
    expect(h.deleted).toContain(key);
  });

  it('a non-owner cannot delete someone else\'s clip (404)', async () => {
    const owner = makeUser();
    const stranger = makeUser();
    const { id } = addAudio(owner);
    const del = await api(`/audio/${id}`, { token: tok(stranger), method: 'DELETE' });
    expect(del.status).toBe(404);
    expect(db.prepare('SELECT id FROM profile_audio WHERE id = ?').get(id)).toBeTruthy();
  });
});

describe('admin review — approve/reject terminal + note gate', () => {
  it('approve makes the clip servable to a viewer', async () => {
    const owner = makeUser(); const viewer = makeUser(); const admin = makeUser({ email: 'mod2@t.dev', admin: true });
    matchUsers(owner, viewer);
    const { id } = addAudio(owner, { transcript: 'NOW APPROVED', status: 'pending_review' });

    const rev = await api(`/admin/profile-audio/${id}/review`, { token: tok(admin), method: 'POST', body: { decision: 'approve' } });
    expect(rev.status).toBe(200);
    expect(rev.json.status).toBe('approved');

    const view = await api(`/profile/${owner}`, { token: tok(viewer) });
    expect(view.json.audio.map((a) => a.transcript)).toContain('NOW APPROVED');

    const logged = db.prepare("SELECT action FROM moderation_log WHERE target_id = ? AND action = 'approve_profile_audio'").get(id);
    expect(logged).toBeTruthy();
  });

  it('reject REQUIRES a note (400 without) and is terminal (409 on re-action)', async () => {
    const owner = makeUser(); const admin = makeUser({ email: 'mod3@t.dev', admin: true });
    const { id, key } = addAudio(owner, { status: 'pending_review' });
    h.deleted.length = 0;

    const noNote = await api(`/admin/profile-audio/${id}/review`, { token: tok(admin), method: 'POST', body: { decision: 'reject' } });
    expect(noNote.status).toBe(400);

    const rejected = await api(`/admin/profile-audio/${id}/review`, { token: tok(admin), method: 'POST', body: { decision: 'reject', note: 'explicit content' } });
    expect(rejected.status).toBe(200);
    expect(rejected.json.status).toBe('rejected');
    expect(h.deleted).toContain(key); // reject removes the R2 object

    // Terminal: a second action on the now-rejected clip is a 409.
    const again = await api(`/admin/profile-audio/${id}/review`, { token: tok(admin), method: 'POST', body: { decision: 'approve' } });
    expect(again.status).toBe(409);
  });

  it('the pending queue lists clips with owner context + transcript, newest first', async () => {
    const owner = makeUser(); const admin = makeUser({ email: 'mod4@t.dev', admin: true });
    addAudio(owner, { transcript: 'QUEUE ME', status: 'pending_review' });
    const q = await api('/admin/profile-audio/pending', { token: tok(admin) });
    expect(q.status).toBe(200);
    const mine = q.json.audio.find((a) => a.transcript === 'QUEUE ME');
    expect(mine).toBeTruthy();
    expect(mine.ownerEmail).toBeTruthy();
    expect(mine.promptKey).toBeTruthy();
  });

  it('the audio review endpoints are admin-gated (403 for a member)', async () => {
    const member = makeUser();
    const q = await api('/admin/profile-audio/pending', { token: tok(member) });
    expect(q.status).toBe(403);
  });

  it('excludes test/demo-account clips from the pending queue, keeps real ones', async () => {
    const admin = makeUser({ email: 'mod-excl@t.dev', admin: true });
    const testAcct = makeUser({ email: `qa+aud${++uid}@spectrum-test.dev` });
    const demoAcct = makeUser({ email: `telemetry-demo-${++uid}@sample.spectrum-dating.app` });
    const realAcct = makeUser();
    addAudio(testAcct, { transcript: 'TEST_CLIP_EXCL', status: 'pending_review' });
    addAudio(demoAcct, { transcript: 'DEMO_CLIP_EXCL', status: 'pending_review' });
    addAudio(realAcct, { transcript: 'REAL_CLIP_KEEP', status: 'pending_review' });

    const q = await api('/admin/profile-audio/pending', { token: tok(admin) });
    expect(q.status).toBe(200);
    const transcripts = q.json.audio.map((a) => a.transcript);
    expect(transcripts).toContain('REAL_CLIP_KEEP');
    expect(transcripts).not.toContain('TEST_CLIP_EXCL');
    expect(transcripts).not.toContain('DEMO_CLIP_EXCL');
  });
});

describe('queue-depth counts', () => {
  it('pendingProfileAudio appears in /admin/stats and /admin/queue-counts', async () => {
    const admin = makeUser({ email: 'mod5@t.dev', admin: true });
    const owner = makeUser();
    addAudio(owner, { status: 'pending_review' });

    const stats = await api('/admin/stats', { token: tok(admin) });
    expect(stats.status).toBe(200);
    expect(stats.json).toHaveProperty('pendingProfileAudio');
    expect(stats.json.pendingProfileAudio).toBeGreaterThan(0);
    expect(stats.json).toHaveProperty('oldestPendingProfileAudioAt');

    const qc = await api('/admin/queue-counts', { token: tok(admin) });
    expect(qc.status).toBe(200);
    expect(qc.json).toHaveProperty('pendingProfileAudio');
    expect(qc.json.pendingProfileAudio).toBeGreaterThan(0);
  });
});

describe('report-an-audio', () => {
  it('writes reported_audio_id + a transcript snapshot and soft-holds the clip', async () => {
    const owner = makeUser();
    const reporter = makeUser();
    matchUsers(owner, reporter);
    const { id } = addAudio(owner, { transcript: 'EVIDENCE TRANSCRIPT', status: 'approved' });

    const rep = await api('/messaging/report', {
      token: tok(reporter), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(rep.status).toBe(201);

    const report = db.prepare('SELECT reported_audio_id, reported_audio_transcript FROM reports WHERE reported_audio_id = ?').get(id);
    expect(report).toBeTruthy();
    expect(report.reported_audio_transcript).toBe('EVIDENCE TRANSCRIPT');
    // Soft-held: no longer 'approved', re-enters the pending queue.
    const clip = db.prepare('SELECT review_status FROM profile_audio WHERE id = ?').get(id);
    expect(clip.review_status).toBe('pending_review');
  });

  it('refuses to reference a clip that is not approved / not owned by the reported user (400)', async () => {
    const owner = makeUser();
    const reporter = makeUser();
    matchUsers(owner, reporter);
    const { id } = addAudio(owner, { status: 'pending_review' }); // not approved → not visible
    const rep = await api('/messaging/report', {
      token: tok(reporter), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(rep.status).toBe(400);
  });

  it('M1: refuses report-an-audio from a user with no live match to the owner (400, no soft-hold)', async () => {
    const owner = makeUser();
    const stranger = makeUser(); // deliberately NOT matched
    const { id } = addAudio(owner, { transcript: 'X', status: 'approved' });
    const rep = await api('/messaging/report', {
      token: tok(stranger), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(rep.status).toBe(400);
    // an unauthorized reporter must NOT be able to soft-hold the clip
    expect(db.prepare('SELECT review_status FROM profile_audio WHERE id = ?').get(id).review_status).toBe('approved');
  });

  it('M1 anti-flap: the same reporter cannot report the same clip twice, even after re-approval (400)', async () => {
    const owner = makeUser();
    const reporter = makeUser();
    matchUsers(owner, reporter);
    const { id } = addAudio(owner, { transcript: 'X', status: 'approved' });
    const first = await api('/messaging/report', {
      token: tok(reporter), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(first.status).toBe(201);
    // Simulate an admin re-approving the soft-held clip.
    db.prepare("UPDATE profile_audio SET review_status = 'approved' WHERE id = ?").run(id);
    const second = await api('/messaging/report', {
      token: tok(reporter), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(second.status).toBe(400); // dedup blocks the re-report
    expect(db.prepare('SELECT review_status FROM profile_audio WHERE id = ?').get(id).review_status).toBe('approved'); // not re-flapped
  });

  it('surfaces the audio transcript to moderators in BOTH the reports list and /context', async () => {
    const admin = makeUser({ email: 'modaudio@t.dev', admin: true });
    const owner = makeUser();
    const reporter = makeUser();
    matchUsers(owner, reporter);
    const { id } = addAudio(owner, { transcript: 'GROOMING EVIDENCE TRANSCRIPT', status: 'approved' });

    const rep = await api('/messaging/report', {
      token: tok(reporter), method: 'POST',
      body: { reportedUserId: owner, reason: 'inappropriate', audioId: id },
    });
    expect(rep.status).toBe(201);

    // The report has no conversation — the transcript is the ONLY evidence.
    const list = await api('/admin/reports?status=open', { token: tok(admin) });
    expect(list.status).toBe(200);
    const card = list.json.reports.find((r) => r.reportedAudioId === id);
    expect(card).toBeTruthy();
    expect(card.conversationId).toBeFalsy();
    expect(card.reportedAudioTranscript).toBe('GROOMING EVIDENCE TRANSCRIPT');

    // /context returns the transcript so the evidence panel isn't empty.
    const ctx = await api(`/admin/reports/${card.id}/context`, { token: tok(admin) });
    expect(ctx.status).toBe(200);
    expect(ctx.json.messages).toEqual([]);
    expect(ctx.json.reportedAudioTranscript).toBe('GROOMING EVIDENCE TRANSCRIPT');
    expect(ctx.json.reportedAudioId).toBe(id);

    // B8: the single-report drill-down carries the same evidence, not less.
    const detail = await api(`/admin/reports/${card.id}`, { token: tok(admin) });
    expect(detail.status).toBe(200);
    expect(detail.json.report.reportedAudioTranscript).toBe('GROOMING EVIDENCE TRANSCRIPT');
  });
});

describe('account-deletion cascade + data export', () => {
  it('deleteUserRows returns the audio R2 keys and the rows cascade away', async () => {
    const owner = makeUser();
    const { key } = addAudio(owner, { status: 'approved' });
    addAudio(owner, { promptKey: 'a_perfect_day', status: 'pending_review', position: 1 });

    const keys = deleteUserRows(db, owner);
    expect(keys).toContain(key);
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM profile_audio WHERE user_id = ?').get(owner).n;
    expect(remaining).toBe(0);
  });

  it('/export/archive bundles an approved audio file + its transcript', async () => {
    const me = makeUser();
    addAudio(me, { transcript: 'MY VOICE ANSWER', status: 'approved' });

    const res = await fetch(`${baseUrl}/export/archive`, { headers: { authorization: `Bearer ${tok(me)}` } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.startsWith('audio/'))).toBe(true);

    const html = zip.getEntry('index.html').getData().toString('utf8');
    expect(html).toContain('Your voice answers');
    expect(html).toContain('MY VOICE ANSWER');

    const data = JSON.parse(zip.getEntry('data.json').getData().toString('utf8'));
    expect(data.audio.included).toBeGreaterThan(0);
    expect(data.profile.audio[0].transcript).toBe('MY VOICE ANSWER');
  });
});
