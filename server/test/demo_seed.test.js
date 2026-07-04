// demo_seed.test.js — the shared demo-dataset module (src/telemetry/demoSeed.js)
// behind the CLI seed script AND the POST /admin/telemetry/demo endpoint.
//
// SAFETY is the whole point: the demo data MUST stay is_demo-flagged /
// `telemetry-demo-`-prefixed so it can NEVER pollute the real member count or
// real telemetry (the "597" discipline). These tests prove:
//   • load inserts ~500 varied demo members + moderation activity
//     (reports/blocks/verifications/feedback) tied to them,
//   • variety is present across gender / orientation / seeking / city / age,
//   • clear removes ONLY the demo dataset (incl. the new activity rows),
//   • a planted real (is_demo=0) row + an existing @sample seed persona both
//     SURVIVE a load and a clear,
//   • load is idempotent (re-running does NOT stack duplicate demo rows),
//   • GET /admin/population?demo=1 INCLUDES demo members while the default view
//     EXCLUDES them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-demoseed-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-demo-seed-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@spectrum-test.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminPopulationRouter = (await import('../src/routes/adminPopulation.js')).default;
const { loadDemoData, wipeDemoData, DEMO_MEMBER_PREFIX, DEMO_MEMBER_COUNT } = await import('../src/telemetry/demoSeed.js');

const db = getDb();
const DEMO_LIKE = `${DEMO_MEMBER_PREFIX}%@sample.spectrum-dating.app`;

// Counting helpers.
const demoPv = () => db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE is_demo = 1').get().c;
const realPv = () => db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE is_demo = 0').get().c;
const demoDaily = () => db.prepare('SELECT COUNT(*) AS c FROM visit_daily WHERE is_demo = 1').get().c;
const demoInc = () => db.prepare('SELECT COUNT(*) AS c FROM uptime_incident WHERE is_demo = 1').get().c;
const demoMembers = () => db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ?').get(DEMO_LIKE).c;
const demoIdSub = '(SELECT id FROM users WHERE email LIKE ?)';
const demoReports = () => db.prepare(
  `SELECT COUNT(*) AS c FROM reports WHERE reporter_id IN ${demoIdSub} OR reported_id IN ${demoIdSub}`
).get(DEMO_LIKE, DEMO_LIKE).c;
const demoBlocks = () => db.prepare(
  `SELECT COUNT(*) AS c FROM blocks WHERE blocker_id IN ${demoIdSub} OR blocked_id IN ${demoIdSub}`
).get(DEMO_LIKE, DEMO_LIKE).c;
const demoVerifications = () => db.prepare(
  `SELECT COUNT(*) AS c FROM verification_requests WHERE user_id IN ${demoIdSub}`
).get(DEMO_LIKE).c;
const demoFeedback = () => db.prepare(
  `SELECT COUNT(*) AS c FROM feedback WHERE user_id IN ${demoIdSub}`
).get(DEMO_LIKE).c;
// Distinct non-empty values of a profile column across the demo members.
const distinctProfileVals = (col) => db.prepare(
  `SELECT COUNT(DISTINCT ${col}) AS c FROM profiles p JOIN users u ON u.id = p.user_id
    WHERE u.email LIKE ? AND ${col} != ''`
).get(DEMO_LIKE).c;

// A planted REAL telemetry row + an existing @sample seed persona that is NOT a
// telemetry-demo- member — both must be untouched by load and clear.
const REAL_PV_SESSION = 'real-session-hash-keepme';
const SAMPLE_PERSONA_EMAIL = 'existing-persona@sample.spectrum-dating.app';
const realPvSurvives = () =>
  db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE session_hash = ? AND is_demo = 0').get(REAL_PV_SESSION).c;
const samplePersonaSurvives = () =>
  db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get(SAMPLE_PERSONA_EMAIL).c;

