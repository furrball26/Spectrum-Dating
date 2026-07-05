// Moderation redesign v1 — the atomic report-action endpoint
// (POST /admin/reports/:id/action). Boots a minimal app wired like src/index.js
// against a throwaway on-disk SQLite DB and drives it over HTTP (mirrors
// enforcement.test.js / moderation_console.test.js). Proves:
//   - dismiss closes the report as 'dismissed' with a resolved-by receipt and NO
//     enforcement on the member;
//   - WARN records a 'warn' notice AND closes the report as 'actioned' in one
//     step (the bug fix: warn used to leave its report open), scoped to THIS
//     report only (sibling reports stay open);
//   - ban bans the member (banned=1, token_version bump, notice) AND closes the
//     report + the member's other open sibling reports;
//   - a case-ban of an already-banned member still closes the report gracefully
//     (no duplicate enforcement, no error);
//   - every action writes the moderation audit log + resolved_by;
//   - the 409 terminal guard blocks re-actioning a resolved report;
//   - non-admin → 403; bad action value → 400; missing reason → 400;
//   - enforcement + report-close are ATOMIC (a mid-transaction failure rolls back
//     BOTH the enforcement notice and the report close).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import bcrypt from 'bcrypt';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-repaction-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-report-action-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminRouter = (await import('../src/routes/admin.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;
let nonAdminId;

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

function makeReport(reportedId, reporterId, { status = 'open', reason = 'harassment' } = {}) {
  const id = `r${++uid}`;
  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, conversation_id, reason, details, status, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, reporterId, reportedId, null, reason, 'x', status, Date.now());
  return id;
}

function report(id) { return db.prepare('SELECT * FROM reports WHERE id = ?').get(id); }
function noticeCount(userId, kind) {
  return db.prepare('SELECT COUNT(*) AS c FROM enforcement_notices WHERE user_id = ? AND kind = ?').get(userId, kind).c;
}
function tokenVersion(userId) {
  return db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId).token_version;
}
function userRow(userId) {
  return db.prepare('SELECT suspended, banned FROM users WHERE id = ?').get(userId);
}
function modLog(action, targetId) {
  return db.prepare('SELECT COUNT(*) AS c FROM moderation_log WHERE action = ? AND target_id = ?').get(action, targetId).c;
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
const nonAdminToken = () => signToken(nonAdminId, 0);

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 12);
  adminId = makeUser({ email: 'admin@t.dev' }).id;
  nonAdminId = makeUser({ email: 'mortal@t.dev' }).id;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
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

// ---------------------------------------------------------------------------
// Dismiss — close with no enforcement.
// ---------------------------------------------------------------------------
describe('action: dismiss', () => {
  it('closes the report as dismissed with a receipt and NO enforcement', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });

    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'dismiss', reason: 'no policy violation' },
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('dismissed');

    const row = report(rep);
    expect(row.status).toBe('dismissed');
    expect(row.resolved_by).toBe(adminId);
    expect(row.resolved_at).toBeTruthy();
    expect(row.moderator_note).toBe('no policy violation');
    // No enforcement on the member.
    expect(userRow(u.id)).toEqual({ suspended: 0, banned: 0 });
    expect(noticeCount(u.id, 'warn')).toBe(0);
    expect(noticeCount(u.id, 'ban')).toBe(0);
    // Audit: exactly the resolve_report row, no warn/ban.
    expect(modLog('resolve_report', rep)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Warn — THE BUG FIX: records a warning AND closes the report atomically.
// ---------------------------------------------------------------------------
describe('action: warn (records a warning AND closes the report)', () => {
  it('records a warn notice AND closes THIS report as actioned, scoped to it', async () => {
    const u = makeUser();
    const tvBefore = tokenVersion(u.id);
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    const sibling = makeReport(u.id, makeUser().id, { status: 'open' });

    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'warn', reason: 'please be kinder in chats' },
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('actioned');
    expect(r.json.kind).toBe('warn');

    // The warning was recorded on the member...
    expect(noticeCount(u.id, 'warn')).toBe(1);
    const notice = db.prepare("SELECT reason FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'").get(u.id);
    expect(notice.reason).toBe('please be kinder in chats');
    // ...and the report was CLOSED in the same step (the fix — no second Resolve).
    const row = report(rep);
    expect(row.status).toBe('actioned');
    expect(row.resolved_by).toBe(adminId);
    expect(row.resolved_at).toBeTruthy();
    expect(row.moderator_note).toBe('please be kinder in chats');
    // Warn is a keep-access action — no lockout.
    expect(userRow(u.id)).toEqual({ suspended: 0, banned: 0 });
    expect(tokenVersion(u.id)).toBe(tvBefore);
    // Scoped: the sibling report stays OPEN (warn never fans out).
    expect(report(sibling).status).toBe('open');
    // Audit trail: both the warn and the resolve_report rows.
    expect(modLog('warn', u.id)).toBe(1);
    expect(modLog('resolve_report', rep)).toBe(1);
  });

  it('appends an optional note to the recorded reason', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'warn', reason: 'spammy links', note: 'first offense' },
    });
    expect(report(rep).moderator_note).toBe('spammy links — first offense');
  });
});

