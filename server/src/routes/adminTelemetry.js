// Admin telemetry + member-management endpoints (Phase 1).
// ALL routes are requireAuth + requireAdmin. Real queries hardcode is_demo = 0
// (telemetry) or exclude the test/demo email domains (members). An admin-gated
// ?demo=1 flips telemetry queries to the seeded demo dataset (is_demo = 1) so the
// live demo view is populated without polluting real counts.
//
// Mounted at /admin alongside routes/admin.js (Express allows multiple routers
// on one prefix). Kept separate to avoid growing the 800-line moderation router.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { loadDemoData, wipeDemoData } from '../telemetry/demoSeed.js';

const router = Router();

// In-module guard so the (potentially large) demo insert/delete can't run twice
// concurrently. The op itself is synchronous (better-sqlite3), so this mostly
// guards against overlapping requests slipping in — a 409 tells the caller to wait.
let demoBusy = false;

// Test/demo account exclusion (mirrors admin.js:25-26).
const TEST_ACCOUNT_LIKE = '%@spectrum-test.dev';
const DEMO_ACCOUNT_LIKE = '%@sample.spectrum-dating.app';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

// 'YYYY-MM-DD' for the date exactly `years` ago (UTC). Used to translate an age
// bound into a date-of-birth cut-off: because DOB is stored zero-padded
// 'YYYY-MM-DD', lexicographic string comparison IS chronological comparison.
//   age >= ageMin  ⟺  dob <= (today − ageMin years)
//   age <= ageMax  ⟺  dob >  (today − (ageMax+1) years)
function isoYearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Parse ?window= into ms (default 7d). Only the three fixed windows are allowed.
function windowMs(q) {
  return WINDOWS[q] || WINDOWS['7d'];
}

// Admin-gated demo toggle: ?demo=1 → is_demo=1 (seeded demo data), else is_demo=0.
function demoFlag(req) {
  return req.query.demo === '1' ? 1 : 0;
}

