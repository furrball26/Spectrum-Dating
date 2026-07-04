// Admin member-management endpoint tests (Phase 1): the paginated /admin/members
// listing (pagination, status filter, sort, report/action/block counts, test/demo
// exclusion, member-email-domain breakdown) and the /admin/members/:id detail
// composition. Boots a minimal admin app over a throwaway on-disk DB, mirroring
// moderation_console.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-members-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-members-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

function makeUser({ email, suspended = 0, verified = 0, distCity = '', lastActive = '', createdAt = Date.now(), displayName } = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@t.dev`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended, last_active_at) VALUES (?,?,?,?,0,?,?)')
    .run(id, em, 'x', createdAt, suspended, lastActive);
  db.prepare('INSERT INTO profiles (user_id, display_name, identity_verified, dist_city, updated_at) VALUES (?,?,?,?,?)')
    .run(id, displayName || `Name ${id}`, verified, distCity, Date.now());
  return id;
}

function makeReport(reportedId, reporterId, { status = 'open' } = {}) {
  const id = `r${++uid}`;
  db.prepare(`INSERT INTO reports (id, reporter_id, reported_id, reason, details, status, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, reporterId, reportedId, 'harassment', 'd', status, Date.now());
  return id;
}

function addBlock(blockerId, blockedId) {
  db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id, reason, created_at) VALUES (?,?,?,?,?)')
    .run(`blk${++uid}`, blockerId, blockedId, 'harassment', Date.now());
}

