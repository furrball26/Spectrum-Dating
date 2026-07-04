// Telemetry (Phase 0 capture + Phase 1 admin aggregations) backend tests.
//
// PRIVACY assertions are first-class here: the ingest pipeline must write a
// COARSE row and must NEVER persist the raw IP; DNT/GPC must record nothing; the
// session_hash must differ across salt days (no cross-day tracking). Also proves
// the daily rollup + 30d prune, the uptime pct overlap math, the demo/real
// telemetry split, migrations 045/046 booting clean ×3, and lazy last_active.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

// Deterministic, offline geo — assert the pipeline stores exactly what the geo
// module returns (and NOTHING derived from the raw IP beyond that).
vi.mock('../src/telemetry/geo.js', () => ({
  lookupGeo: () => ({ country: 'US', region: 'CA' }),
}));

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-telem-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-telemetry-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@t.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb, runMigrations } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;
const telemetryRouter = (await import('../src/routes/telemetry.js')).default;
const { lastActiveMiddleware } = await import('../src/middleware/lastActive.js');
const {
  ingestPageview, flushBuffer, _bufferSize, _resetBuffer,
} = await import('../src/telemetry/ingest.js');
const { computeSessionHash, getDailySalt, utcDay } = await import('../src/telemetry/salt.js');
const { runDailyMaintenance, rollupDay } = await import('../src/telemetry/scheduler.js');

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_IP = '203.0.113.45'; // TEST-NET-3 documentation IP — must never persist.

function makeUser({ email, suspended = 0 } = {}) {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,?)')
    .run(id, email || `${id}@t.dev`, 'x', Date.now(), suspended);
  return id;
}

