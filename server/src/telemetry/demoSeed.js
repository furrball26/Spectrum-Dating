// demoSeed.js — shared, importable demo-dataset seed logic for the telemetry +
// member-management admin dashboard. Pure functions taking a better-sqlite3 `db`
// handle (no CLI/process/env concerns): the CLI script (scripts/seed-telemetry.mjs)
// and the admin endpoint (POST /admin/telemetry/demo) both import from here, so
// the two paths can never drift.
//
// EVERYTHING these functions insert is tagged is_demo=1 (telemetry) or uses the
// reserved email prefix `telemetry-demo-…@sample.spectrum-dating.app` (members +
// the moderation activity tied to them), so — by construction:
//   • real dashboard queries (is_demo=0 / real emails) never see any of it, and
//   • clearing removes ONLY what this module created — never real (is_demo=0)
//     telemetry rows, and never the existing @sample seed personas (only the
//     `telemetry-demo-` prefixed members + activity that references them).
// This preserves the "597" discipline: the demo data can never pollute the real
// member count or real telemetry.
//
// DECK-VISIBLE (intentional): every demo member is created with
// profiles.paused = 0, so they ARE discoverable in other users' Discover deck
// (see matching/candidates.js WHERE p.paused = 0) — this populates the deck for
// the live demo. They have full profiles (bio/photo/interests) so both the admin
// dashboard breakdowns AND the Discover deck populate. Discoverability does NOT
// weaken separability: every demo member is still tagged is_demo=1 (telemetry)
// and carries the reserved `telemetry-demo-…@sample.spectrum-dating.app` email,
// so real dashboard queries still exclude them and wipeDemoData() still removes
// 100% of them. (Previously these were paused = 1 / deck-hidden; reversed so the
// client sees a populated deck.)
//
// VERIFICATION: demo members are PRE-APPROVED. ~30% are flagged
// profiles.identity_verified=1 (the trust badge) and NONE seed a 'pending'
// verification_request — so the demo dataset never lands in the moderation
// verification queue (admin.js GET /verification-requests, WHERE status='pending')
// and never gives a moderator fake profiles to "review". (Previously the seed
// created 8 pending demo requests; removed. Migration 056 backfills the
// already-live demo members the same way.)

import { randomUUID, randomBytes } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEMO_MEMBER_PREFIX = 'telemetry-demo-';
export const DEMO_MEMBER_LIKE = `${DEMO_MEMBER_PREFIX}%@sample.spectrum-dating.app`;
// Non-loginable placeholder — bcrypt.compare against this always returns false,
// so demo members can never be signed into. They exist only to populate the
// admin member listing/detail for the demo.
const DEMO_PW_HASH = '$demo$not-a-real-bcrypt-hash$not-loginable';

// How many demo members to generate. Kept as a named export so tests + callers
// can assert against the same number.
export const DEMO_MEMBER_COUNT = 500;
// Bundled demo avatars (public/demo-avatars/01.jpg … 12.jpg). Each member's
// photo_url cycles through this small set so only ~12 distinct images ever load
// (browser-cached, zero R2/backend load). See the frontend for the assets.
const DEMO_AVATAR_COUNT = 12;