// ---------------------------------------------------------------------------
// Ban — bans the member AND closes the report + open siblings.
// ---------------------------------------------------------------------------
describe('action: ban (bans AND closes the report)', () => {
  it('sets banned=1, bumps token_version, records a notice, closes this + sibling reports', async () => {
    const u = makeUser();
    const tvBefore = tokenVersion(u.id);
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    const sibling = makeReport(u.id, makeUser().id, { status: 'open' });
    const alreadyDismissed = makeReport(u.id, makeUser().id, { status: 'dismissed' });

    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'ban', reason: 'targeted harassment' },
    });
    expect(r.status).toBe(200);
    expect(r.json.banned).toBe(true);
    expect(r.json.status).toBe('actioned');
    // The other OPEN sibling report is auto-closed (this report closed separately).
    expect(r.json.autoClosedReports).toBe(1);

    expect(userRow(u.id).banned).toBe(1);
    expect(tokenVersion(u.id)).toBe(tvBefore + 1); // force-logout
    expect(noticeCount(u.id, 'ban')).toBe(1);

    // This report closed as actioned with the moderator's reason + receipt.
    const row = report(rep);
    expect(row.status).toBe('actioned');
    expect(row.resolved_by).toBe(adminId);
    expect(row.moderator_note).toBe('targeted harassment');
    // Sibling open report closed too; already-terminal report untouched.
    expect(report(sibling).status).toBe('actioned');
    expect(report(alreadyDismissed).status).toBe('dismissed');
    // Audit.
    expect(modLog('ban', u.id)).toBe(1);
    expect(modLog('resolve_report', rep)).toBe(1);
  });

  it('gracefully closes the case when the member was already banned by another moderator', async () => {
    const u = makeUser({ banned: 1 });
    const tvBefore = tokenVersion(u.id);
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });

    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'ban', reason: 'also harassment' },
    });
    // Not a 409 — the case still resolves.
    expect(r.status).toBe(200);
    expect(report(rep).status).toBe('actioned');
    expect(report(rep).resolved_by).toBe(adminId);
    // No duplicate enforcement: no second notice, no extra token bump.
    expect(noticeCount(u.id, 'ban')).toBe(0);
    expect(tokenVersion(u.id)).toBe(tvBefore);
  });
});

// ---------------------------------------------------------------------------
// Terminal guard + validation + authorization.
// ---------------------------------------------------------------------------
describe('guards & validation', () => {
  it('409s on re-actioning a report that is already resolved (terminal guard)', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    const first = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'dismiss', reason: 'nope' },
    });
    expect(first.status).toBe(200);

    const again = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'warn', reason: 'changed my mind' },
    });
    expect(again.status).toBe(409);
    // The original decision is untouched.
    expect(report(rep).status).toBe('dismissed');
    expect(noticeCount(u.id, 'warn')).toBe(0);
  });

  it('rejects a bad action value with 400', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'nuke', reason: 'x' },
    });
    expect(r.status).toBe(400);
    expect(report(rep).status).toBe('open');
  });

  it('auto-fills the reason from the TOS clause when none is given (standard-clause warn)', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' }); // 'harassment' → §4.1
    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'warn' },
    });
    expect(r.status).toBe(200);
    expect(report(rep).status).toBe('actioned');
    expect(noticeCount(u.id, 'warn')).toBe(1);
    const notice = db.prepare("SELECT reason FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'").get(u.id);
    expect(notice.reason).toMatch(/Terms §4\.1/); // member-facing notice cites the clause
  });

  it("still requires a written reason for the catch-all 'other' clause (no standard notice)", async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open', reason: 'other' });
    const r = await api(`/admin/reports/${rep}/action`, {
      token: adminToken(), method: 'POST', body: { action: 'warn' },
    });
    expect(r.status).toBe(400);
    expect(report(rep).status).toBe('open');
    expect(noticeCount(u.id, 'warn')).toBe(0);
  });

  it('404s on an unknown report', async () => {
    const r = await api('/admin/reports/does-not-exist/action', {
      token: adminToken(), method: 'POST', body: { action: 'dismiss', reason: 'x' },
    });
    expect(r.status).toBe(404);
  });

  it('403s for a non-admin', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    const r = await api(`/admin/reports/${rep}/action`, {
      token: nonAdminToken(), method: 'POST', body: { action: 'ban', reason: 'x' },
    });
    expect(r.status).toBe(403);
    expect(report(rep).status).toBe('open');
    expect(userRow(u.id).banned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Atomicity — enforcement + report-close roll back together on a mid-txn failure.
// ---------------------------------------------------------------------------
describe('atomicity', () => {
  it('rolls back the warn notice if the report-close fails mid-transaction', async () => {
    const u = makeUser();
    const rep = makeReport(u.id, makeUser().id, { status: 'open' });
    // Force the report-close UPDATE (which runs AFTER the notice write in the warn
    // transaction) to abort, so the whole transaction rolls back.
    db.exec(`CREATE TRIGGER t_block_close BEFORE UPDATE ON reports WHEN NEW.id = '${rep}' BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
    try {
      const r = await api(`/admin/reports/${rep}/action`, {
        token: adminToken(), method: 'POST', body: { action: 'warn', reason: 'atomic check' },
      });
      expect(r.status).toBe(500); // the transaction threw
      // Neither the enforcement notice nor the report-close survived.
      expect(noticeCount(u.id, 'warn')).toBe(0);
      expect(report(rep).status).toBe('open');
    } finally {
      db.exec('DROP TRIGGER IF EXISTS t_block_close;');
    }
  });
});