let server;
let baseUrl;
let adminId;
const adminToken = () => signToken(adminId, 0);
async function api(path, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

beforeAll(async () => {
  // Plant a real (is_demo=0) page view.
  db.prepare(
    `INSERT INTO page_views (ts, path, referrer_domain, country, region, session_hash, is_demo)
     VALUES (?, '/real', 'google.com', 'US', 'CA', ?, 0)`
  ).run(Date.now(), REAL_PV_SESSION);
  // Plant a real (is_demo=0) visit_daily rollup + a real uptime incident.
  db.prepare(`INSERT INTO visit_daily (day, is_demo, views, uniques) VALUES ('2026-06-01', 0, 5, 3)`).run();
  db.prepare(
    `INSERT INTO uptime_incident (id, started_at, ended_at, duration_ms, kind, note, is_demo)
     VALUES ('real-inc', ?, ?, 60000, 'gap', 'real', 0)`
  ).run(Date.now() - 60000, Date.now());
  // Plant an EXISTING @sample seed persona that is NOT a telemetry-demo- member,
  // WITH a profile so it would show up in population if the prefix guard failed.
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('persona-1', SAMPLE_PERSONA_EMAIL, 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, gender, dist_city, updated_at) VALUES (?,?,?,?,?)')
    .run('persona-1', 'Persona One', 'woman', 'Nowhere', Date.now());
  // Admin (test-domain email → excluded from real aggregates).
  adminId = 'admin-1';
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(adminId, 'admin@spectrum-test.dev', 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(adminId, 'Admin', Date.now());

  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/admin', adminPopulationRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('demoSeed — load / clear safety (the "597" discipline)', () => {
  it('loadDemoData inserts ~500 varied demo members + telemetry', () => {
    const counts = loadDemoData(db);

    expect(counts.pageViews).toBeGreaterThan(0);
    expect(counts.visitDaily).toBe(30);
    expect(counts.incidents).toBe(2);
    expect(counts.members).toBe(DEMO_MEMBER_COUNT);
    expect(DEMO_MEMBER_COUNT).toBe(500);

    // DB agrees.
    expect(demoPv()).toBe(counts.pageViews);
    expect(demoDaily()).toBe(30);
    expect(demoInc()).toBe(2);
    expect(demoMembers()).toBe(500);
  });

  it('members have realistic VARIETY across every reported field', () => {
    // Gender: the expanded set (many distinct values, not just woman/man).
    expect(distinctProfileVals('gender')).toBeGreaterThanOrEqual(8);
    // Orientation (comma-joined multi-select) uses several distinct combos.
    expect(distinctProfileVals('orientation')).toBeGreaterThanOrEqual(6);
    // Seeking spread + a healthy share of "" (open to everyone).
    expect(distinctProfileVals('seeking')).toBeGreaterThanOrEqual(4);
    const openSeeking = db.prepare(
      `SELECT COUNT(*) AS c FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE u.email LIKE ? AND p.seeking = ''`
    ).get(DEMO_LIKE).c;
    expect(openSeeking).toBeGreaterThan(0);
    // Cities spread across many metros.
    expect(distinctProfileVals('dist_city')).toBeGreaterThanOrEqual(15);
    // Ages span the tails (a real DOB spread, not all one band).
    const ages = db.prepare(
      `SELECT MIN(date_of_birth) AS oldest, MAX(date_of_birth) AS youngest
         FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE u.email LIKE ? AND date_of_birth != ''`
    ).get(DEMO_LIKE);
    // youngest DOB year - oldest DOB year > 20 → a real multi-decade spread.
    const span = parseInt(ages.youngest.slice(0, 4), 10) - parseInt(ages.oldest.slice(0, 4), 10);
    expect(span).toBeGreaterThan(20);
    // Every demo member carries a bundled /demo-avatars/NN.jpg photo, cycled
    // across ≤12 distinct images.
    const photos = db.prepare(
      `SELECT COUNT(DISTINCT photo_url) AS c FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE u.email LIKE ? AND photo_url LIKE '/demo-avatars/%'`
    ).get(DEMO_LIKE).c;
    expect(photos).toBeGreaterThan(1);
    expect(photos).toBeLessThanOrEqual(12);
    // DECK-SAFETY: every demo member is paused (hidden from Discover).
    const notPaused = db.prepare(
      `SELECT COUNT(*) AS c FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE u.email LIKE ? AND p.paused = 0`
    ).get(DEMO_LIKE).c;
    expect(notPaused).toBe(0);
    // Some suspended, some verified — the state mix populates.
    const suspended = db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ? AND suspended = 1').get(DEMO_LIKE).c;
    const verified = db.prepare(
      `SELECT COUNT(*) AS c FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE u.email LIKE ? AND p.identity_verified = 1`
    ).get(DEMO_LIKE).c;
    expect(suspended).toBeGreaterThan(0);
    expect(verified).toBeGreaterThan(0);
  });

  it('seeds moderation activity (reports/blocks/verifications/feedback)', () => {
    const before = loadDemoData(db); // fresh load; assert its reported counts
    expect(before.reports).toBeGreaterThan(30);
    expect(before.blocks).toBeGreaterThan(10);
    expect(before.verifications).toBeGreaterThan(0);
    expect(before.feedback).toBeGreaterThan(0);
    // DB agrees.
    expect(demoReports()).toBe(before.reports);
    expect(demoBlocks()).toBe(before.blocks);
    expect(demoVerifications()).toBe(before.verifications);
    expect(demoFeedback()).toBe(before.feedback);
    // Repeat-offender signal: at least one demo member reported more than once.
    const maxAgainst = db.prepare(
      `SELECT MAX(c) AS m FROM (SELECT COUNT(*) AS c FROM reports
         WHERE reported_id IN ${demoIdSub} GROUP BY reported_id)`
    ).get(DEMO_LIKE).m;
    expect(maxAgainst).toBeGreaterThan(1);
    // A mix of report statuses (not all 'open').
    const statuses = db.prepare(
      `SELECT COUNT(DISTINCT status) AS c FROM reports WHERE reported_id IN ${demoIdSub}`
    ).get(DEMO_LIKE).c;
    expect(statuses).toBeGreaterThan(1);
    // Resolved reports carry a resolver + note.
    const resolved = db.prepare(
      `SELECT COUNT(*) AS c FROM reports
        WHERE reported_id IN ${demoIdSub} AND status != 'open'
          AND resolved_at IS NOT NULL AND moderator_note IS NOT NULL`
    ).get(DEMO_LIKE).c;
    expect(resolved).toBeGreaterThan(0);
  });

  it('load leaves the planted REAL row + the existing @sample persona untouched', () => {
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
    expect(realPv()).toBe(1); // exactly the one real page view we planted
  });

  it('load is idempotent — re-running does NOT stack duplicate demo rows', () => {
    const before = {
      pv: demoPv(), daily: demoDaily(), inc: demoInc(), mem: demoMembers(),
      reports: demoReports(), blocks: demoBlocks(), ver: demoVerifications(), fb: demoFeedback(),
    };
    loadDemoData(db); // another load
    expect(demoDaily()).toBe(before.daily);
    expect(demoInc()).toBe(before.inc);
    expect(demoMembers()).toBe(before.mem); // exactly 500, not 1000
    expect(demoFeedback()).toBe(before.fb);
    // page_views / reports / blocks are randomized per load but must NOT ~2×.
    expect(demoPv()).toBeLessThan(before.pv * 2);
    expect(demoReports()).toBeLessThan(before.reports * 2);
    expect(demoBlocks()).toBeLessThan(before.blocks * 2);
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
  });

  it('GET /admin/population?demo=1 INCLUDES demo members; default EXCLUDES', async () => {
    const real = (await api('/admin/population', { token: adminToken() })).json;
    const withDemo = (await api('/admin/population?demo=1', { token: adminToken() })).json;
    // Default view excludes the WHOLE @sample domain (both the telemetry-demo-
    // members and the legacy @sample persona) + the test-domain admin → 0 real.
    expect(real.demo).toBe(false);
    expect(real.totalMembers).toBe(0);
    // Demo view includes every @sample account: 500 demo members + the persona.
    expect(withDemo.demo).toBe(true);
    expect(withDemo.totalMembers).toBe(500 + 1);
  });

  it('wipeDemoData removes 100% of the demo dataset (incl. activity rows)', () => {
    const counts = wipeDemoData(db);

    // Everything demo is gone.
    expect(demoPv()).toBe(0);
    expect(demoDaily()).toBe(0);
    expect(demoInc()).toBe(0);
    expect(demoMembers()).toBe(0);
    expect(demoReports()).toBe(0);
    expect(demoBlocks()).toBe(0);
    expect(demoVerifications()).toBe(0);
    expect(demoFeedback()).toBe(0);

    // Deleted-row counts are reported and non-zero for every table.
    expect(counts.pageViews).toBeGreaterThan(0);
    expect(counts.visitDaily).toBe(30);
    expect(counts.incidents).toBe(2);
    expect(counts.members).toBe(500);
    expect(counts.reports).toBeGreaterThan(0);
    expect(counts.blocks).toBeGreaterThan(0);
    expect(counts.verifications).toBeGreaterThan(0);
    expect(counts.feedback).toBeGreaterThan(0);

    // The planted REAL row + real rollup/incident + @sample persona all SURVIVE.
    expect(realPvSurvives()).toBe(1);
    expect(realPv()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS c FROM visit_daily WHERE is_demo = 0").get().c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS c FROM uptime_incident WHERE is_demo = 0").get().c).toBe(1);
  });

  it('clear on an already-clean DB is a safe no-op for real data', () => {
    const counts = wipeDemoData(db);
    expect(counts.pageViews).toBe(0);
    expect(counts.members).toBe(0);
    expect(counts.reports).toBe(0);
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
  });
});