// ── Weighted / random pickers ────────────────────────────────────────────────
function pick(weighted) {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of weighted) { if ((r -= w) <= 0) return v; }
  return weighted[weighted.length - 1][0];
}
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// Choose `k` distinct random tokens from `arr` (k clamped to arr.length).
function sampleN(arr, k) {
  const pool = [...arr];
  const out = [];
  const n = Math.min(k, pool.length);
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// ── Telemetry (visitor) pools — unchanged from the original 30-day seed ──────
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

// ── Member-generation pools ──────────────────────────────────────────────────
const FIRST_NAMES = [
  'Avery', 'Bo', 'Cass', 'Devi', 'Emrys', 'Farah', 'Gwen', 'Hana', 'Idris', 'Jae',
  'Kit', 'Lena', 'Mira', 'Nolan', 'Oona', 'Priya', 'Quinn', 'Rowan', 'Sasha', 'Theo',
  'Uma', 'Vero', 'Wren', 'Xavier', 'Yuki', 'Zane', 'Ari', 'Beck', 'Cleo', 'Dara',
  'Eli', 'Faye', 'Gio', 'Harper', 'Ines', 'Juno', 'Kai', 'Lior', 'Maya', 'Nico',
  'Ola', 'Pax', 'Remy', 'Sol', 'Tam', 'Uri', 'Vic', 'Wade', 'Yara', 'Zola',
];
const LAST_NAMES = [
  'Lane', 'Nakamura', 'Ellery', 'Rao', 'Cole', 'Idris', 'Okafor', 'Mendez', 'Park', 'Novak',
  'Bishop', 'Costa', 'Delgado', 'Ferris', 'Grant', 'Haddad', 'Imani', 'Jensen', 'Kaur', 'Lowe',
  'Marsh', 'Nguyen', 'Osei', 'Pryce', 'Quill', 'Reyes', 'Silva', 'Tran', 'Underwood', 'Vance',
  'Walsh', 'Xu', 'Yates', 'Zimmer', 'Abara', 'Bloom', 'Chen', 'Dvorak', 'Eaton', 'Flores',
];

// Full expanded gender set — weighted so common options dominate but every one
// appears in a 500-member set. gender_group (the matchable core) is derived from
// this and is now LIVE: demo members are discoverable (paused = 0), so the
// mutual gender/seeking filter in matching/candidates.js uses it for real.
const GENDERS = [
  ['woman', 30], ['man', 30], ['nonbinary', 12], ['genderfluid', 5], ['genderqueer', 5],
  ['agender', 4], ['trans-man', 4], ['trans-woman', 4], ['bigender', 2], ['two-spirit', 2],
  ['intersex', 1], ['questioning', 3],
];
function genderGroup(gender) {
  switch (gender) {
    case 'woman': case 'trans-woman': return 'woman';
    case 'man': case 'trans-man': return 'man';
    case 'nonbinary': return 'nonbinary';
    default: return '';
  }
}
const ORIENTATIONS = [
  'straight', 'gay', 'lesbian', 'bisexual', 'pansexual', 'asexual', 'demisexual', 'queer', 'questioning',
];
// Seeking distribution: single tokens dominate, some combos, a healthy share of
// '' (= "open to everyone").
const SEEKING_SHAPES = [
  ['woman', 18], ['man', 18], ['nonbinary', 8],
  ['woman,man', 6], ['woman,nonbinary', 5], ['man,nonbinary', 5],
  ['woman,man,nonbinary', 4], ['', 30],
];
const REL_STRUCTURES = [
  ['monogamous', 34], ['open', 10], ['polyamorous', 10], ['queerplatonic', 6], ['figuring-it-out', 14], ['', 26],
];
const REL_GOALS = [
  ['long-term', 40], ['friendship', 20], ['open', 18], ['', 22],
];
// ~28 cities — the geocodable metros PLUS smaller/varied ones, weighted toward
// the metros so the location breakdown looks rich but real.
const CITIES = [
  ['Portland', 34], ['Seattle', 30], ['Austin', 28], ['Chicago', 30], ['Denver', 24],
  ['Boston', 24], ['San Francisco', 26], ['New York', 34], ['Los Angeles', 30], ['Philadelphia', 16],
  ['Minneapolis', 14], ['Atlanta', 16], ['Nashville', 12], ['Pittsburgh', 10], ['San Diego', 14],
  ['Oakland', 10], ['Sacramento', 8], ['Columbus', 8], ['Richmond', 7], ['Tucson', 6],
  ['Bend', 6], ['Asheville', 6], ['Boise', 6], ['Providence', 5], ['Madison', 5],
  ['Ann Arbor', 4], ['Burlington', 4], ['Fort Collins', 4], ['Eugene', 4], ['Spokane', 4],
];
// Age band → weight (weighted toward 24–40 but a real spread to the tails).
const AGE_BANDS = [
  [[18, 23], 10], [[24, 29], 26], [[30, 34], 24], [[35, 40], 18],
  [[41, 49], 12], [[50, 59], 6], [[60, 75], 4],
];
const INTERESTS = [
  'hiking', 'gaming', 'reading', 'baking', 'birdwatching', 'painting', 'astronomy', 'gardening',
  'cycling', 'cooking', 'photography', 'board games', 'knitting', 'running', 'climbing',
  'trainspotting', 'vinyl records', 'tabletop RPGs', 'pottery', 'kayaking', 'chess',
  'volunteering', 'languages', 'cats', 'dogs', 'live music', 'museums', 'coffee', 'tea', 'writing',
];
const BIO_OPENERS = [
  'Quiet weekends and long walks are my happy place.',
  'Looking for someone to share slow mornings with.',
  'I like clear plans and good conversation.',
  'Big on routines, small talk not so much.',
  'Here for genuine connection, no rush.',
  'Museums, tea, and honest chats.',
  'I recharge in calm spaces and deep interests.',
  'Direct, kind, and a little nerdy.',
];
const BIO_CLOSERS = [
  'Ask me about my special interest.',
  'Prefer texting before meeting in person.',
  'Sensory-friendly dates only, please.',
  'Neurodivergent and proud.',
  'Let’s find our shared pace.',
  'I value patience and clarity.',
];

// ── Moderation activity pools ────────────────────────────────────────────────
const REPORT_REASONS = ['harassment', 'spam', 'fake_profile', 'inappropriate', 'other'];
const REPORT_STATUSES = [
  ['open', 40], ['reviewed', 15], ['actioned', 25], ['dismissed', 20],
];
const MOD_NOTES = [
  'Reviewed the thread — no policy violation found.',
  'Confirmed spam pattern; account actioned.',
  'Warned the member and closed the report.',
  'Reporter and reported both contacted; monitoring.',
  'Dismissed — appears to be a misunderstanding.',
  'Escalated pattern of repeat behaviour; suspended.',
];
const REPORTED_SNIPPETS = [
  'hey add me on another app',
  'you look great, send more photos',
  'why won’t you answer me',
  'check out this link for free stuff',
  '',
];
const FEEDBACK_MESSAGES = [
  'Love how calm the whole app feels. Thank you.',
  'Could we get a way to pause matches for a week?',
  'The sensory settings made a huge difference for me.',
  'Would like more prompts to break the ice.',
  'Reporting flow was clear and reassuring.',
  'Please add a larger-text option in messages.',
];

function ymdUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Internal (non-transactional) demo-only delete ────────────────────────────
// Deletes ONLY is_demo=1 telemetry + `telemetry-demo-`-prefixed members AND the
// moderation activity that references those members. Called both standalone
// (wipeDemoData, wrapped in a transaction) and as the idempotent pre-clean
// inside loadDemoData's transaction. Never touches real (is_demo=0) rows or the
// existing @sample seed personas.
//
// ORDER MATTERS: the activity rows are deleted while the demo users still exist
// (so the `email LIKE` subquery resolves), THEN the users. reports/feedback have
// ON DELETE SET NULL foreign keys — deleting the user alone would ORPHAN the row
// (it would survive with a null id), so they MUST be deleted explicitly here.
// blocks/verification_requests are ON DELETE CASCADE, but we delete them
// explicitly too so the returned counts are accurate and the intent is obvious.
function deleteDemoRows(db) {
  const pageViews = db.prepare('DELETE FROM page_views WHERE is_demo = 1').run().changes;
  const visitDaily = db.prepare('DELETE FROM visit_daily WHERE is_demo = 1').run().changes;
  const incidents = db.prepare('DELETE FROM uptime_incident WHERE is_demo = 1').run().changes;

  // Activity tied to demo members (reference the reserved prefix via subquery).
  const reports = db.prepare(
    `DELETE FROM reports
      WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE ?)
         OR reported_id IN (SELECT id FROM users WHERE email LIKE ?)`
  ).run(DEMO_MEMBER_LIKE, DEMO_MEMBER_LIKE).changes;
  const blocks = db.prepare(
    `DELETE FROM blocks
      WHERE blocker_id IN (SELECT id FROM users WHERE email LIKE ?)
         OR blocked_id IN (SELECT id FROM users WHERE email LIKE ?)`
  ).run(DEMO_MEMBER_LIKE, DEMO_MEMBER_LIKE).changes;
  const verifications = db.prepare(
    'DELETE FROM verification_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)'
  ).run(DEMO_MEMBER_LIKE).changes;
  const feedback = db.prepare(
    'DELETE FROM feedback WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)'
  ).run(DEMO_MEMBER_LIKE).changes;

  // Demo members: ONLY the reserved telemetry-demo- prefix (profiles cascade).
  const members = db.prepare('DELETE FROM users WHERE email LIKE ?').run(DEMO_MEMBER_LIKE).changes;
  return { pageViews, visitDaily, incidents, reports, blocks, verifications, feedback, members };
}

// ── wipeDemoData(db) ─────────────────────────────────────────────────────────
// Deletes ONLY the demo dataset (telemetry + members + their activity), in one
// transaction. Returns deleted-row counts per table.
export function wipeDemoData(db) {
  return db.transaction(() => deleteDemoRows(db))();
}

// ── loadDemoData(db) ─────────────────────────────────────────────────────────
// Idempotent: pre-cleans its own demo data first (so repeated loads don't stack),
// then inserts a fresh dataset — 30 days of visitor telemetry + DEMO_MEMBER_COUNT
// varied demo members + moderation activity (reports/blocks/verifications/
// feedback) tied to them — all inside ONE transaction.
// Returns inserted counts { pageViews, visitDaily, incidents, uniqueSessions,
// members, reports, blocks, verifications, feedback }.
export function loadDemoData(db) {
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
  const insUser = db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at, suspended, last_active_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insProfile = db.prepare(
    `INSERT INTO profiles
       (user_id, display_name, gender, gender_group, orientation, seeking,
        relationship_structure, relationship_goal, date_of_birth, dist_city,
        bio, photo_url, identity_verified, paused, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  const insInterest = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
  const insReport = db.prepare(
    `INSERT INTO reports
       (id, reporter_id, reported_id, conversation_id, reason, details, status,
        moderator_note, created_at, resolved_at, resolved_by, reported_message)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insBlock = db.prepare(
    'INSERT INTO blocks (id, blocker_id, blocked_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insFeedback = db.prepare(
    'INSERT INTO feedback (id, user_id, message, created_at) VALUES (?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    // Idempotent: clear any prior demo dataset first so repeated loads don't stack.
    deleteDemoRows(db);

    // ── Visitor telemetry: 30 days of page_views + visit_daily rollups ────────
    let totalViews = 0;
    let totalSessions = 0;
    let dailyRows = 0;
    for (let d = 29; d >= 0; d--) {
      const dayStart = now - d * DAY_MS;
      const day = ymdUTC(dayStart);
      const base = 8 + Math.round((29 - d) * 0.5);
      const sessions = Math.max(3, base + randInt(-3, 6) - (d === 7 || d === 18 ? 5 : 0));
      const uniques = new Set();
      let dayViews = 0;
      for (let s = 0; s < sessions; s++) {
        const sessionHash = randomBytes(16).toString('hex');
        uniques.add(sessionHash);
        const geo = pick(GEO);
        const referrer = pick(REFERRERS);
        const views = randInt(1, 6);
        for (let v = 0; v < views; v++) {
          insPv.run(dayStart + randInt(0, DAY_MS - 1), pick(PATHS), v === 0 ? referrer : '', geo.country, geo.region, sessionHash);
          dayViews++;
        }
      }
      insDaily.run(day, dayViews, uniques.size);
      dailyRows++;
      totalViews += dayViews;
      totalSessions += uniques.size;
    }

    // Two demo uptime incidents (both inside the 30-day window).
    const inc1Start = now - 7 * DAY_MS - 4 * 60 * 1000;
    insIncident.run(randomUUID(), inc1Start, inc1Start + 4 * 60 * 1000, 4 * 60 * 1000, 'gap', 'Heartbeat gap after a Railway redeploy.');
    const inc2Start = now - 18 * DAY_MS - 12 * 60 * 1000;
    insIncident.run(randomUUID(), inc2Start, inc2Start + 12 * 60 * 1000, 12 * 60 * 1000, 'gap', 'Database maintenance window (planned).');

    // ── Demo members ──────────────────────────────────────────────────────────
    // ids kept so activity can reference real member rows. Demo members are
    // PRE-APPROVED for identity: ~30% carry identity_verified=1 (the trust badge)
    // and NONE seed a pending verification_request — so demo data never clutters
    // the moderation verification queue (WHERE status='pending'). See the module
    // header note on the verification-queue policy.
    const memberIds = [];
    for (let i = 0; i < DEMO_MEMBER_COUNT; i++) {
      const uid = randomUUID();
      const email = `${DEMO_MEMBER_PREFIX}${i}@sample.spectrum-dating.app`;
      const createdAt = now - randInt(0, 365) * DAY_MS; // join spread over ~1 year
      const suspended = Math.random() < 0.04 ? 1 : 0;    // ~4% suspended
      // last_active: today → 90d ago, ~12% never recorded (blank).
      const lastActive = Math.random() < 0.12 ? '' : ymdUTC(now - randInt(0, 90) * DAY_MS);
      insUser.run(uid, email, DEMO_PW_HASH, createdAt, suspended, lastActive);

      const gender = pick(GENDERS);
      const orientation = sampleN(ORIENTATIONS, randInt(1, 2)).join(',');
      const seeking = pick(SEEKING_SHAPES);
      const structure = pick(REL_STRUCTURES);
      const goal = pick(REL_GOALS);
      const city = pick(CITIES);
      const [lo, hi] = pick(AGE_BANDS);
      const age = randInt(lo, hi);
      const dob = `${new Date(now).getUTCFullYear() - age}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`;
      const name = `${sample(FIRST_NAMES)} ${sample(LAST_NAMES)}`;
      const bio = `${sample(BIO_OPENERS)} ${sample(BIO_CLOSERS)}`;
      const photo = `/demo-avatars/${String((i % DEMO_AVATAR_COUNT) + 1).padStart(2, '0')}.jpg`;
      const verified = Math.random() < 0.30 ? 1 : 0; // ~30% verified

      insProfile.run(uid, name, gender, genderGroup(gender), orientation, seeking, structure, goal, dob, city, bio, photo, verified, createdAt);

      for (const interest of sampleN(INTERESTS, randInt(1, 5))) insInterest.run(uid, interest);

      memberIds.push(uid);
    }

    // ── Reports ───────────────────────────────────────────────────────────────
    // ~40 distinct reported members; a subset get reported repeatedly so the
    // repeat-offender signal (reportCount) shows. Reporter is a different demo
    // member. Resolved reports carry a resolver + note + resolved_at.
    let reportCount = 0;
    const reportedPool = sampleN(memberIds, 42);
    const repeatOffenders = reportedPool.slice(0, 8); // reported 2–4× each
    const fileReport = (reportedId) => {
      let reporterId = sample(memberIds);
      while (reporterId === reportedId) reporterId = sample(memberIds);
      const status = pick(REPORT_STATUSES);
      const createdAt = now - randInt(0, 60) * DAY_MS - randInt(0, DAY_MS);
      const resolved = status !== 'open';
      insReport.run(
        randomUUID(), reporterId, reportedId, sample(REPORT_REASONS),
        Math.random() < 0.5 ? 'Reported via the demo dataset.' : null,
        status,
        resolved ? sample(MOD_NOTES) : null,
        createdAt,
        resolved ? createdAt + randInt(1, 48) * 60 * 60 * 1000 : null,
        resolved ? sample(memberIds) : null,
        sample(REPORTED_SNIPPETS) || null,
      );
      reportCount++;
    };
    for (const id of reportedPool) fileReport(id);
    for (const id of repeatOffenders) { const extra = randInt(1, 3); for (let k = 0; k < extra; k++) fileReport(id); }

    // ── Blocks ────────────────────────────────────────────────────────────────
    // ~40 unique (blocker, blocked) demo pairs so block counts populate.
    let blockCount = 0;
    const seenPairs = new Set();
    for (let attempts = 0; blockCount < 40 && attempts < 400; attempts++) {
      const blockerId = sample(memberIds);
      const blockedId = sample(memberIds);
      if (blockerId === blockedId) continue;
      const key = `${blockerId}|${blockedId}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      insBlock.run(randomUUID(), blockerId, blockedId, sample(REPORT_REASONS),
        Math.random() < 0.4 ? 'Blocked via the demo dataset.' : null,
        now - randInt(0, 60) * DAY_MS);
      blockCount++;
    }

    // ── Verification requests ────────────────────────────────────────────────
    // NONE. Demo members are pre-approved: the ~30% flagged identity_verified=1
    // above already carry the trust badge, and no demo member is left in a
    // 'pending' verification_request. This is deliberate — a pending demo request
    // would surface in the moderation verification queue (admin.js
    // GET /verification-requests, WHERE status='pending') and clutter it with
    // fake profiles that a moderator can never meaningfully action. The wipe path
    // (deleteDemoRows) still clears any demo verification_requests by email
    // pattern, so pre-existing/backfilled demo rows remain fully separable.
    const verificationCount = 0;

    // ── Feedback ─────────────────────────────────────────────────────────────
    let feedbackCount = 0;
    for (const message of FEEDBACK_MESSAGES) {
      insFeedback.run(randomUUID(), sample(memberIds), message, now - randInt(0, 45) * DAY_MS - randInt(0, DAY_MS));
      feedbackCount++;
    }

    return {
      pageViews: totalViews,
      visitDaily: dailyRows,
      incidents: 2,
      uniqueSessions: totalSessions,
      members: memberIds.length,
      reports: reportCount,
      blocks: blockCount,
      verifications: verificationCount,
      feedback: feedbackCount,
    };
  });

  return run();
}