function insertPageView({ ts = Date.now(), path = '/', referrer = '', country = 'US', region = '', session = 'h', isDemo = 0 } = {}) {
  db.prepare(
    `INSERT INTO page_views (ts, path, referrer_domain, country, region, session_hash, is_demo)
     VALUES (?,?,?,?,?,?,?)`
  ).run(ts, path, referrer, country, region, session, isDemo);
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
  app.use('/telemetry', telemetryRouter);
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
// Migrations 045 / 046 boot clean + idempotent (×3).
// ---------------------------------------------------------------------------
describe('migrations 045 / 046 (telemetry + last_active)', () => {
  function freshDb() {
    const dir = mkdtempSync(join(tmpdir(), 'spectrum-telem-mig-'));
    const d = new Database(join(dir, 'm.db'));
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    return { d, dir };
  }
  function hasTable(d, name) {
    return !!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  }
  function hasCol(d, table, col) {
    return d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }

  it('creates the 5 telemetry tables + users.last_active_at and survives 3 boots', () => {
    const { d, dir } = freshDb();
    try {
      expect(() => { runMigrations(d); runMigrations(d); runMigrations(d); }).not.toThrow();
      for (const t of ['page_views', 'visit_daily', 'service_heartbeat', 'uptime_incident', 'telemetry_salt']) {
        expect(hasTable(d, t)).toBe(true);
      }
      expect(hasCol(d, 'users', 'last_active_at')).toBe(true);
      // page_views has NO user_id column by design (no member↔browsing link).
      expect(hasCol(d, 'page_views', 'user_id')).toBe(false);
    } finally {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Ingest pipeline — coarse row, NO raw IP, DNT/GPC drop, bot drop.
// ---------------------------------------------------------------------------
describe('ingest pipeline (privacy-critical)', () => {
  it('writes ONE coarse row and NEVER persists the raw IP', () => {
    _resetBuffer();
    const before = db.prepare('SELECT COUNT(*) AS c FROM page_views').get().c;
    const ev = ingestPageview({
      db,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605' },
      ip: RAW_IP,
      body: { path: '/discover?token=secret#frag', referrer: 'https://news.ycombinator.com/item?id=1' },
    });
    // The buffered event carries coarse geo + hashed session, no ip/ua.
    expect(ev).not.toBeNull();
    expect(ev.country).toBe('US');
    expect(ev.region).toBe('CA');
    expect(ev.path).toBe('/discover'); // query + fragment stripped
    expect(ev.referrer_domain).toBe('news.ycombinator.com'); // hostname only
    expect(ev).not.toHaveProperty('ip');
    expect(ev).not.toHaveProperty('userAgent');

    expect(_bufferSize()).toBe(1);
    const written = flushBuffer(db);
    expect(written).toBe(1);
    const after = db.prepare('SELECT COUNT(*) AS c FROM page_views').get().c;
    expect(after).toBe(before + 1);

    // The raw IP must appear in NO column of NO row, ever.
    const cols = ['path', 'referrer_domain', 'country', 'region', 'session_hash'];
    const rows = db.prepare('SELECT * FROM page_views').all();
    for (const row of rows) {
      for (const c of cols) {
        expect(String(row[c])).not.toContain(RAW_IP);
      }
    }
    // session_hash is a 64-char hex HMAC — non-reversible, not the raw IP.
    const latest = db.prepare('SELECT session_hash, is_demo FROM page_views ORDER BY id DESC LIMIT 1').get();
    expect(latest.session_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(latest.session_hash).not.toContain(RAW_IP);
    expect(latest.is_demo).toBe(0); // real ingest is always is_demo=0
  });

  it('DNT:1 records NOTHING', () => {
    _resetBuffer();
    const ev = ingestPageview({
      db, headers: { dnt: '1', 'user-agent': 'Mozilla/5.0 Safari' }, ip: RAW_IP, body: { path: '/x' },
    });
    expect(ev).toBeNull();
    expect(_bufferSize()).toBe(0);
  });

  it('Sec-GPC:1 records NOTHING', () => {
    _resetBuffer();
    const ev = ingestPageview({
      db, headers: { 'sec-gpc': '1', 'user-agent': 'Mozilla/5.0 Safari' }, ip: RAW_IP, body: { path: '/x' },
    });
    expect(ev).toBeNull();
    expect(_bufferSize()).toBe(0);
  });

  it('bot / empty user-agents are dropped', () => {
    _resetBuffer();
    expect(ingestPageview({ db, headers: { 'user-agent': 'python-requests/2.31' }, ip: RAW_IP, body: { path: '/x' } })).toBeNull();
    expect(ingestPageview({ db, headers: { 'user-agent': 'Googlebot/2.1' }, ip: RAW_IP, body: { path: '/x' } })).toBeNull();
    expect(ingestPageview({ db, headers: {}, ip: RAW_IP, body: { path: '/x' } })).toBeNull();
    expect(_bufferSize()).toBe(0);
  });

  it('own-origin referrer is normalized to "" (not counted as a traffic source)', () => {
    _resetBuffer();
    const ev = ingestPageview({
      db,
      headers: { 'user-agent': 'Mozilla/5.0 Safari' },
      ip: RAW_IP,
      body: { path: '/messages', referrer: 'https://spectrum-dating-eta.vercel.app/discover' },
      ownHosts: new Set(['spectrum-dating-eta.vercel.app']),
    });
    expect(ev.referrer_domain).toBe('');
  });

  it('POST /telemetry/pageview always returns 204 and never surfaces an error', async () => {
    const res = await fetch(`${baseUrl}/telemetry/pageview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Safari' },
      body: JSON.stringify({ path: '/discover', referrer: '' }),
    });
    expect(res.status).toBe(204);
    // A DNT beacon is also 204 (dropped silently).
    const dnt = await fetch(`${baseUrl}/telemetry/pageview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', dnt: '1', 'user-agent': 'Mozilla/5.0 Safari' },
      body: JSON.stringify({ path: '/x' }),
    });
    expect(dnt.status).toBe(204);
  });

  it('accepts a text/plain beacon body (sendBeacon-style)', () => {
    _resetBuffer();
    // parseBeaconBody path: a raw JSON string is parsed defensively.
    const ev = ingestPageview({
      db,
      headers: { 'user-agent': 'Mozilla/5.0 Safari' },
      ip: RAW_IP,
      body: JSON.stringify({ path: '/settings', referrer: '' }),
    });
    expect(ev.path).toBe('/settings');
  });
});

// ---------------------------------------------------------------------------
// Session hash differs across salt days (no cross-day correlation).
// ---------------------------------------------------------------------------
describe('session_hash + salt rotation', () => {
  it('same ip+ua yields DIFFERENT hashes on different salt days', () => {
    const ip = '198.51.100.7';
    const ua = 'Mozilla/5.0 Safari';
    const day1 = '2026-01-01';
    const day2 = '2026-01-02';
    // Ensure distinct salts exist for the two days.
    const s1 = getDailySalt(db, day1);
    const s2 = getDailySalt(db, day2);
    expect(s1).not.toBe(s2);

    const h1 = computeSessionHash(db, ip, ua, day1);
    const h2 = computeSessionHash(db, ip, ua, day2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toBe(h2); // cross-day tracking impossible by construction

    // Same day + same ip+ua is stable (uniqueness key within a day).
    expect(computeSessionHash(db, ip, ua, day1)).toBe(h1);
  });
});

// ---------------------------------------------------------------------------
// Daily rollup + 30d prune + salt pruning.
// ---------------------------------------------------------------------------
describe('daily maintenance (rollup + prune + salt rotation)', () => {
  it('rolls a day into visit_daily with views + DISTINCT-session uniques, split by is_demo', () => {
    const day = '2026-03-10';
    const base = Date.parse(`${day}T06:00:00.000Z`);
    // 3 real views, 2 distinct sessions; 1 demo view.
    insertPageView({ ts: base, session: 'A', isDemo: 0 });
    insertPageView({ ts: base + 1000, session: 'A', isDemo: 0 });
    insertPageView({ ts: base + 2000, session: 'B', isDemo: 0 });
    insertPageView({ ts: base + 3000, session: 'Z', isDemo: 1 });

    rollupDay(db, day);

    const real = db.prepare('SELECT views, uniques FROM visit_daily WHERE day = ? AND is_demo = 0').get(day);
    expect(real.views).toBe(3);
    expect(real.uniques).toBe(2);
    const demo = db.prepare('SELECT views, uniques FROM visit_daily WHERE day = ? AND is_demo = 1').get(day);
    expect(demo.views).toBe(1);
    expect(demo.uniques).toBe(1);
  });

  it('runDailyMaintenance prunes page_views older than 30 days and rotates salt (drops >2d)', () => {
    const now = Date.parse('2026-04-15T12:00:00.000Z');
    const old = now - 31 * DAY_MS;       // beyond 30d retention → pruned
    const recent = now - 2 * DAY_MS;     // inside retention → kept
    insertPageView({ ts: old, session: 'OLD' });
    insertPageView({ ts: recent, session: 'NEW' });

    // Seed an ancient salt that must be dropped, plus a day-old one that stays.
    db.prepare('INSERT OR REPLACE INTO telemetry_salt (day, salt) VALUES (?, ?)').run(utcDay(now - 10 * DAY_MS), 'ancient');
    db.prepare('INSERT OR REPLACE INTO telemetry_salt (day, salt) VALUES (?, ?)').run(utcDay(now - 1 * DAY_MS), 'yesterday');

    runDailyMaintenance(db, now);

    expect(db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE ts = ?').get(old).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE ts = ?').get(recent).c).toBe(1);
    // Ancient salt pruned, recent salt + today's fresh salt remain.
    expect(db.prepare('SELECT COUNT(*) AS c FROM telemetry_salt WHERE day = ?').get(utcDay(now - 10 * DAY_MS)).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM telemetry_salt WHERE day = ?').get(utcDay(now)).c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Admin telemetry aggregations — demo/real split + uptime overlap math.
// ---------------------------------------------------------------------------
describe('admin telemetry endpoints', () => {
  const now = Date.now();

  it('overview / geo / referrers EXCLUDE is_demo=1 by default, INCLUDE it with ?demo=1', async () => {
    // 2 real + 3 demo views in the last hour, distinct referrers/countries.
    insertPageView({ ts: now - 1000, path: '/discover', referrer: 'google.com', country: 'US', session: 'r1', isDemo: 0 });
    insertPageView({ ts: now - 2000, path: '/discover', referrer: 'google.com', country: 'US', session: 'r2', isDemo: 0 });
    insertPageView({ ts: now - 3000, path: '/demo', referrer: 'twitter.com', country: 'GB', session: 'd1', isDemo: 1 });
    insertPageView({ ts: now - 4000, path: '/demo', referrer: 'twitter.com', country: 'GB', session: 'd2', isDemo: 1 });
    insertPageView({ ts: now - 5000, path: '/demo', referrer: 'twitter.com', country: 'GB', session: 'd3', isDemo: 1 });

    const real = (await api('/admin/telemetry/overview?window=24h', { token: adminToken() })).json;
    // Real overview must NOT see the demo rows.
    expect(real.demo).toBe(false);
    expect(real.topPaths.find((p) => p.label === '/demo')).toBeUndefined();
    const realDiscover = real.topPaths.find((p) => p.label === '/discover');
    expect(realDiscover.count).toBeGreaterThanOrEqual(2);

    const demo = (await api('/admin/telemetry/overview?window=24h&demo=1', { token: adminToken() })).json;
    expect(demo.demo).toBe(true);
    expect(demo.topPaths.find((p) => p.label === '/demo').count).toBe(3);
    expect(demo.uniqueVisitors).toBe(3);
    // The real /discover rows must NOT appear in the demo view.
    expect(demo.topPaths.find((p) => p.label === '/discover')).toBeUndefined();

    // Geo split.
    const realGeo = (await api('/admin/telemetry/geo?window=24h', { token: adminToken() })).json;
    expect(realGeo.rows.find((r) => r.country === 'GB')).toBeUndefined();
    const demoGeo = (await api('/admin/telemetry/geo?window=24h&demo=1', { token: adminToken() })).json;
    expect(demoGeo.rows.find((r) => r.country === 'GB').count).toBe(3);

    // Referrer split.
    const realRef = (await api('/admin/telemetry/referrers?window=24h', { token: adminToken() })).json;
    expect(realRef.rows.find((r) => r.label === 'twitter.com')).toBeUndefined();
    const demoRef = (await api('/admin/telemetry/referrers?window=24h&demo=1', { token: adminToken() })).json;
    expect(demoRef.rows.find((r) => r.label === 'twitter.com').count).toBe(3);
  });

  it('uptime pct subtracts incident overlap clipped to each window', async () => {
    // Fresh heartbeat + two incidents: one 1h fully inside 24h, one straddling
    // the 24h boundary (only 1h of its 2h overlaps the 24h window).
    db.prepare(
      `INSERT INTO service_heartbeat (id, last_beat_at, process_started_at)
       VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_beat_at=excluded.last_beat_at, process_started_at=excluded.process_started_at`
    ).run(now, now - 3 * DAY_MS);

    db.prepare('DELETE FROM uptime_incident').run();
    const H = 60 * 60 * 1000;
    // Incident 1: [now-5h, now-4h] → 1h inside 24h.
    db.prepare(`INSERT INTO uptime_incident (id, started_at, ended_at, duration_ms, kind, note, is_demo) VALUES (?,?,?,?,?,?,?)`)
      .run('inc1', now - 5 * H, now - 4 * H, H, 'gap', '', 0);
    // Incident 2: [now-25h, now-23h] → straddles the 24h edge, only [now-24h, now-23h] = 1h counts.
    db.prepare(`INSERT INTO uptime_incident (id, started_at, ended_at, duration_ms, kind, note, is_demo) VALUES (?,?,?,?,?,?,?)`)
      .run('inc2', now - 25 * H, now - 23 * H, 2 * H, 'gap', '', 0);

    const up = (await api('/admin/telemetry/uptime', { token: adminToken() })).json;
    expect(up.layer).toBe('application');
    expect(up.processStartedAt).toBeLessThan(now);
    expect(up.currentUptimeMs).toBeGreaterThan(0);

    // 24h window: 1h (inc1) + 1h (clipped inc2) = 2h downtime out of 24h.
    // precision 2 (diff < 0.005) still cleanly separates the clipped result
    // (91.67%) from the unclipped one (87.5%) — proving overlap is windowed.
    const expected24 = ((24 - 2) / 24) * 100;
    expect(up.windows['24h']).toBeCloseTo(expected24, 2);
    // 7d window: full 1h + full 2h = 3h downtime out of 168h.
    const expected7d = ((168 - 3) / 168) * 100;
    expect(up.windows['7d']).toBeCloseTo(expected7d, 2);
    expect(up.incidents.length).toBe(2);
  });

  it('all telemetry endpoints require admin (403 for a non-admin, 401 for anon)', async () => {
    const plain = makeUser({ email: 'plain@t.dev' });
    const plainTok = signToken(plain, 0);
    expect((await api('/admin/telemetry/overview', { token: plainTok })).status).toBe(403);
    expect((await api('/admin/telemetry/overview')).status).toBe(401);
    expect((await api('/admin/members', { token: plainTok })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Lazy last_active — one write per user per day max.
// ---------------------------------------------------------------------------
describe('lazy last_active_at', () => {
  it('sets today once and does NOT re-write when already today', () => {
    const target = makeUser({ email: 'active@t.dev' });
    const today = utcDay();

    let updateCount = 0;
    const spyDb = {
      prepare(sql) {
        const stmt = db.prepare(sql);
        if (/^UPDATE users SET last_active_at/.test(sql.trim())) {
          return { run: (...a) => { updateCount++; return stmt.run(...a); } };
        }
        return stmt;
      },
    };
    const mw = lastActiveMiddleware(spyDb);
    const run = () => new Promise((resolve) => mw({ ctx: { userId: target } }, {}, resolve));

    // Precondition: default ''.
    expect(db.prepare('SELECT last_active_at FROM users WHERE id = ?').get(target).last_active_at).toBe('');

    return run().then(() => {
      expect(db.prepare('SELECT last_active_at FROM users WHERE id = ?').get(target).last_active_at).toBe(today);
      expect(updateCount).toBe(1);
      return run();
    }).then(() => {
      // Second request same day → no additional write.
      expect(updateCount).toBe(1);
    });
  });
});
