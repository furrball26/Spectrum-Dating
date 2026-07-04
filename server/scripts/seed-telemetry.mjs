// seed-telemetry.mjs — populate the telemetry + member-management dashboard with
// a realistic DEMO dataset so the live demo is populated from day one.
//
// Sibling of seed-users.mjs, but this one writes DIRECTLY to the SQLite DB (the
// telemetry tables have no public ingest for backfill) via the same getDb()
// used by the server — so it runs the migrations first and honours DB_PATH.
//   Local:   node server/scripts/seed-telemetry.mjs
//   Railway: DB_PATH=/data/spectrum.db node scripts/seed-telemetry.mjs
//   Wipe:    node server/scripts/seed-telemetry.mjs --wipe
//
// EVERYTHING it inserts is tagged is_demo=1 (telemetry) or uses the reserved
// email prefix `telemetry-demo-…@sample.spectrum-dating.app` (members), so:
//   • real dashboard queries (is_demo=0) never see any of it, and
//   • --wipe removes ONLY what this script created — it never touches real
//     (is_demo=0) telemetry rows, and never touches the existing @sample seed
//     personas (only the `telemetry-demo-` prefixed members).
//
// The demo dataset spans 30 days: varied geo/referrers/paths, a couple of uptime
// gaps, matching visit_daily rollups, and a handful of demo members.

import { randomUUID, randomBytes } from 'node:crypto';
import { getDb } from '../src/db.js';

const WIPE = process.argv.includes('--wipe');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_MEMBER_PREFIX = 'telemetry-demo-';
const DEMO_MEMBER_LIKE = `${DEMO_MEMBER_PREFIX}%@sample.spectrum-dating.app`;
// Non-loginable placeholder — bcrypt.compare against this always returns false,
// so demo members can never be signed into. They exist only to populate the
// admin member listing/detail for the demo.
const DEMO_PW_HASH = '$demo$not-a-real-bcrypt-hash$not-loginable';

// ── Weighted pickers ────────────────────────────────────────────────────────
function pick(weighted) {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of weighted) { if ((r -= w) <= 0) return v; }
  return weighted[weighted.length - 1][0];
}
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

const GEO = [
  [{ country: 'US', region: 'CA' }, 22],
  [{ country: 'US', region: 'NY' }, 16],
  [{ country: 'US', region: 'TX' }, 12],
  [{ country: 'US', region: 'WA' }, 9],
  [{ country: 'US', region: 'AZ' }, 7],
  [{ country: 'GB', region: 'ENG' }, 10],
  [{ country: 'CA', region: 'ON' }, 8],
  [{ country: 'DE', region: '' }, 6],
  [{ country: 'AU', region: 'NSW' }, 5],
  [{ country: 'IE', region: '' }, 3],
];
const REFERRERS = [
  ['', 34], // direct / own-origin
  ['google.com', 22],
  ['reddit.com', 12],
  ['bsky.app', 9],
  ['t.co', 8],
  ['duckduckgo.com', 6],
  ['facebook.com', 5],
  ['news.ycombinator.com', 4],
];
const PATHS = [
  ['suggestions', 30],
  ['matches', 18],
  ['messages', 22],
  ['profile', 14],
  ['safety', 6],
  ['settings', 10],
];

// A handful of demo members — varied cities / join dates / one suspended / one
// verified / mixed last-active (one deliberately blank → "Not recorded yet").
const DEMO_MEMBERS = [
  { name: 'Demo · Avery Lane', city: 'Portland', ageDays: 210, suspended: 0, verified: 1, lastActiveDaysAgo: 1 },
  { name: 'Demo · Bo Nakamura', city: 'Seattle', ageDays: 165, suspended: 0, verified: 0, lastActiveDaysAgo: 3 },
  { name: 'Demo · Cass Ellery', city: 'Austin', ageDays: 96, suspended: 1, verified: 0, lastActiveDaysAgo: 12 },
  { name: 'Demo · Devi Rao', city: 'Chicago', ageDays: 58, suspended: 0, verified: 1, lastActiveDaysAgo: 0 },
  { name: 'Demo · Emrys Cole', city: 'Denver', ageDays: 33, suspended: 0, verified: 0, lastActiveDaysAgo: 7 },
  { name: 'Demo · Farah Idris', city: 'Boston', ageDays: 12, suspended: 0, verified: 0, lastActiveDaysAgo: null },
];

function ymdUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Wipe (shared by --wipe and the pre-seed clean) ──────────────────────────
function wipeDemo(db) {
  const wipe = db.transaction(() => {
    const pv = db.prepare('DELETE FROM page_views WHERE is_demo = 1').run().changes;
    const vd = db.prepare('DELETE FROM visit_daily WHERE is_demo = 1').run().changes;
    const inc = db.prepare('DELETE FROM uptime_incident WHERE is_demo = 1').run().changes;
    // Demo members: ONLY the reserved telemetry-demo- prefix (profiles cascade).
    const mem = db.prepare('DELETE FROM users WHERE email LIKE ?').run(DEMO_MEMBER_LIKE).changes;
    return { pv, vd, inc, mem };
  });
  return wipe();
}

