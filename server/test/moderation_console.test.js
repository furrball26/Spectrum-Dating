// Moderation Console overhaul (Phase 0 + Phase 1) backend tests. Boots a minimal
// app wired like src/index.js against a throwaway on-disk SQLite DB and drives it
// over HTTP, mirroring safety-batch.test.js. Proves the resolute-resolve guard,
// idempotency guards, note persistence, real-count filtering, verified join, the
// suspend↔report auto-close, repeat-offender history, the conversation-context
// endpoint, and the report-create evidence snapshot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-mod-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-moderation-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb, runMigrations } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminRouter = (await import('../src/routes/admin.js')).default;
const messagingRouter = (await import('../src/routes/messaging.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

function makeUser({ email, suspended = 0, verified = 0, createdAt = Date.now() } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,?)')
    .run(id, em, 'x', createdAt, suspended);
  db.prepare('INSERT INTO profiles (user_id, display_name, identity_verified, updated_at) VALUES (?,?,?,?)')
    .run(id, `Name ${id}`, verified, Date.now());
  return id;
}

function makeReport(reportedId, reporterId, { status = 'open', conversationId = null, reportedMessage = null } = {}) {
  const id = `r${++uid}`;
  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, conversation_id, reason, details, status, created_at, reported_message)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, reporterId, reportedId, conversationId, 'harassment', 'details here', status, Date.now(), reportedMessage);
  return id;
}

function makeConversation(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const mid = `m${++uid}`;
  db.prepare('INSERT INTO matches (id, user_a_id, user_b_id, matched_at, ended_at) VALUES (?,?,?,?,NULL)')
    .run(mid, ua, ub, Date.now());
  const cid = `c${++uid}`;
  db.prepare('INSERT INTO conversations (id, match_id, user_a_id, user_b_id, created_at) VALUES (?,?,?,?,?)')
    .run(cid, mid, ua, ub, Date.now());
  return cid;
}

function addMessage(cid, senderId, body) {
  const id = `msg${++uid}`;
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, body, deleted, sent_at) VALUES (?,?,?,?,0,?)')
    .run(id, cid, senderId, body, Date.now());
  return id;
}

function addBlock(blockerId, blockedId) {
  db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?,?,?,?,?)')
    .run(`blk${++uid}`, blockerId, blockedId, 'harassment', Date.now());
}

function logCount(action, targetId) {
  return db.prepare('SELECT COUNT(*) AS c FROM moderation_log WHERE action = ? AND target_id = ?')
    .get(action, targetId).c;
}

