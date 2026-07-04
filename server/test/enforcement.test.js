// Enforcement ladder + due-process (gap-analysis §Needed #7 + #11) backend tests.
// Boots a minimal app wired like src/index.js against a throwaway on-disk SQLite
// DB and drives it over HTTP (mirrors moderation_console.test.js). Proves:
//   - warn records a notice and does NOT change suspended/banned/token_version;
//   - ban sets banned=1, bumps token_version, auto-closes open reports, records a
//     notice, and 409s on re-ban; unban clears it;
//   - suspend now records a 'suspend' notice with its reason;
//   - a suspended OR banned user's login attempt returns { enforced, kind, reason,
//     canAppeal } instead of a bare rejection;
//   - the moderator payloads (report card / member detail / history) expose
//     `banned` + the latest enforcement notice;
//   - migration 049 boots clean ×3 and adds users.banned + enforcement_notices.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-enf-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-enforcement-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb, runMigrations } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminRouter = (await import('../src/routes/admin.js')).default;
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;
const authRouter = (await import('../src/routes/auth.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

const PASSWORD = 'TestPass12345!';
let passwordHash;

function makeUser({ email, suspended = 0, banned = 0, createdAt = Date.now() } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended, banned) VALUES (?,?,?,?,0,?,?)')
    .run(id, em, passwordHash, createdAt, suspended, banned);
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, `Name ${id}`, Date.now());
  return { id, email: em };
}

function makeReport(reportedId, reporterId, { status = 'open' } = {}) {
  const id = `r${++uid}`;
  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, conversation_id, reason, details, status, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, reporterId, reportedId, null, 'harassment', 'x', status, Date.now());
  return id;
}

