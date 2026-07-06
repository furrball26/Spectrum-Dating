// T5 — DELETE /account/me re-verifies the password before the irreversible
// cascade, mirroring change-password / change-email. A hijacked (but not
// password-knowing) session must not be able to nuke the whole account.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import bcrypt from 'bcrypt';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-acctdel-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-account-delete';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const accountRouter = (await import('../src/routes/account.js')).default;

const db = getDb();
let server, baseUrl, uid = 0;
const PASSWORD = 'CorrectHorse123!';

function makeUser() {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, bcrypt.hashSync(PASSWORD, 4), Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)').run(id, `Name ${id}`, Date.now());
  return id;
}
const exists = (id) => !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);

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
  app.use('/account', accountRouter);
  server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('DELETE /account/me requires the password (T5)', () => {
  it('400s with no password and the account survives', async () => {
    const u = makeUser();
    const r = await api('/account/me', { token: signToken(u, 0), method: 'DELETE' });
    expect(r.status).toBe(400);
    expect(exists(u)).toBe(true);
  });

  it('403s with the WRONG password and the account survives', async () => {
    const u = makeUser();
    const r = await api('/account/me', { token: signToken(u, 0), method: 'DELETE', body: { password: 'wrong-password' } });
    expect(r.status).toBe(403);
    expect(exists(u)).toBe(true);
  });

  it('deletes with the CORRECT password', async () => {
    const u = makeUser();
    const r = await api('/account/me', { token: signToken(u, 0), method: 'DELETE', body: { password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ deleted: true });
    expect(exists(u)).toBe(false);
  });
});