function seed(db) {
  const now = Date.now();
  const insPv = db.prepare(
    `INSERT INTO page_views (ts, path, referrer_domain, country, region, session_hash, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const insDaily = db.prepare(
    `INSERT INTO visit_daily (day, is_demo, views, uniques) VALUES (?, 1, ?, ?)`
  );
  const insIncident = db.prepare(
    `INSERT INTO uptime_incident (id, started_at, ended_at, duration_ms, kind, note, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );

  let totalViews = 0;
  let totalSessions = 0;

  const run = db.transaction(() => {
    // 30 days of page_views + matching visit_daily rollups. Day 0 = 29 days ago.
    for (let d = 29; d >= 0; d--) {
      const dayStart = now - d * DAY_MS;
      const day = ymdUTC(dayStart);
      // A gentle upward trend toward today + weekend-ish jitter, dipped on the
      // two incident days so the sparkline isn't suspiciously flat.
      const base = 8 + Math.round((29 - d) * 0.5);
      const sessions = Math.max(3, base + randInt(-3, 6) - (d === 7 || d === 18 ? 5 : 0));
      const uniques = new Set();
      let dayViews = 0;

      for (let s = 0; s < sessions; s++) {
        const sessionHash = randomBytes(16).toString('hex');
        uniques.add(sessionHash);
        const geo = pick(GEO);
        const referrer = pick(REFERRERS); // landing referrer for this session
        const views = randInt(1, 6);
        for (let v = 0; v < views; v++) {
          // Spread views across the day; first view carries the referrer,
          // later in-app views are own-origin ('').
          const ts = dayStart + randInt(0, DAY_MS - 1);
          insPv.run(ts, pick(PATHS), v === 0 ? referrer : '', geo.country, geo.region, sessionHash);
          dayViews++;
        }
      }

      insDaily.run(day, dayViews, uniques.size);
      totalViews += dayViews;
      totalSessions += uniques.size;
    }

    // Two demo uptime incidents (both inside the 30-day window).
    const inc1Start = now - 7 * DAY_MS - 4 * 60 * 1000;
    insIncident.run(randomUUID(), inc1Start, inc1Start + 4 * 60 * 1000, 4 * 60 * 1000, 'gap', 'Heartbeat gap after a Railway redeploy.');
    const inc2Start = now - 18 * DAY_MS - 12 * 60 * 1000;
    insIncident.run(randomUUID(), inc2Start, inc2Start + 12 * 60 * 1000, 12 * 60 * 1000, 'gap', 'Database maintenance window (planned).');

    // Demo members.
    const insUser = db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
    const insProfile = db.prepare('INSERT INTO profiles (user_id, display_name, dist_city, updated_at) VALUES (?, ?, ?, ?)');
    const setUser = db.prepare('UPDATE users SET suspended = ?, last_active_at = ? WHERE id = ?');
    const setVerified = db.prepare('UPDATE profiles SET identity_verified = ? WHERE user_id = ?');
    DEMO_MEMBERS.forEach((m, i) => {
      const uid = randomUUID();
      const email = `${DEMO_MEMBER_PREFIX}${i}@sample.spectrum-dating.app`;
      const createdAt = now - m.ageDays * DAY_MS;
      insUser.run(uid, email, DEMO_PW_HASH, createdAt);
      insProfile.run(uid, m.name, m.city, createdAt);
      const lastActive = m.lastActiveDaysAgo == null ? '' : ymdUTC(now - m.lastActiveDaysAgo * DAY_MS);
      setUser.run(m.suspended, lastActive, uid);
      setVerified.run(m.verified, uid);
    });
  });

  run();
  return { totalViews, totalSessions, members: DEMO_MEMBERS.length };
}

// ── Main ────────────────────────────────────────────────────────────────────
const db = getDb();

if (WIPE) {
  const r = wipeDemo(db);
  console.log('Wiped demo telemetry + demo members (is_demo=1 / telemetry-demo- only):');
  console.log(`  page_views:      ${r.pv}`);
  console.log(`  visit_daily:     ${r.vd}`);
  console.log(`  uptime_incident: ${r.inc}`);
  console.log(`  demo members:    ${r.mem}`);
  console.log('Real (is_demo=0) rows and @sample seed personas are untouched.');
} else {
  // Re-runnable: clear any prior demo dataset first, then insert fresh.
  wipeDemo(db);
  const r = seed(db);
  console.log('Seeded DEMO telemetry (all is_demo=1) over 30 days:');
  console.log(`  page_views:   ${r.totalViews} across ${r.totalSessions} unique demo sessions`);
  console.log(`  visit_daily:  30 daily rollups`);
  console.log('  incidents:    2 demo uptime gaps');
  console.log(`  members:      ${r.members} demo members (${DEMO_MEMBER_LIKE})`);
  console.log('View it with the admin Overview tab "Demo data" toggle (?demo=1).');
}