function noticeCount(userId, kind) {
  return db.prepare('SELECT COUNT(*) AS c FROM enforcement_notices WHERE user_id = ? AND kind = ?').get(userId, kind).c;
}
function tokenVersion(userId) {
  return db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId).token_version;
}
function userRow(userId) {
  return db.prepare('SELECT suspended, banned FROM users WHERE id = ?').get(userId);
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
  passwordHash = await bcrypt.hash(PASSWORD, 12);
  adminId = makeUser({ email: 'admin@t.dev' }).id;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/admin', adminTelemetryRouter);
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
// Migration 049 boots clean ×3 and adds the column + table.
// ---------------------------------------------------------------------------
describe('migration 049 (enforcement)', () => {
  function freshDb() {
    const dir = mkdtempSync(join(tmpdir(), 'spectrum-enf-mig-'));
    const d = new Database(join(dir, 'm.db'));
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    return { d, dir };
  }
  function hasCol(d, table, col) {
    return d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }
  function hasTable(d, name) {
    return !!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  }

  it('boots clean on a fresh DB and adds users.banned + enforcement_notices', () => {
    const { d, dir } = freshDb();
    try {
      expect(() => runMigrations(d)).not.toThrow();
      expect(hasCol(d, 'users', 'banned')).toBe(true);
      expect(hasTable(d, 'enforcement_notices')).toBe(true);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — a second and third run do not throw or drop the column/table', () => {
    const { d, dir } = freshDb();
    try {
      runMigrations(d);
      runMigrations(d);
      expect(() => runMigrations(d)).not.toThrow();
      expect(hasCol(d, 'users', 'banned')).toBe(true);
      expect(hasTable(d, 'enforcement_notices')).toBe(true);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Warn — lightest rung: records a notice, no lockout.
// ---------------------------------------------------------------------------
describe('warn', () => {
  it('records a notice and does NOT change suspended/banned or token_version', async () => {
    const u = makeUser();
    const tvBefore = tokenVersion(u.id);

    const missing = await api(`/admin/users/${u.id}/warn`, { token: adminToken(), method: 'POST', body: {} });
    expect(missing.status).toBe(400); // note required

    const ok = await api(`/admin/users/${u.id}/warn`, {
      token: adminToken(), method: 'POST', body: { note: 'please be kinder in chats' },
    });
    expect(ok.status).toBe(200);
    expect(noticeCount(u.id, 'warn')).toBe(1);
    const row = userRow(u.id);
    expect(row.suspended).toBe(0);
    expect(row.banned).toBe(0);
    expect(tokenVersion(u.id)).toBe(tvBefore); // NOT logged out
    // The recorded reason is the moderator note.
    const notice = db.prepare("SELECT reason FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'").get(u.id);
    expect(notice.reason).toBe('please be kinder in chats');
  });

  it('allows multiple warns (no idempotency guard)', async () => {
    const u = makeUser();
    await api(`/admin/users/${u.id}/warn`, { token: adminToken(), method: 'POST', body: { note: 'first' } });
    await api(`/admin/users/${u.id}/warn`, { token: adminToken(), method: 'POST', body: { note: 'second' } });
    expect(noticeCount(u.id, 'warn')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ban — permanent, force-logout, auto-close, 409 on re-ban.
// ---------------------------------------------------------------------------
describe('ban / unban', () => {
  it('sets banned=1, bumps token_version, auto-closes open reports, records a notice', async () => {
    const u = makeUser();
    const tvBefore = tokenVersion(u.id);
    const openA = makeReport(u.id, makeUser().id, { status: 'open' });
    const openB = makeReport(u.id, makeUser().id, { status: 'open' });
    const dismissed = makeReport(u.id, makeUser().id, { status: 'dismissed' });

    const missing = await api(`/admin/users/${u.id}/ban`, { token: adminToken(), method: 'POST', body: {} });
    expect(missing.status).toBe(400); // note required

    const r = await api(`/admin/users/${u.id}/ban`, {
      token: adminToken(), method: 'POST', body: { note: 'repeated targeted harassment' },
    });
    expect(r.status).toBe(200);
    expect(r.json.banned).toBe(true);
    expect(r.json.autoClosedReports).toBe(2);

    expect(userRow(u.id).banned).toBe(1);
    expect(tokenVersion(u.id)).toBe(tvBefore + 1); // force-logout
    expect(noticeCount(u.id, 'ban')).toBe(1);
    expect(db.prepare('SELECT status FROM reports WHERE id = ?').get(openA).status).toBe('actioned');
    expect(db.prepare('SELECT resolved_by FROM reports WHERE id = ?').get(openB).resolved_by).toBe(adminId);
    // Terminal report untouched.
    expect(db.prepare('SELECT status FROM reports WHERE id = ?').get(dismissed).status).toBe('dismissed');
  });

  it('409s on a re-ban and does not write a second notice', async () => {
    const u = makeUser({ banned: 1 });
    const r = await api(`/admin/users/${u.id}/ban`, {
      token: adminToken(), method: 'POST', body: { note: 'again' },
    });
    expect(r.status).toBe(409);
    expect(noticeCount(u.id, 'ban')).toBe(0);
  });

  it('unban clears banned=0 (409 when not banned)', async () => {
    const u = makeUser({ banned: 1 });
    const ok = await api(`/admin/users/${u.id}/unban`, { token: adminToken(), method: 'POST', body: { note: 'appeal upheld' } });
    expect(ok.status).toBe(200);
    expect(userRow(u.id).banned).toBe(0);

    const again = await api(`/admin/users/${u.id}/unban`, { token: adminToken(), method: 'POST', body: { note: 'noop' } });
    expect(again.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Suspend now records a 'suspend' notice with its reason (and 'unsuspend').
// ---------------------------------------------------------------------------
describe('suspend records a due-process notice', () => {
  it('suspend writes a suspend notice; unsuspend writes an unsuspend notice', async () => {
    const u = makeUser();
    const s = await api(`/admin/users/${u.id}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, note: 'spam links' },
    });
    expect(s.status).toBe(200);
    const notice = db.prepare("SELECT reason FROM enforcement_notices WHERE user_id = ? AND kind = 'suspend'").get(u.id);
    expect(notice.reason).toBe('spam links');

    const un = await api(`/admin/users/${u.id}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: false, note: 'reinstated' },
    });
    expect(un.status).toBe(200);
    expect(noticeCount(u.id, 'unsuspend')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Due-process on login: reason + canAppeal instead of a bare rejection.
// ---------------------------------------------------------------------------
describe('login due-process surfacing', () => {
  it('a suspended user login returns { enforced, kind:suspend, reason, canAppeal }', async () => {
    const u = makeUser({ email: `susp${++uid}@t.dev` });
    await api(`/admin/users/${u.id}/suspend`, {
      token: adminToken(), method: 'POST', body: { suspended: true, note: 'off-platform pressure' },
    });
    const r = await api('/auth/login', { method: 'POST', body: { email: u.email, password: PASSWORD } });
    expect(r.status).toBe(403);
    expect(r.json.enforced).toBe(true);
    expect(r.json.kind).toBe('suspend');
    expect(r.json.reason).toBe('off-platform pressure');
    expect(r.json.canAppeal).toBe(true);
  });

  it('a banned user login returns { enforced, kind:ban, reason, canAppeal }', async () => {
    const u = makeUser({ email: `ban${++uid}@t.dev` });
    await api(`/admin/users/${u.id}/ban`, {
      token: adminToken(), method: 'POST', body: { note: 'threats of violence' },
    });
    const r = await api('/auth/login', { method: 'POST', body: { email: u.email, password: PASSWORD } });
    expect(r.status).toBe(403);
    expect(r.json.enforced).toBe(true);
    expect(r.json.kind).toBe('ban');
    expect(r.json.reason).toBe('threats of violence');
    expect(r.json.canAppeal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Moderator payloads expose banned + the latest enforcement notice.
// ---------------------------------------------------------------------------
describe('moderator payloads expose enforcement state', () => {
  it('report card carries reported.banned + warnCount + latestNotice', async () => {
    const bad = makeUser();
    await api(`/admin/users/${bad.id}/warn`, { token: adminToken(), method: 'POST', body: { note: 'warned once' } });
    await api(`/admin/users/${bad.id}/ban`, { token: adminToken(), method: 'POST', body: { note: 'banned for cause' } });
    const focus = makeReport(bad.id, makeUser().id, { status: 'open' });

    const list = (await api('/admin/reports?status=all', { token: adminToken() })).json.reports;
    const card = list.find((x) => x.id === focus);
    expect(card.reported.banned).toBe(true);
    expect(card.reported.warnCount).toBe(1);
    expect(card.reported.latestNotice.kind).toBe('ban');
    expect(card.reported.latestNotice.reason).toBe('banned for cause');
  });

  it('member detail + history expose banned + latestNotice', async () => {
    const bad = makeUser();
    await api(`/admin/users/${bad.id}/ban`, { token: adminToken(), method: 'POST', body: { note: 'perma' } });

    const detail = (await api(`/admin/members/${bad.id}`, { token: adminToken() })).json;
    expect(detail.banned).toBe(true);
    expect(detail.latestNotice.reason).toBe('perma');

    const history = (await api(`/admin/users/${bad.id}/history`, { token: adminToken() })).json;
    expect(history.banned).toBe(true);
    expect(history.latestNotice.kind).toBe('ban');
  });
});
