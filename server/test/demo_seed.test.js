// demo_seed.test.js — the shared demo-dataset module (src/telemetry/demoSeed.js)
// behind the CLI seed script AND the POST /admin/telemetry/demo endpoint.
//
// SAFETY is the whole point: the demo data MUST stay is_demo-flagged /
// `telemetry-demo-`-prefixed so it can NEVER pollute the real member count or
// real telemetry (the "597" discipline). These tests prove:
//   • load inserts is_demo=1 telemetry rows + telemetry-demo- demo members,
//   • clear removes ONLY those,
//   • a planted real (is_demo=0) row + an existing @sample seed persona both
//     SURVIVE a load and a clear,
//   • load is idempotent (re-running does NOT stack duplicate demo rows).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-demoseed-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-demo-seed-suite';
process.env.NODE_ENV = 'test';

const { getDb } = await import('../src/db.js');
const { loadDemoData, wipeDemoData, DEMO_MEMBER_PREFIX } = await import('../src/telemetry/demoSeed.js');

const db = getDb();

// Counting helpers.
const demoPv = () => db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE is_demo = 1').get().c;
const realPv = () => db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE is_demo = 0').get().c;
const demoDaily = () => db.prepare('SELECT COUNT(*) AS c FROM visit_daily WHERE is_demo = 1').get().c;
const demoInc = () => db.prepare('SELECT COUNT(*) AS c FROM uptime_incident WHERE is_demo = 1').get().c;
const demoMembers = () => db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ?')
  .get(`${DEMO_MEMBER_PREFIX}%@sample.spectrum-dating.app`).c;

// A planted REAL telemetry row + an existing @sample seed persona that is NOT a
// telemetry-demo- member — both must be untouched by load and clear.
const REAL_PV_SESSION = 'real-session-hash-keepme';
const SAMPLE_PERSONA_EMAIL = 'existing-persona@sample.spectrum-dating.app';
const realPvSurvives = () =>
  db.prepare('SELECT COUNT(*) AS c FROM page_views WHERE session_hash = ? AND is_demo = 0').get(REAL_PV_SESSION).c;
const samplePersonaSurvives = () =>
  db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get(SAMPLE_PERSONA_EMAIL).c;

beforeAll(() => {
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
  // Plant an EXISTING @sample seed persona that is NOT a telemetry-demo- member.
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('persona-1', SAMPLE_PERSONA_EMAIL, 'x', Date.now());
});

afterAll(() => {
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('demoSeed — load / clear safety (the "597" discipline)', () => {
  it('loadDemoData inserts is_demo=1 telemetry rows + telemetry-demo- demo members', () => {
    const counts = loadDemoData(db);

    // Reports what it inserted.
    expect(counts.pageViews).toBeGreaterThan(0);
    expect(counts.visitDaily).toBe(30);
    expect(counts.incidents).toBe(2);
    expect(counts.members).toBe(6);

    // And the DB agrees.
    expect(demoPv()).toBe(counts.pageViews);
    expect(demoDaily()).toBe(30);
    expect(demoInc()).toBe(2);
    expect(demoMembers()).toBe(6);
  });

  it('load leaves the planted REAL row + the existing @sample persona untouched', () => {
    // (load already ran above)
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
    expect(realPv()).toBe(1); // exactly the one real page view we planted
  });

  it('load is idempotent — re-running does NOT stack duplicate demo rows', () => {
    const before = { pv: demoPv(), daily: demoDaily(), inc: demoInc(), mem: demoMembers() };
    loadDemoData(db); // second load
    // Demo members / rollups / incidents are fixed-size, so counts must be stable.
    expect(demoDaily()).toBe(before.daily);
    expect(demoInc()).toBe(before.inc);
    expect(demoMembers()).toBe(before.mem);
    // page_views count is randomized per load, but must NOT be ~2× (no stacking).
    expect(demoPv()).toBeLessThan(before.pv * 2);
    // Real data still intact after a re-load.
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
  });

  it('wipeDemoData removes ONLY is_demo=1 telemetry + telemetry-demo- members', () => {
    const counts = wipeDemoData(db);

    // Everything demo is gone.
    expect(demoPv()).toBe(0);
    expect(demoDaily()).toBe(0);
    expect(demoInc()).toBe(0);
    expect(demoMembers()).toBe(0);

    // Deleted-row counts are reported and non-zero.
    expect(counts.pageViews).toBeGreaterThan(0);
    expect(counts.visitDaily).toBe(30);
    expect(counts.incidents).toBe(2);
    expect(counts.members).toBe(6);

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
    // Real data still there.
    expect(realPvSurvives()).toBe(1);
    expect(samplePersonaSurvives()).toBe(1);
  });
});