function lastDetail(action, targetId) {
  return db.prepare('SELECT detail FROM moderation_log WHERE action = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(action, targetId)?.detail;
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

const adminToken = () => signToken(adminId, 0);

beforeAll(async () => {
  adminId = makeUser({ email: 'admin@t.dev' });
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/admin', adminRouter);
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

// ---------------------------------------------------------------------------
// Migrations 043 / 044 boot clean and add the two columns (ADD COLUMN only).
// ---------------------------------------------------------------------------
describe('migrations 043 / 044 (resolute reports + evidence snapshot)', () => {
  function freshDb() {
    const dir = mkdtempSync(join(tmpdir(), 'spectrum-mod-mig-'));
    const d = new Database(join(dir, 'm.db'));
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    return { d, dir };
  }
  function hasCol(d, table, col) {
    return d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }

  it('boots clean on a fresh DB and adds reports.resolved_by + reports.reported_message', () => {
    const { d, dir } = freshDb();
    try {
      expect(() => runMigrations(d)).not.toThrow();
      expect(hasCol(d, 'reports', 'resolved_by')).toBe(true);
      expect(hasCol(d, 'reports', 'reported_message')).toBe(true);
      // Needed #10 (050): the pinned-message columns are added ADD-COLUMN only.
      expect(hasCol(d, 'reports', 'reported_message_id')).toBe(true);
      expect(hasCol(d, 'reports', 'pinned_message')).toBe(true);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — a second and third run do not throw or drop the columns', () => {
    const { d, dir } = freshDb();
    try {
      runMigrations(d);
      runMigrations(d);
      expect(() => runMigrations(d)).not.toThrow();
      expect(hasCol(d, 'reports', 'resolved_by')).toBe(true);
      expect(hasCol(d, 'reports', 'reported_message')).toBe(true);
      // Needed #10 (050): pinned-message columns survive repeated boots.
      expect(hasCol(d, 'reports', 'reported_message_id')).toBe(true);
      expect(hasCol(d, 'reports', 'pinned_message')).toBe(true);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B-C: resolute reports.
// ---------------------------------------------------------------------------
describe('B-C resolute reports', () => {
  it('writes resolved_by and serializes resolvedBy on the reports list', async () => {
    const reported = makeUser();
    const reporter = makeUser();
    const id = makeReport(reported, reporter);

    const r = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'actioned', note: 'banned for slurs' },
    });
    expect(r.status).toBe(200);

    const row = db.prepare('SELECT resolved_by, moderator_note, status FROM reports WHERE id = ?').get(id);
    expect(row.resolved_by).toBe(adminId);
    expect(row.moderator_note).toBe('banned for slurs');
    expect(row.status).toBe('actioned');

    const list = await api('/admin/reports?status=all', { token: adminToken() });
    const serialized = list.json.reports.find((x) => x.id === id);
    expect(serialized.resolvedBy).not.toBeNull();
    expect(serialized.resolvedBy.userId).toBe(adminId);
    expect(serialized.resolvedBy.email).toBe('admin@t.dev');
  });

  it('re-resolving a terminal report returns 409 (decision is final)', async () => {
    const reported = makeUser();
    const id = makeReport(reported, makeUser());
    await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'dismissed', note: 'not a violation' },
    });
    const again = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'actioned', note: 'changed my mind' },
    });
    expect(again.status).toBe(409);
    // The original decision is untouched.
    const row = db.prepare('SELECT status, moderator_note FROM reports WHERE id = ?').get(id);
    expect(row.status).toBe('dismissed');
    expect(row.moderator_note).toBe('not a violation');
  });

  it('resolve to actioned/dismissed WITHOUT a note returns 400', async () => {
    const id = makeReport(makeUser(), makeUser());
    const a = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'actioned' },
    });
    expect(a.status).toBe(400);
    const b = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'dismissed', note: '   ' },
    });
    expect(b.status).toBe(400);
    // Still open — nothing was written.
    expect(db.prepare('SELECT status FROM reports WHERE id = ?').get(id).status).toBe('open');
  });

  it("'reviewed' is not terminal: noteless review allowed, then still actionable", async () => {
    const id = makeReport(makeUser(), makeUser());
    const rev = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'reviewed' },
    });
    expect(rev.status).toBe(200);
    // Reviewed drops out of the Open filter but can still be actioned.
    const act = await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'actioned', note: 'confirmed' },
    });
    expect(act.status).toBe(200);
    expect(db.prepare('SELECT status FROM reports WHERE id = ?').get(id).status).toBe('actioned');
  });

  it('resolved reports drop out of the Open filter (behavior preserved)', async () => {
    const id = makeReport(makeUser(), makeUser());
    await api(`/admin/reports/${id}/resolve`, {
      token: adminToken(), method: 'POST', body: { status: 'actioned', note: 'x' },
    });
    const open = await api('/admin/reports?status=open', { token: adminToken() });
    expect(open.json.reports.some((x) => x.id === id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-D: idempotency guards (suspend / verify).
// ---------------------------------------------------------------------------
describe('B-D idempotency guards', () => {
  it('suspend is idempotent: 409 on repeat, audit row only on the real change', async () => {
    const target = makeUser();
    const first = await api(`/admin/users/${target}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, note: 'spam' },
    });
    expect(first.status).toBe(200);
    expect(logCount('suspend', target)).toBe(1);

    const repeat = await api(`/admin/users/${target}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, note: 'spam again' },
    });
    expect(repeat.status).toBe(409);
    // No second audit row written for a no-op.
    expect(logCount('suspend', target)).toBe(1);
  });

  it('verify is idempotent: 409 when already in the target state, no audit row', async () => {
    const target = makeUser({ verified: 1 });
    const r = await api(`/admin/users/${target}/verify`, {
      token: adminToken(), method: 'POST', body: { verified: true },
    });
    expect(r.status).toBe(409);
    expect(logCount('verify', target)).toBe(0);
  });

  it('verify writes an audit row only on an actual change', async () => {
    const target = makeUser({ verified: 0 });
    const r = await api(`/admin/users/${target}/verify`, {
      token: adminToken(), method: 'POST', body: { verified: true, note: 'ID checked' },
    });
    expect(r.status).toBe(200);
    expect(logCount('verify', target)).toBe(1);
  });

  it('rejecting a PENDING verification request succeeds and clears the queue (not a 409 no-op)', async () => {
    // Regression: the verify guard used to 409 whenever identity_verified already
    // matched `verified`. A pending user has identity_verified=0, so rejecting
    // (verified:false) 409'd BEFORE advancing verification_requests → the request
    // re-surfaced in the pending queue forever. The guard must look at the request
    // status too: rejecting a pending request is a real action.
    const target = makeUser({ verified: 0 });
    db.prepare(
      'INSERT INTO verification_requests (id, user_id, status, requested_at) VALUES (?,?,?,?)'
    ).run(`vr${target}`, target, 'pending', Date.now());

    const r = await api(`/admin/users/${target}/verify`, {
      token: adminToken(), method: 'POST', body: { verified: false, note: 'blurry ID' },
    });
    expect(r.status).toBe(200);
    // The queue row moved to 'rejected' — it no longer surfaces as pending.
    const reqRow = db.prepare('SELECT status FROM verification_requests WHERE user_id = ?').get(target);
    expect(reqRow.status).toBe('rejected');
    // identity_verified stays 0 (unchanged), and an audit row was written.
    const prof = db.prepare('SELECT identity_verified FROM profiles WHERE user_id = ?').get(target);
    expect(prof.identity_verified).toBe(0);
    expect(logCount('unverify', target)).toBe(1);
  });

  it('verify still 409s a true no-op: unverify with no request and already unverified', async () => {
    const target = makeUser({ verified: 0 });
    const r = await api(`/admin/users/${target}/verify`, {
      token: adminToken(), method: 'POST', body: { verified: false, note: 'n/a' },
    });
    expect(r.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// B-E: notes flow into moderation_log.detail.
// ---------------------------------------------------------------------------
describe('B-E notes on destructive actions', () => {
  it('suspend requires a note (400 without) and persists it to the audit detail', async () => {
    const target = makeUser();
    const missing = await api(`/admin/users/${target}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true },
    });
    expect(missing.status).toBe(400);
    expect(db.prepare('SELECT suspended FROM users WHERE id = ?').get(target).suspended).toBe(0);

    const ok = await api(`/admin/users/${target}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, reason: 'repeated harassment' },
    });
    expect(ok.status).toBe(200);
    expect(lastDetail('suspend', target)).toBe('repeated harassment');
  });
});

// ---------------------------------------------------------------------------
// B-A / B-B: real counts + richer stats.
// ---------------------------------------------------------------------------
describe('B-A / B-B /admin/stats', () => {
  it('member count EXCLUDES test/demo accounts and reports them as testAccounts', async () => {
    const before = (await api('/admin/stats', { token: adminToken() })).json;

    makeUser({ email: 'real-new@example.com' });
    makeUser({ email: 'seed1@spectrum-test.dev' });
    makeUser({ email: 'demo1@sample.spectrum-dating.app' });

    const after = (await api('/admin/stats', { token: adminToken() })).json;
    // Only the ONE real user grew the member count; the two test/demo did not.
    expect(after.members).toBe(before.members + 1);
    expect(after.totalUsers).toBe(after.members); // alias
    expect(after.testAccounts).toBe(before.testAccounts + 2);
  });

  it('returns the full report breakdown and per-queue pending depths', async () => {
    const stats = (await api('/admin/stats', { token: adminToken() })).json;
    expect(stats.reports).toHaveProperty('open');
    expect(stats.reports).toHaveProperty('reviewed');
    expect(stats.reports).toHaveProperty('actioned');
    expect(stats.reports).toHaveProperty('dismissed');
    expect(stats).toHaveProperty('pendingAttachments');
    expect(stats).toHaveProperty('pendingProfilePhotos');
    expect(stats).toHaveProperty('pendingVerifications');
    expect(stats).toHaveProperty('oldestOpenReportAt');
  });

  it('pending profile-photo count + oldest-pending timestamp track the queue', async () => {
    const owner = makeUser();
    const t0 = Date.now();
    db.prepare(
      'INSERT INTO profile_photos (id, user_id, storage_key, url, position, is_primary, review_status, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(`pp${++uid}`, owner, 'k', 'https://x/p.jpg', 0, 0, 'pending_review', t0);

    const stats = (await api('/admin/stats', { token: adminToken() })).json;
    expect(stats.pendingProfilePhotos).toBeGreaterThanOrEqual(1);
    expect(stats.oldestPendingProfilePhotoAt).toBeLessThanOrEqual(t0);
  });
});

// ---------------------------------------------------------------------------
// v3 — GET /admin/queue-counts: the counts-only sibling the "Live counts" poll
// hits. Admin-gated; returns ONLY the triage depths + oldest-pending epochs, and
// tracks the queue exactly like /admin/stats (so a merge is faithful).
// ---------------------------------------------------------------------------
describe('v3 /admin/queue-counts', () => {
  it('requires an admin (401 without a token)', async () => {
    const r = await api('/admin/queue-counts');
    expect(r.status).toBe(401);
  });

  it('returns the four triage depths + oldest epochs, and NOT the heavy fields', async () => {
    const r = await api('/admin/queue-counts', { token: adminToken() });
    expect(r.status).toBe(200);
    expect(r.json.reports).toHaveProperty('open');
    expect(r.json).toHaveProperty('pendingAttachments');
    expect(r.json).toHaveProperty('pendingProfilePhotos');
    expect(r.json).toHaveProperty('pendingVerifications');
    expect(r.json).toHaveProperty('oldestOpenReportAt');
    expect(r.json).toHaveProperty('oldestPendingVerificationAt');
    // Counts-only: none of /admin/stats's member/activity scans leak in.
    expect(r.json).not.toHaveProperty('members');
    expect(r.json).not.toHaveProperty('totalMessages');
    expect(r.json).not.toHaveProperty('totalMatches');
  });

  it('open-report depth agrees with /admin/stats and grows with a new open report', async () => {
    const before = (await api('/admin/queue-counts', { token: adminToken() })).json;
    const stats = (await api('/admin/stats', { token: adminToken() })).json;
    expect(before.reports.open).toBe(stats.reports.open);

    const t0 = Date.now();
    makeReport(makeUser(), makeUser(), { status: 'open' });

    const after = (await api('/admin/queue-counts', { token: adminToken() })).json;
    expect(after.reports.open).toBe(before.reports.open + 1);
    expect(after.oldestOpenReportAt).toBeLessThanOrEqual(t0);
  });
});

// ---------------------------------------------------------------------------
// B-F: verified badge join.
// ---------------------------------------------------------------------------
describe('B-F verified join', () => {
  it('reported.verified is true for a verified reported user, false otherwise', async () => {
    const verifiedUser = makeUser({ verified: 1 });
    const plainUser = makeUser({ verified: 0 });
    const idV = makeReport(verifiedUser, makeUser());
    const idP = makeReport(plainUser, makeUser());

    const list = (await api('/admin/reports?status=open', { token: adminToken() })).json.reports;
    expect(list.find((x) => x.id === idV).reported.verified).toBe(true);
    expect(list.find((x) => x.id === idP).reported.verified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-D: suspend auto-closes sibling open reports.
// ---------------------------------------------------------------------------
describe('P1-D suspend↔report auto-close', () => {
  it('suspending a user actions their OPEN reports but leaves terminal ones alone', async () => {
    const bad = makeUser();
    const openA = makeReport(bad, makeUser(), { status: 'open' });
    const openB = makeReport(bad, makeUser(), { status: 'open' });
    const alreadyDismissed = makeReport(bad, makeUser(), { status: 'dismissed' });
    // First give the dismissed one a resolver-note so we can prove it's untouched.
    db.prepare("UPDATE reports SET moderator_note = 'prior call' WHERE id = ?").run(alreadyDismissed);

    const r = await api(`/admin/users/${bad}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, note: 'ban' },
    });
    expect(r.status).toBe(200);
    expect(r.json.autoClosedReports).toBe(2);

    expect(db.prepare('SELECT status FROM reports WHERE id = ?').get(openA).status).toBe('actioned');
    expect(db.prepare('SELECT status, resolved_by FROM reports WHERE id = ?').get(openB).resolved_by).toBe(adminId);
    // Terminal report untouched.
    const dm = db.prepare('SELECT status, moderator_note FROM reports WHERE id = ?').get(alreadyDismissed);
    expect(dm.status).toBe('dismissed');
    expect(dm.moderator_note).toBe('prior call');
  });
});

// ---------------------------------------------------------------------------
// P1-B: repeat-offender history.
// ---------------------------------------------------------------------------
describe('P1-B repeat-offender history', () => {
  it('/admin/users/:id/history counts reports, actioned, and distinct blockers', async () => {
    const bad = makeUser({ createdAt: Date.now() - 1000 });
    makeReport(bad, makeUser(), { status: 'open' });
    makeReport(bad, makeUser(), { status: 'actioned' });
    makeReport(bad, makeUser(), { status: 'actioned' });
    addBlock(makeUser(), bad);
    addBlock(makeUser(), bad);

    const h = (await api(`/admin/users/${bad}/history`, { token: adminToken() })).json;
    expect(h.reportsAgainst).toBe(3);
    expect(h.reportsActioned).toBe(2);
    expect(h.distinctBlockers).toBe(2);
    expect(h.accountCreatedAt).toBeLessThan(Date.now());
  });

  it('per-report cards carry the reported user counts', async () => {
    const bad = makeUser();
    makeReport(bad, makeUser(), { status: 'actioned' });
    const focus = makeReport(bad, makeUser(), { status: 'open' });
    addBlock(makeUser(), bad);

    const list = (await api('/admin/reports?status=all', { token: adminToken() })).json.reports;
    const card = list.find((x) => x.id === focus);
    expect(card.reported.reportCount).toBe(2);
    expect(card.reported.actionedCount).toBe(1);
    expect(card.reported.blockedByCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P1-A: conversation context endpoint + report-create evidence snapshot.
// ---------------------------------------------------------------------------
describe('P1-A conversation context + evidence snapshot', () => {
  it('/admin/reports/:id/context returns the live conversation messages', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    addMessage(cid, reported, 'first bad message');
    addMessage(cid, reporter, 'please stop');
    addMessage(cid, reported, 'second bad message');
    const id = makeReport(reported, reporter, { conversationId: cid });

    const ctx = (await api(`/admin/reports/${id}/context`, { token: adminToken() })).json;
    expect(ctx.live).toBe(true);
    expect(ctx.messages).toHaveLength(3);
    // Oldest-first, sender-attributed, reported flagged.
    expect(ctx.messages[0].body).toBe('first bad message');
    expect(ctx.messages[0].fromReported).toBe(true);
    expect(ctx.messages[1].fromReported).toBe(false);
  });

  it('context falls back to the snapshot when the conversation is gone', async () => {
    const id = makeReport(makeUser(), makeUser(), {
      conversationId: 'deleted-conv', reportedMessage: 'frozen evidence text',
    });
    const ctx = (await api(`/admin/reports/${id}/context`, { token: adminToken() })).json;
    expect(ctx.live).toBe(false);
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.snapshot).toBe('frozen evidence text');
  });

  it('report-create (POST /messaging/report) snapshots the counterpart’s recent message', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    addMessage(cid, reported, 'creepy thing they said');

    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', conversationId: cid },
    });
    expect(r.status).toBe(201);

    const row = db.prepare(
      'SELECT reported_message FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    expect(row.reported_message).toContain('creepy thing they said');
  });
});

// ---------------------------------------------------------------------------
// Needed #10: evidence-on-report — reporter-pinned message + widened snapshot.
// ---------------------------------------------------------------------------
describe('Needed #10 evidence-on-report (pinned message + widened snapshot)', () => {
  it('report WITH a valid messageId (reported user\'s message in that conversation) pins it', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    addMessage(cid, reported, 'an early message');
    const offending = addMessage(cid, reported, 'the specific creepy line');
    addMessage(cid, reported, 'a later message');

    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', conversationId: cid, messageId: offending },
    });
    expect(r.status).toBe(201);

    const row = db.prepare(
      'SELECT id, reported_message_id, pinned_message FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    // Pin persists durably: both the id and the frozen text are stored.
    expect(row.reported_message_id).toBe(offending);
    expect(row.pinned_message).toBe('the specific creepy line');

    // The context endpoint surfaces the pinned message + flags it in the live view.
    const ctx = (await api(`/admin/reports/${row.id}/context`, { token: adminToken() })).json;
    expect(ctx.pinnedMessageId).toBe(offending);
    expect(ctx.pinnedMessage).toBe('the specific creepy line');
    const pinnedInLive = ctx.messages.find((m) => m.pinned);
    expect(pinnedInLive).toBeTruthy();
    expect(pinnedInLive.id).toBe(offending);
    expect(pinnedInLive.body).toBe('the specific creepy line');
    // Only the flagged message is marked pinned.
    expect(ctx.messages.filter((m) => m.pinned)).toHaveLength(1);
  });

  it('a messageId that is the REPORTER\'s OWN message is ignored (not pinned)', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    addMessage(cid, reported, 'their message');
    const ownMsg = addMessage(cid, reporter, 'my own message');

    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', conversationId: cid, messageId: ownMsg },
    });
    // Report still files — the pin is just dropped (never pin the reporter's own).
    expect(r.status).toBe(201);
    const row = db.prepare(
      'SELECT id, reported_message_id, pinned_message FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    expect(row.reported_message_id).toBeNull();
    expect(row.pinned_message).toBeNull();

    const ctx = (await api(`/admin/reports/${row.id}/context`, { token: adminToken() })).json;
    expect(ctx.pinnedMessageId).toBeNull();
    expect(ctx.messages.some((m) => m.pinned)).toBe(false);
  });

  it('a messageId from ANOTHER conversation is ignored (not pinned)', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    addMessage(cid, reported, 'in-scope message');
    // A message the reported user sent, but in a DIFFERENT conversation.
    const otherPerson = makeUser();
    const otherCid = makeConversation(reported, otherPerson);
    const foreignMsg = addMessage(otherCid, reported, 'unrelated-conversation message');

    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', conversationId: cid, messageId: foreignMsg },
    });
    expect(r.status).toBe(201);
    const row = db.prepare(
      'SELECT reported_message_id, pinned_message FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    expect(row.reported_message_id).toBeNull();
    expect(row.pinned_message).toBeNull();
  });

  it('report WITHOUT messageId still snapshots the WIDENED last-N (more than 3)', async () => {
    const reporter = makeUser();
    const reported = makeUser();
    const cid = makeConversation(reporter, reported);
    // Five messages from the reported user — the old LIMIT 3 would have dropped
    // the two earliest; the widened LIMIT 10 keeps them all.
    for (let i = 1; i <= 5; i++) addMessage(cid, reported, `reported-line-${i}`);

    const r = await api('/messaging/report', {
      token: signToken(reporter, 0), method: 'POST',
      body: { reportedUserId: reported, reason: 'harassment', conversationId: cid },
    });
    expect(r.status).toBe(201);
    const row = db.prepare(
      'SELECT reported_message, reported_message_id FROM reports WHERE reporter_id = ? AND reported_id = ?'
    ).get(reporter, reported);
    // No pin on this path.
    expect(row.reported_message_id).toBeNull();
    // All five survive the snapshot (proves the widen from 3 → 10).
    expect(row.reported_message).toContain('reported-line-1');
    expect(row.reported_message).toContain('reported-line-2');
    expect(row.reported_message).toContain('reported-line-5');
  });
});

// ---------------------------------------------------------------------------
// P1-C: human-readable audit log.
// ---------------------------------------------------------------------------
describe('P1-C human-readable audit log', () => {
  it('resolves target_id → email/name for user-targeted actions', async () => {
    const target = makeUser({ email: 'audit-target@t.dev' });
    await api(`/admin/users/${target}/verify`, {
      token: adminToken(), method: 'POST', body: { verified: true, note: 'checked' },
    });
    const log = (await api('/admin/audit-log', { token: adminToken() })).json.log;
    const entry = log.find((e) => e.action === 'verify' && e.targetId === target);
    expect(entry.targetEmail).toBe('audit-target@t.dev');
    expect(entry.targetName).toBe(`Name ${target}`);
  });
});
