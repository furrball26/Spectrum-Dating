// Admin test-account purge (A+B). Boots a minimal app wired like src/index.js
// against a throwaway on-disk SQLite DB and drives it over HTTP, mirroring
// safety-batch.test.js. Asserts POST /admin/purge-test-accounts deletes ONLY
// @spectrum-test.dev users by default (real + demo untouched), and that
// includeDemo:true also removes @sample.spectrum-dating.app demo personas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-purge-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-purge-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminRouter = (await import('../src/routes/admin.js')).default;
const accountRouter = (await import('../src/routes/account.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser(email) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, email, 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, `Name ${id}`, Date.now());
  return id;
}

function userExists(id) {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
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
  app.use('/admin', adminRouter);
  app.use('/account', accountRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('POST /admin/purge-test-accounts', () => {
  it('requires admin (403 for a non-admin caller)', async () => {
    const plain = makeUser('nonadmin@example.com');
    const r = await api('/admin/purge-test-accounts', { token: signToken(plain, 0), method: 'POST', body: {} });
    expect(r.status).toBe(403);
  });

  it('deletes ONLY @spectrum-test.dev by default (real + demo untouched)', async () => {
    const admin = makeUser('admin@t.dev');
    const testAcct = makeUser('qa+abc123@spectrum-test.dev');
    const realAcct = makeUser('someone@gmail.com');
    const demoAcct = makeUser('persona@sample.spectrum-dating.app');

    const r = await api('/admin/purge-test-accounts', {
      token: signToken(admin, 0), method: 'POST', body: {},
    });
    expect(r.status).toBe(200);
    expect(r.json.deleted).toBe(1);

    expect(userExists(testAcct)).toBe(false); // purged
    expect(userExists(realAcct)).toBe(true);  // untouched
    expect(userExists(demoAcct)).toBe(true);  // demo NOT touched by default
    expect(userExists(admin)).toBe(true);

    // Audit row written.
    const log = db.prepare("SELECT * FROM moderation_log WHERE action = 'purge_test_accounts' ORDER BY created_at DESC").get();
    expect(log).toBeTruthy();
    expect(log.detail).toContain('deleted 1');
  });

  it('with includeDemo:true also removes @sample.spectrum-dating.app', async () => {
    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@t.dev'").get().id;
    const testAcct = makeUser('qa+def456@spectrum-test.dev');
    const demoAcct = makeUser('persona2@sample.spectrum-dating.app');
    const realAcct = makeUser('real2@outlook.com');

    const r = await api('/admin/purge-test-accounts', {
      token: signToken(admin, 0), method: 'POST', body: { includeDemo: true },
    });
    expect(r.status).toBe(200);
    // At least the two we just seeded (a leftover demo from the prior test may
    // also be swept — assert on our concrete accounts rather than an exact count).
    expect(r.json.deleted).toBeGreaterThanOrEqual(2);

    expect(userExists(testAcct)).toBe(false);
    expect(userExists(demoAcct)).toBe(false);
    expect(userExists(realAcct)).toBe(true);
  });
});