// ---------------------------------------------------------------------------
// GET /admin/telemetry/overview?window=24h|7d|30d&demo=
// visits series (bucketed), total views, unique visitors, top paths.
// ---------------------------------------------------------------------------
router.get('/telemetry/overview', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const win = windowMs(req.query.window);
  const isDemo = demoFlag(req);
  const since = Date.now() - win;

  // 24h → hourly buckets; 7d/30d → daily buckets. ts is epoch ms.
  const hourly = win <= DAY_MS;
  const bucketExpr = hourly
    ? "strftime('%Y-%m-%dT%H:00', ts / 1000, 'unixepoch')"
    : "strftime('%Y-%m-%d', ts / 1000, 'unixepoch')";

  const series = db.prepare(
    `SELECT ${bucketExpr} AS bucket,
            COUNT(*)                     AS views,
            COUNT(DISTINCT session_hash) AS uniques
       FROM page_views
      WHERE is_demo = ? AND ts >= ?
      GROUP BY bucket
      ORDER BY bucket ASC`
  ).all(isDemo, since);

  const totals = db.prepare(
    `SELECT COUNT(*)                     AS views,
            COUNT(DISTINCT session_hash) AS uniques
       FROM page_views
      WHERE is_demo = ? AND ts >= ?`
  ).get(isDemo, since);

  const topPaths = db.prepare(
    `SELECT path AS label, COUNT(*) AS count
       FROM page_views
      WHERE is_demo = ? AND ts >= ?
      GROUP BY path
      ORDER BY count DESC, label ASC
      LIMIT 20`
  ).all(isDemo, since);

  res.json({
    window: req.query.window && WINDOWS[req.query.window] ? req.query.window : '7d',
    demo: !!isDemo,
    totalViews: totals?.views ?? 0,
    uniqueVisitors: totals?.uniques ?? 0,
    series: series.map((r) => ({ bucket: r.bucket, views: r.views, uniques: r.uniques })),
    topPaths,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/telemetry/geo?window=&demo= — country/region ranked.
// ---------------------------------------------------------------------------
router.get('/telemetry/geo', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const isDemo = demoFlag(req);
  const since = Date.now() - windowMs(req.query.window);

  const rows = db.prepare(
    `SELECT country, region, COUNT(*) AS count
       FROM page_views
      WHERE is_demo = ? AND ts >= ? AND country != ''
      GROUP BY country, region
      ORDER BY count DESC, country ASC
      LIMIT 100`
  ).all(isDemo, since);

  res.json({
    demo: !!isDemo,
    rows: rows.map((r) => ({
      country: r.country,
      region: r.region || '',
      label: r.region ? `${r.country}-${r.region}` : r.country,
      count: r.count,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/telemetry/referrers?window=&demo= — referrer domain ranked.
// ---------------------------------------------------------------------------
router.get('/telemetry/referrers', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const isDemo = demoFlag(req);
  const since = Date.now() - windowMs(req.query.window);

  const rows = db.prepare(
    `SELECT referrer_domain AS label, COUNT(*) AS count
       FROM page_views
      WHERE is_demo = ? AND ts >= ? AND referrer_domain != ''
      GROUP BY referrer_domain
      ORDER BY count DESC, label ASC
      LIMIT 100`
  ).all(isDemo, since);

  res.json({ demo: !!isDemo, rows });
});

// ---------------------------------------------------------------------------
// GET /admin/telemetry/uptime?demo= — app-layer uptime board.
// pct(window) = (windowMs − Σ overlap(incident, window)) / windowMs.
// ---------------------------------------------------------------------------
router.get('/telemetry/uptime', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const isDemo = demoFlag(req);
  const now = Date.now();

  const beat = db.prepare('SELECT process_started_at, last_beat_at FROM service_heartbeat WHERE id = 1').get();
  const processStartedAt = beat?.process_started_at ?? null;
  const currentUptimeMs = processStartedAt ? now - processStartedAt : 0;

  // Pull incidents overlapping the widest (30d) window once, compute all three.
  const widest = WINDOWS['30d'];
  const incidents = db.prepare(
    `SELECT id, started_at, ended_at, duration_ms, kind, note
       FROM uptime_incident
      WHERE is_demo = ? AND ended_at >= ?
      ORDER BY started_at DESC`
  ).all(isDemo, now - widest);

  const pctFor = (win) => {
    const windowStart = now - win;
    let down = 0;
    for (const inc of incidents) {
      const s = Math.max(inc.started_at, windowStart);
      const e = Math.min(inc.ended_at, now);
      if (e > s) down += e - s;
    }
    down = Math.min(down, win);
    return ((win - down) / win) * 100;
  };

  res.json({
    demo: !!isDemo,
    layer: 'application', // heartbeat = app+DB liveness, not edge/network
    processStartedAt,
    currentUptimeMs,
    windows: {
      '24h': pctFor(WINDOWS['24h']),
      '7d': pctFor(WINDOWS['7d']),
      '30d': pctFor(WINDOWS['30d']),
    },
    incidents: incidents.map((i) => ({
      id: i.id,
      startedAt: i.started_at,
      endedAt: i.ended_at,
      durationMs: i.duration_ms,
      kind: i.kind,
      note: i.note,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/telemetry/member-domains — member email-domain breakdown.
// Real members only (test/demo excluded). NOT demo-toggled (this is member data,
// not visitor telemetry).
// ---------------------------------------------------------------------------
router.get('/telemetry/member-domains', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const rows = db.prepare(
    `SELECT substr(email, instr(email, '@') + 1) AS label, COUNT(*) AS count
       FROM users
      WHERE email NOT LIKE ? AND email NOT LIKE ?
      GROUP BY label
      ORDER BY count DESC, label ASC
      LIMIT 100`
  ).all(TEST_ACCOUNT_LIKE, DEMO_ACCOUNT_LIKE);
  res.json({ rows });
});

// ---------------------------------------------------------------------------
// GET /admin/telemetry/activity?window=7d|30d — privacy-safe activity trends.
// Aggregate COUNT(*) grouped by UTC day for matches (matched_at) and messages
// (sent_at), plus all-time totals (matching the /stats Matches/Messages cards).
//
// PII-FREE BY CONSTRUCTION: every SELECT projects ONLY a UTC day bucket + a
// count. No user ids, names, match pairs (user_a_id/user_b_id), or message
// bodies are ever selected or returned — this drill-in can never reveal who
// matched whom or what anyone said.
//
// Counts are PLATFORM TOTALS (no test/demo exclusion): matches/messages have no
// email column and excluding would mean joining both participant ids to users —
// awkward, and it would make these totals disagree with the all-time Matches /
// Messages stat cards (admin.js:384-386) that also count platform-wide. Keeping
// them consistent with the card the admin tapped is the right trade here.
// ---------------------------------------------------------------------------
router.get('/telemetry/activity', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const window = req.query.window === '30d' ? '30d' : '7d';
  const since = Date.now() - WINDOWS[window];

  // matched_at / sent_at are epoch ms → /1000 for unixepoch (as page_views).
  const matchesDaily = db.prepare(
    `SELECT strftime('%Y-%m-%d', matched_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM matches
      WHERE matched_at >= ?
      GROUP BY day
      ORDER BY day ASC`
  ).all(since);

  const messagesDaily = db.prepare(
    `SELECT strftime('%Y-%m-%d', sent_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM messages
      WHERE sent_at >= ?
      GROUP BY day
      ORDER BY day ASC`
  ).all(since);

  const totalMatches = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  const totalMessages = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;

  res.json({
    window,
    matchesDaily: matchesDaily.map((r) => ({ day: r.day, count: r.count })),
    messagesDaily: messagesDaily.map((r) => ({ day: r.day, count: r.count })),
    totalMatches,
    totalMessages,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/telemetry/demo  body { action: 'load' | 'clear' }
// Furnish (or clear) the live-demo dashboard from inside the admin panel — the
// CLI seed script can't reach the prod DB on Railway's volume. Reuses the shared
// demoSeed module, so what this loads/clears is EXACTLY what the CLI does:
// is_demo=1 telemetry + `telemetry-demo-`-prefixed members ONLY. It can never
// touch real (is_demo=0) rows or the existing @sample seed personas.
// → { ok, action, counts: {...} }. Any other action → 400.
// ---------------------------------------------------------------------------
router.post('/telemetry/demo', requireAuth, requireAdmin, (req, res) => {
  const action = req.body?.action;
  if (action !== 'load' && action !== 'clear') {
    return res.status(400).json({ error: 'action must be "load" or "clear".' });
  }
  if (demoBusy) {
    return res.status(409).json({ error: 'A demo data operation is already running. Please wait a moment.' });
  }
  demoBusy = true;
  try {
    const { db } = req.ctx;
    const counts = action === 'load' ? loadDemoData(db) : wipeDemoData(db);
    res.json({ ok: true, action, counts });
  } catch {
    res.status(500).json({ error: 'Couldn’t update demo data. Please try again.' });
  } finally {
    demoBusy = false;
  }
});

// ---------------------------------------------------------------------------
// GET /admin/members?query=&status=active|suspended|verified&page=&pageSize=
//                    &sort=joined|reports&includeTest=&includeDemo=
// Paginated member listing with status + report/action/block counts + coarse
// city + join/last-active dates. Reuses the correlated-count SQL (admin.js:75-77)
// and the test/demo exclusion (admin.js:25-26).
// ---------------------------------------------------------------------------
router.get('/members', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const offset = (page - 1) * pageSize;
  const sort = req.query.sort === 'reports' ? 'reports' : 'joined';

  const where = [];
  const params = [];

  // Exclusion: test/demo hidden unless explicitly opted in.
  if (req.query.includeTest !== '1' && req.query.includeTest !== 'true') {
    where.push('u.email NOT LIKE ?');
    params.push(TEST_ACCOUNT_LIKE);
  }
  if (req.query.includeDemo !== '1' && req.query.includeDemo !== 'true') {
    where.push('u.email NOT LIKE ?');
    params.push(DEMO_ACCOUNT_LIKE);
  }

  // Free-text query over email + display name.
  const q = (req.query.query || '').trim();
  if (q) {
    where.push('(u.email LIKE ? OR p.display_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  // Status filter.
  if (req.query.status === 'suspended') where.push('u.suspended = 1');
  else if (req.query.status === 'active') where.push('u.suspended = 0');
  else if (req.query.status === 'verified') where.push('COALESCE(p.identity_verified, 0) = 1');

  // ── Population (demographic) filters ──────────────────────────────────────
  // Optional drill-downs from the Population report. Single-value fields match
  // exactly; multi-value comma-joined fields (orientation/seeking/
  // relationshipStructure) match on a TOKEN boundary — NOT a naive substring.
  // We comma-PAD the column ( ',' || col || ',' ) and look for ',token,', so
  // filtering seeking='man' can never match 'woman' (',woman,' has no ',man,').
  const val = (v) => (typeof v === 'string' ? v.trim() : '');

  const gender = val(req.query.gender);
  if (gender) { where.push('p.gender = ?'); params.push(gender); }

  const relationshipGoal = val(req.query.relationshipGoal);
  if (relationshipGoal) { where.push('p.relationship_goal = ?'); params.push(relationshipGoal); }

  const city = val(req.query.city);
  if (city) { where.push('p.dist_city = ?'); params.push(city); }

  // Token-boundary matches for the comma-joined multi-selects.
  const orientation = val(req.query.orientation);
  if (orientation) {
    where.push("(',' || COALESCE(p.orientation, '') || ',') LIKE ?");
    params.push(`%,${orientation},%`);
  }
  const seeking = val(req.query.seeking);
  if (seeking) {
    where.push("(',' || COALESCE(p.seeking, '') || ',') LIKE ?");
    params.push(`%,${seeking},%`);
  }
  const relationshipStructure = val(req.query.relationshipStructure);
  if (relationshipStructure) {
    where.push("(',' || COALESCE(p.relationship_structure, '') || ',') LIKE ?");
    params.push(`%,${relationshipStructure},%`);
  }

  // Age band: DOB cut-offs (see isoYearsAgo). Requires a real DOB — an empty
  // date_of_birth ('') would lexicographically satisfy the "<=" bound, so guard
  // it out whenever either age bound is applied.
  const ageMin = parseInt(req.query.ageMin, 10);
  const ageMax = parseInt(req.query.ageMax, 10);
  const hasAgeMin = Number.isInteger(ageMin) && ageMin > 0;
  const hasAgeMax = Number.isInteger(ageMax) && ageMax > 0;
  if (hasAgeMin || hasAgeMax) {
    where.push("p.date_of_birth != ''");
    if (hasAgeMin) { where.push('p.date_of_birth <= ?'); params.push(isoYearsAgo(ageMin)); }
    if (hasAgeMax) { where.push('p.date_of_birth > ?'); params.push(isoYearsAgo(ageMax + 1)); }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(
    `SELECT COUNT(*) AS c
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereSql}`
  ).get(...params).c;

  // Correlated counts mirror admin.js:75-77.
  const orderSql = sort === 'reports'
    ? 'ORDER BY reportCount DESC, u.created_at DESC'
    : 'ORDER BY u.created_at DESC';

  const rows = db.prepare(
    `SELECT u.id, u.email, u.created_at AS createdAt, u.suspended,
            u.last_active_at AS lastActiveAt,
            COALESCE(p.display_name, '') AS displayName,
            COALESCE(p.dist_city, '')    AS distCity,
            COALESCE(p.identity_verified, 0) AS verified,
            (SELECT COUNT(*) FROM reports r WHERE r.reported_id = u.id) AS reportCount,
            (SELECT COUNT(*) FROM reports r WHERE r.reported_id = u.id AND r.status = 'actioned') AS actionedCount,
            (SELECT COUNT(DISTINCT b.blocker_id) FROM blocks b WHERE b.blocked_id = u.id) AS blockedByCount
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  res.json({
    total,
    page,
    pageSize,
    members: rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      distCity: r.distCity,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt || '',
      suspended: !!r.suspended,
      verified: !!r.verified,
      reportCount: r.reportCount,
      actionedCount: r.actionedCount,
      blockedByCount: r.blockedByCount,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/members/:id — member detail drawer.
// userContext (profile) + reports-against list + history counts + verified /
// suspended / accountAge / lastActiveAt.
// ---------------------------------------------------------------------------
router.get('/members/:id', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const id = req.params.id;

  const user = db.prepare(
    'SELECT id, email, created_at, suspended, last_active_at FROM users WHERE id = ?'
  ).get(id);
  if (!user) return res.status(404).json({ error: 'Member not found.' });

  const profile = db.prepare(
    'SELECT display_name, tagline, bio, comm_note, relationship_goal, dist_city, identity_verified FROM profiles WHERE user_id = ?'
  ).get(id);

  // Reports filed AGAINST this member (most recent first).
  const reportsAgainstList = db.prepare(
    `SELECT r.id, r.reporter_id, r.reason, r.status, r.created_at, r.resolved_at,
            rp.display_name AS reporter_display_name
       FROM reports r
       LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
      WHERE r.reported_id = ?
      ORDER BY r.created_at DESC
      LIMIT 100`
  ).all(id);

  const reportsAgainst = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE reported_id = ?').get(id).c;
  const reportsActioned = db.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE reported_id = ? AND status = 'actioned'"
  ).get(id).c;
  const distinctBlockers = db.prepare(
    'SELECT COUNT(DISTINCT blocker_id) AS c FROM blocks WHERE blocked_id = ?'
  ).get(id).c;

  res.json({
    userContext: {
      userId: user.id,
      email: user.email,
      createdAt: user.created_at,
      suspended: !!user.suspended,
      displayName: profile?.display_name || '',
      tagline: profile?.tagline || '',
      bio: profile?.bio || '',
      commNote: profile?.comm_note || '',
      relationshipGoal: profile?.relationship_goal || '',
      distCity: profile?.dist_city || '',
    },
    verified: !!profile?.identity_verified,
    suspended: !!user.suspended,
    accountAgeMs: Date.now() - user.created_at,
    accountCreatedAt: user.created_at,
    lastActiveAt: user.last_active_at || '',
    reportsAgainst,
    reportsActioned,
    distinctBlockers,
    reportsAgainstList: reportsAgainstList.map((r) => ({
      id: r.id,
      reporterId: r.reporter_id,
      reporterName: r.reporter_display_name || '',
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
  });
});

export default router;