async function api(path, { token, method = 'GET' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
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
// Listing: exclusion + counts.
// ---------------------------------------------------------------------------
describe('GET /admin/members — listing', () => {
  it('excludes test/demo accounts by default and includes them when opted in', async () => {
    makeUser({ email: 'real-a@example.com' });
    makeUser({ email: 'seed1@spectrum-test.dev' });
    makeUser({ email: 'demo1@sample.spectrum-dating.app' });

    const def = (await api('/admin/members?pageSize=100', { token: adminToken() })).json;
    const emails = def.members.map((m) => m.email);
    expect(emails).toContain('real-a@example.com');
    expect(emails).not.toContain('seed1@spectrum-test.dev');
    expect(emails).not.toContain('demo1@sample.spectrum-dating.app');

    const withTest = (await api('/admin/members?pageSize=100&includeTest=1', { token: adminToken() })).json;
    expect(withTest.members.map((m) => m.email)).toContain('seed1@spectrum-test.dev');
    // Demo still excluded (opt-in independent).
    expect(withTest.members.map((m) => m.email)).not.toContain('demo1@sample.spectrum-dating.app');

    const withDemo = (await api('/admin/members?pageSize=100&includeDemo=1', { token: adminToken() })).json;
    expect(withDemo.members.map((m) => m.email)).toContain('demo1@sample.spectrum-dating.app');
  });

  it('carries report / actioned / blockedBy counts per member', async () => {
    const bad = makeUser({ email: 'bad@example.com' });
    makeReport(bad, makeUser({ email: `rep${++uid}@example.com` }), { status: 'open' });
    makeReport(bad, makeUser({ email: `rep${++uid}@example.com` }), { status: 'actioned' });
    addBlock(makeUser({ email: `blk${++uid}@example.com` }), bad);
    addBlock(makeUser({ email: `blk${++uid}@example.com` }), bad);

    const list = (await api('/admin/members?pageSize=100&query=bad@example.com', { token: adminToken() })).json;
    const row = list.members.find((m) => m.id === bad);
    expect(row.reportCount).toBe(2);
    expect(row.actionedCount).toBe(1);
    expect(row.blockedByCount).toBe(2);
  });

  it('status filter narrows to suspended / active / verified', async () => {
    const susp = makeUser({ email: 'susp@example.com', suspended: 1 });
    const ver = makeUser({ email: 'ver@example.com', verified: 1 });

    const suspList = (await api('/admin/members?pageSize=100&status=suspended', { token: adminToken() })).json;
    expect(suspList.members.every((m) => m.suspended === true)).toBe(true);
    expect(suspList.members.map((m) => m.id)).toContain(susp);

    const verList = (await api('/admin/members?pageSize=100&status=verified', { token: adminToken() })).json;
    expect(verList.members.every((m) => m.verified === true)).toBe(true);
    expect(verList.members.map((m) => m.id)).toContain(ver);

    const activeList = (await api('/admin/members?pageSize=100&status=active', { token: adminToken() })).json;
    expect(activeList.members.every((m) => m.suspended === false)).toBe(true);
    expect(activeList.members.map((m) => m.id)).not.toContain(susp);
  });

  it('paginates: total is the full match count, page slices are disjoint and sized', async () => {
    // Seed a bunch of same-domain users so the counts are deterministic per query.
    const tag = `pg${Date.now()}`;
    for (let i = 0; i < 7; i++) makeUser({ email: `${tag}-${i}@paginate.example` });

    const q = `&query=${tag}`;
    const p1 = (await api(`/admin/members?pageSize=3&page=1${q}`, { token: adminToken() })).json;
    const p2 = (await api(`/admin/members?pageSize=3&page=2${q}`, { token: adminToken() })).json;
    const p3 = (await api(`/admin/members?pageSize=3&page=3${q}`, { token: adminToken() })).json;

    expect(p1.total).toBe(7);
    expect(p1.members).toHaveLength(3);
    expect(p2.members).toHaveLength(3);
    expect(p3.members).toHaveLength(1);
    const ids = new Set([...p1.members, ...p2.members, ...p3.members].map((m) => m.id));
    expect(ids.size).toBe(7); // no overlap across pages
  });

  it('sort=reports orders by report count desc', async () => {
    const tag = `srt${Date.now()}`;
    const many = makeUser({ email: `${tag}-many@example.com` });
    const few = makeUser({ email: `${tag}-few@example.com` });
    makeReport(many, makeUser({ email: `${tag}-r1@example.com` }));
    makeReport(many, makeUser({ email: `${tag}-r2@example.com` }));
    makeReport(few, makeUser({ email: `${tag}-r3@example.com` }));

    const list = (await api(`/admin/members?pageSize=100&sort=reports&query=${tag}-`, { token: adminToken() })).json;
    const manyIdx = list.members.findIndex((m) => m.id === many);
    const fewIdx = list.members.findIndex((m) => m.id === few);
    expect(manyIdx).toBeGreaterThanOrEqual(0);
    expect(manyIdx).toBeLessThan(fewIdx); // more-reported ranks first
  });
});

// ---------------------------------------------------------------------------
// Member-email-domain breakdown.
// ---------------------------------------------------------------------------
describe('GET /admin/telemetry/member-domains', () => {
  it('groups real members by email domain, test/demo excluded', async () => {
    const tag = `dom${Date.now()}`;
    makeUser({ email: `${tag}-1@gmail.com` });
    makeUser({ email: `${tag}-2@gmail.com` });
    makeUser({ email: `${tag}-3@proton.me` });
    makeUser({ email: `${tag}-x@spectrum-test.dev` }); // excluded
    makeUser({ email: `${tag}-y@sample.spectrum-dating.app` }); // excluded

    const { rows } = (await api('/admin/telemetry/member-domains', { token: adminToken() })).json;
    const gmail = rows.find((r) => r.label === 'gmail.com');
    const proton = rows.find((r) => r.label === 'proton.me');
    expect(gmail.count).toBeGreaterThanOrEqual(2);
    expect(proton.count).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.label === 'spectrum-test.dev')).toBeUndefined();
    expect(rows.find((r) => r.label === 'sample.spectrum-dating.app')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Detail composition.
// ---------------------------------------------------------------------------
describe('GET /admin/members/:id — detail', () => {
  it('composes userContext + reports-against + history counts + status/age/lastActive', async () => {
    const created = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    const subject = makeUser({
      email: 'subject@example.com', verified: 1, distCity: 'Austin, TX',
      lastActive: '2026-07-01', createdAt: created, displayName: 'Subject Person',
    });
    const reporterA = makeUser({ email: 'ra@example.com', displayName: 'Reporter A' });
    makeReport(subject, reporterA, { status: 'open' });
    makeReport(subject, makeUser({ email: 'rb@example.com' }), { status: 'actioned' });
    addBlock(makeUser({ email: 'b1@example.com' }), subject);

    const detail = (await api(`/admin/members/${subject}`, { token: adminToken() })).json;

    expect(detail.userContext.userId).toBe(subject);
    expect(detail.userContext.email).toBe('subject@example.com');
    expect(detail.userContext.displayName).toBe('Subject Person');
    expect(detail.userContext.distCity).toBe('Austin, TX');
    expect(detail.verified).toBe(true);
    expect(detail.suspended).toBe(false);
    expect(detail.lastActiveAt).toBe('2026-07-01');
    expect(detail.accountAgeMs).toBeGreaterThan(9 * 24 * 60 * 60 * 1000);

    expect(detail.reportsAgainst).toBe(2);
    expect(detail.reportsActioned).toBe(1);
    expect(detail.distinctBlockers).toBe(1);
    expect(detail.reportsAgainstList).toHaveLength(2);
    // Reporter display name resolves in the list.
    expect(detail.reportsAgainstList.some((r) => r.reporterName === 'Reporter A')).toBe(true);
  });

  it('404s for an unknown member id', async () => {
    const r = await api('/admin/members/does-not-exist', { token: adminToken() });
    expect(r.status).toBe(404);
  });
});
