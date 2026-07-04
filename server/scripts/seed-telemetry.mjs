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
// The actual seed/wipe logic lives in src/telemetry/demoSeed.js (shared with the
// admin POST /admin/telemetry/demo endpoint, so the CLI and the in-app button can
// never drift). This script is just the CLI shell around those pure functions.
//
// EVERYTHING it inserts is tagged is_demo=1 (telemetry) or uses the reserved
// email prefix `telemetry-demo-…@sample.spectrum-dating.app` (members), so:
//   • real dashboard queries (is_demo=0) never see any of it, and
//   • --wipe removes ONLY what this script created — it never touches real
//     (is_demo=0) telemetry rows, and never touches the existing @sample seed
//     personas (only the `telemetry-demo-` prefixed members).

import { getDb } from '../src/db.js';
import { loadDemoData, wipeDemoData, DEMO_MEMBER_LIKE } from '../src/telemetry/demoSeed.js';

const WIPE = process.argv.includes('--wipe');

const db = getDb();

if (WIPE) {
  const r = wipeDemoData(db);
  console.log('Wiped demo telemetry + demo members (is_demo=1 / telemetry-demo- only):');
  console.log(`  page_views:      ${r.pageViews}`);
  console.log(`  visit_daily:     ${r.visitDaily}`);
  console.log(`  uptime_incident: ${r.incidents}`);
  console.log(`  demo members:    ${r.members}`);
  console.log('Real (is_demo=0) rows and @sample seed personas are untouched.');
} else {
  // loadDemoData is idempotent — it clears any prior demo dataset first, then
  // inserts fresh, so re-running never stacks duplicate demo rows.
  const r = loadDemoData(db);
  console.log('Seeded DEMO telemetry (all is_demo=1) over 30 days:');
  console.log(`  page_views:   ${r.pageViews} across ${r.uniqueSessions} unique demo sessions`);
  console.log(`  visit_daily:  ${r.visitDaily} daily rollups`);
  console.log(`  incidents:    ${r.incidents} demo uptime gaps`);
  console.log(`  members:      ${r.members} demo members (${DEMO_MEMBER_LIKE})`);
  console.log('View it with the admin Overview tab "Demo data" toggle (?demo=1).');
}
