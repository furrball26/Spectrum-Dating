// /health liveness probe tests.
//
// Proves the public probe returns 200 with { status:'ok', sha, db } while the
// process is serving, that `sha` is passed through verbatim (deploy guard reads
// it), and that the DB liveness signal reads 'up' against a live database and
// 'down' — WITHOUT flipping the HTTP status — when the query throws (a degraded
// DB must never read as an unreachable server).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-health-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-health-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const healthRouter = (await import('../src/routes/health.js')).default;

const db = getDb();
let server;
let baseUrl;

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

beforeAll(async () => {
  const app = express();
  app.use(healthRouter(db, 'test-sha-abc123'));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('GET /health', () => {
  it('returns 200 with status ok, the passed sha, and db up against a live DB', async () => {
    const { status, json } = await get('/health');
    expect(status).toBe(200);
    expect(json.status).toBe('ok');
    expect(json.sha).toBe('test-sha-abc123');
    expect(json.db).toBe('up');
  });

  it('reports db "down" (still 200) when the liveness query throws', async () => {
    // A db stub whose prepare() throws simulates a degraded database. The server
    // is still reachable, so the HTTP status must stay 200 — only `db` flips.
    const brokenApp = express();
    brokenApp.use(healthRouter({ prepare() { throw new Error('db offline'); } }, null));
    const s = createServer(brokenApp);
    await new Promise((resolve) => s.listen(0, resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/health`);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.status).toBe('ok');
      expect(json.db).toBe('down');
      expect(json.sha).toBe(null);
    } finally {
      s.close();
    }
  });
});
