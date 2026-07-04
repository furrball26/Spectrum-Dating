// DB-based admin role tests (migration 055 + POST /admin/roles). Boots a minimal
// app (auth middleware + context + the /admin moderation router, /auth, /profile,
// and a requireAdmin-gated probe) over a throwaway on-disk DB, mirroring
// billing.test.js / admin_members.test.js.
//
// Covers: non-admin → 403; an admin grants is_admin=1 and the target then PASSES
// requireAdmin (DB-granted admin works end-to-end); an env-root admin passes
// requireAdmin with is_admin=0 (env immutability); the role endpoint refuses to
// modify an env-root target; every grant/revoke writes a moderation_log row;
// self-lockout is prevented; bad input → 400; /profile/me + login return
// isAdmin:true for a DB-granted admin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-roles-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-roles-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'root@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, requireAuth, signToken } = await import('../src/middleware/auth.js');
const { requireAdmin } = await import('../src/middleware/admin.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminRouter = (await import('../src/routes/admin.js')).default;
const authRouter = (await import('../src/routes/auth.js')).default;
const profileRouter = (await import('../src/routes/profile.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser({ email, isAdmin = 0, password } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  const hash = password ? bcrypt.hashSync(password, 4) : 'x';
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, is_admin) VALUES (?,?,?,?,0,?)')
    .run(id, em, hash, Date.now(), isAdmin);
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, `Name ${id}`, Date.now());
  return id;
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
let envRootId; // an ADMIN_EMAILS root admin (is_admin=0)

beforeAll(async () => {
  envRootId = makeUser({ email: 'root@t.dev' });
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/profile', profileRouter);
  // A probe that ONLY a real admin (env OR db) may reach — proves requireAdmin.
  app.get('/probe-admin', requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

function modLogCount(action, targetId) {
  return db.prepare('SELECT COUNT(*) AS c FROM moderation_log WHERE action = ? AND target_id = ?')
    .get(action, targetId).c;
}

// ---------------------------------------------------------------------------
describe('requireAdmin — env OR db resolution', () => {
  it('an env-root admin passes requireAdmin with is_admin=0 (env immutability)', async () => {
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(envRootId).is_admin).toBe(0);
    const { status, json } = await api('/probe-admin', { token: tok(envRootId) });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it('a plain member does NOT pass requireAdmin', async () => {
    const u = makeUser();
    const { status } = await api('/probe-admin', { token: tok(u) });
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — authorization', () => {
  it('a non-admin gets 403 (cannot grant themselves admin)', async () => {
    const u = makeUser();
    const { status } = await api('/admin/roles', {
      token: tok(u), method: 'POST', body: { userId: u, admin: true },
    });
    expect(status).toBe(403);
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(u).is_admin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — grant / revoke + end-to-end', () => {
  it('an admin grants is_admin=1 and the target then PASSES requireAdmin', async () => {
    const target = makeUser();
    // Before: not an admin.
    expect((await api('/probe-admin', { token: tok(target) })).status).toBe(403);

    const grant = await api('/admin/roles', {
      token: tok(envRootId), method: 'POST', body: { userId: target, admin: true, reason: 'new moderator' },
    });
    expect(grant.status).toBe(200);
    expect(grant.json).toMatchObject({ ok: true, userId: target, admin: true, changed: true });
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(target).is_admin).toBe(1);

    // After: DB-granted admin works end-to-end through requireAdmin.
    expect((await api('/probe-admin', { token: tok(target) })).status).toBe(200);

    // A DB-granted admin can now use admin endpoints — e.g. grant on someone else.
    const other = makeUser();
    const chain = await api('/admin/roles', {
      token: tok(target), method: 'POST', body: { userId: other, admin: true },
    });
    expect(chain.status).toBe(200);
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(other).is_admin).toBe(1);
  });

  it('revoke sets is_admin=0 and the target loses requireAdmin access', async () => {
    const target = makeUser({ isAdmin: 1 });
    expect((await api('/probe-admin', { token: tok(target) })).status).toBe(200);

    const revoke = await api('/admin/roles', {
      token: tok(envRootId), method: 'POST', body: { userId: target, admin: false, reason: 'stepped down' },
    });
    expect(revoke.status).toBe(200);
    expect(revoke.json).toMatchObject({ admin: false, changed: true });
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(target).is_admin).toBe(0);
    expect((await api('/probe-admin', { token: tok(target) })).status).toBe(403);
  });

  it('a no-op (already in target state) succeeds without an audit row', async () => {
    const target = makeUser();
    const before = modLogCount('grant_admin', target) + modLogCount('revoke_admin', target);
    const res = await api('/admin/roles', {
      token: tok(envRootId), method: 'POST', body: { userId: target, admin: false },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, changed: false });
    const after = modLogCount('grant_admin', target) + modLogCount('revoke_admin', target);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — audit logging', () => {
  it('every grant AND revoke writes a moderation_log row (with reason)', async () => {
    const target = makeUser();
    await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: target, admin: true, reason: 'grant reason' } });
    await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: target, admin: false, reason: 'revoke reason' } });

    expect(modLogCount('grant_admin', target)).toBe(1);
    expect(modLogCount('revoke_admin', target)).toBe(1);

    const grantRow = db.prepare("SELECT actor_id, detail FROM moderation_log WHERE action = 'grant_admin' AND target_id = ?").get(target);
    expect(grantRow.actor_id).toBe(envRootId);
    expect(grantRow.detail).toBe('grant reason');
    const revokeRow = db.prepare("SELECT detail FROM moderation_log WHERE action = 'revoke_admin' AND target_id = ?").get(target);
    expect(revokeRow.detail).toBe('revoke reason');
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — env-root immutability', () => {
  it('refuses to REVOKE an env-root target (400) and leaves it untouched', async () => {
    const dbAdmin = makeUser({ isAdmin: 1 });
    const res = await api('/admin/roles', {
      token: tok(dbAdmin), method: 'POST', body: { userId: envRootId, admin: false },
    });
    expect(res.status).toBe(400);
    // The env root still passes requireAdmin regardless of the failed call.
    expect((await api('/probe-admin', { token: tok(envRootId) })).status).toBe(200);
    // No audit row was written for the refused change.
    expect(modLogCount('revoke_admin', envRootId)).toBe(0);
  });

  it('refuses to GRANT (redundantly flag) an env-root target (400)', async () => {
    const res = await api('/admin/roles', {
      token: tok(envRootId), method: 'POST', body: { userId: envRootId, admin: true },
    });
    expect(res.status).toBe(400);
    // Env root was never DB-flagged — immutable via the UI.
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(envRootId).is_admin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — self-lockout prevention', () => {
  it('a DB admin cannot revoke their OWN admin (403) and stays admin', async () => {
    const selfAdmin = makeUser({ isAdmin: 1 });
    const res = await api('/admin/roles', {
      token: tok(selfAdmin), method: 'POST', body: { userId: selfAdmin, admin: false },
    });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(selfAdmin).is_admin).toBe(1);
    expect((await api('/probe-admin', { token: tok(selfAdmin) })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('POST /admin/roles — input validation', () => {
  it('400 on missing userId', async () => {
    const res = await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { admin: true } });
    expect(res.status).toBe(400);
  });
  it('400 on non-boolean admin', async () => {
    const target = makeUser();
    const res = await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: target, admin: 'yes' } });
    expect(res.status).toBe(400);
  });
  it('400 on non-string reason', async () => {
    const target = makeUser();
    const res = await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: target, admin: true, reason: 5 } });
    expect(res.status).toBe(400);
  });
  it('404 on a non-existent target', async () => {
    const res = await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: 'nope', admin: true } });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('client-facing admin status honors is_admin', () => {
  it('/profile/me returns isAdmin:true for a DB-granted admin (false before)', async () => {
    const u = makeUser();
    const before = await api('/profile/me', { token: tok(u) });
    expect(before.status).toBe(200);
    expect(before.json.isAdmin).toBe(false);

    await api('/admin/roles', { token: tok(envRootId), method: 'POST', body: { userId: u, admin: true } });
    const after = await api('/profile/me', { token: tok(u) });
    expect(after.json.isAdmin).toBe(true);
  });

  it('POST /auth/login returns isAdmin:true for a DB-granted admin', async () => {
    const email = `login-admin-${++uid}@t.dev`;
    makeUser({ email, isAdmin: 1, password: 'password123' });
    const res = await api('/auth/login', { method: 'POST', body: { email, password: 'password123' } });
    expect(res.status).toBe(200);
    expect(res.json.isAdmin).toBe(true);
  });

  it('POST /auth/login returns isAdmin:true for an env-root admin (is_admin=0)', async () => {
    const email = `env-login-${++uid}@t.dev`;
    // Add this email to the allowlist for this one assertion.
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = `${prev},${email}`;
    makeUser({ email, isAdmin: 0, password: 'password123' });
    const res = await api('/auth/login', { method: 'POST', body: { email, password: 'password123' } });
    expect(res.status).toBe(200);
    expect(res.json.isAdmin).toBe(true);
    process.env.ADMIN_EMAILS = prev;
  });
});
