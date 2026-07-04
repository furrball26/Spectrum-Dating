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
import { requireAdmin, isAdminEmail, isAdminUser } from '../middleware/admin.js';
import { getEntitlement } from '../billing/entitlements.js';
import { loadDemoData, wipeDemoData } from '../telemetry/demoSeed.js';
import { newId } from '../utils/ids.js';

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
// GET /admin/transparency?period=7d|30d|90d|all — aggregate enforcement report.
// The internal analog of a public "Safety/Transparency" report: how much
// enforcement happened over a window, what kinds, and how fast reports were
// resolved. Feeds the admin dashboard's Transparency section.
//
// PII-FREE BY CONSTRUCTION: every SELECT projects ONLY an enum label
// (moderation_log.action / enforcement_notices.kind / reports.reason /
// reports.status / chat_safety_signals.signal_kind) plus a COUNT, or an
// anonymous resolution-duration in ms. No user ids, actor ids, target ids,
// display names, emails, report `details`, `moderator_note`, or message bodies
// are ever selected or returned — the payload can never reveal WHO was actioned
// or WHAT was said.
//
// SCOPE = platform-wide (no test/demo exclusion). moderation_log.target_id and
// enforcement_notices.user_id would each need a users join to filter, and
// moderation_log.target_id is sometimes a REPORT id (not a user id), so a clean
// email exclusion isn't possible there. Test/demo enforcement volume is
// negligible, and platform-wide keeps these totals honest — mirrors the same
// trade the /telemetry/activity endpoint documents above. Surfaced as
// `scope: 'platform'` so the UI can label it.
//
// Period → since(ms). 'all' means all-time (since = 0).
// ---------------------------------------------------------------------------
const TRANSPARENCY_PERIODS = { '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '90d': 90 * DAY_MS, all: null };

router.get('/transparency', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const period = Object.prototype.hasOwnProperty.call(TRANSPARENCY_PERIODS, req.query.period)
    ? req.query.period
    : '30d';
  const span = TRANSPARENCY_PERIODS[period];
  const since = span == null ? 0 : Date.now() - span;

  // ── Enforcement actions by type (moderation_log, grouped by action) ────────
  const byAction = db.prepare(
    `SELECT action AS label, COUNT(*) AS count
       FROM moderation_log
      WHERE created_at >= ?
      GROUP BY action
      ORDER BY count DESC, label ASC`
  ).all(since);

  // Due-process notices by kind (warn | suspend | unsuspend | ban).
  const byNoticeKind = db.prepare(
    `SELECT kind AS label, COUNT(*) AS count
       FROM enforcement_notices
      WHERE created_at >= ?
      GROUP BY kind
      ORDER BY count DESC, label ASC`
  ).all(since);

  // ── Reports filed in the window — by reason and by outcome (status) ────────
  const reportsFiled = db.prepare(
    'SELECT COUNT(*) AS c FROM reports WHERE created_at >= ?'
  ).get(since).c;

  const reportsByReason = db.prepare(
    `SELECT reason AS label, COUNT(*) AS count
       FROM reports
      WHERE created_at >= ?
      GROUP BY reason
      ORDER BY count DESC, label ASC`
  ).all(since);

  const reportsByOutcome = db.prepare(
    `SELECT status AS label, COUNT(*) AS count
       FROM reports
      WHERE created_at >= ?
      GROUP BY status
      ORDER BY count DESC, label ASC`
  ).all(since);

  // Time-to-resolution over reports FILED in the window that have since been
  // resolved. Avg in SQL; median computed in JS from anonymous durations only
  // (each row is a bare elapsed-ms number — no ids attached).
  const durations = db.prepare(
    `SELECT (resolved_at - created_at) AS ms
       FROM reports
      WHERE created_at >= ? AND resolved_at IS NOT NULL AND resolved_at >= created_at
      ORDER BY ms ASC`
  ).all(since).map((r) => r.ms);

  const resolvedCount = durations.length;
  const avgResolutionMs = resolvedCount
    ? Math.round(durations.reduce((a, b) => a + b, 0) / resolvedCount)
    : null;
  let medianResolutionMs = null;
  if (resolvedCount) {
    const mid = Math.floor(resolvedCount / 2);
    medianResolutionMs = resolvedCount % 2
      ? durations[mid]
      : Math.round((durations[mid - 1] + durations[mid]) / 2);
  }

  // ── Chat safety signals (off-platform / money) in the window ───────────────
  const safetyTotal = db.prepare(
    'SELECT COUNT(*) AS c FROM chat_safety_signals WHERE created_at >= ?'
  ).get(since).c;

  const safetyByKind = db.prepare(
    `SELECT signal_kind AS label, COUNT(*) AS count
       FROM chat_safety_signals
      WHERE created_at >= ?
      GROUP BY signal_kind
      ORDER BY count DESC, label ASC`
  ).all(since);

  const totalActions = byAction.reduce((s, r) => s + r.count, 0);
  const totalNotices = byNoticeKind.reduce((s, r) => s + r.count, 0);

  // ── Moderator QA calibration health (counts only, PII-free) ────────────────
  // How many resolved-decision re-reviews were logged in the window, and what
  // share AGREED with the original moderator. created_at is stored with TEXT
  // affinity (see migration 051), so CAST it to INTEGER for the epoch-ms window
  // compare. No ids, names, or notes are ever selected here — calibration health
  // is a bare agreement rate, never a per-moderator scoreboard.
  const qaRows = db.prepare(
    `SELECT verdict AS label, COUNT(*) AS count
       FROM moderation_qa_reviews
      WHERE CAST(created_at AS INTEGER) >= ?
      GROUP BY verdict`
  ).all(since);
  const agreeCount = qaRows.find((r) => r.label === 'agree')?.count ?? 0;
  const disagreeCount = qaRows.find((r) => r.label === 'disagree')?.count ?? 0;
  const qaTotal = agreeCount + disagreeCount;
  const agreementRate = qaTotal ? Math.round((agreeCount / qaTotal) * 100) / 100 : 0;

  res.json({
    period,
    scope: 'platform',
    generatedAt: Date.now(),
    qa: {
      totalReviews: qaTotal,
      agreeCount,
      disagreeCount,
      agreementRate,
    },
    enforcement: {
      byAction,
      byNoticeKind,
      totalActions,
      totalNotices,
    },
    reports: {
      filed: reportsFiled,
      byReason: reportsByReason,
      byOutcome: reportsByOutcome,
      resolvedCount,
      avgResolutionMs,
      medianResolutionMs,
    },
    safetySignals: {
      total: safetyTotal,
      byKind: safetyByKind,
    },
  });
});

// ---------------------------------------------------------------------------
// Moderator QA / decision re-review sampling (calibration-only — see migration
// 051). Trust & Safety pulls a small random sample of ALREADY-RESOLVED reports
// (that the requesting admin did NOT resolve — you can't QA your own decision)
// and marks each Agree/Disagree with an optional note. NO punitive action ever
// flows from a QA verdict; it is quality tracking, not a moderator scoreboard.
// ---------------------------------------------------------------------------

// GET /admin/qa/sample?limit=5 — up to `limit` (clamp 1–10, default 5) resolved
// reports NOT resolved by the requesting admin AND not already QA-reviewed, in
// random order. Serialization mirrors the report-card shape (admin.js) so the
// frontend can render context, WITHOUT leaking reporter identity.
router.get('/qa/sample', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));

  const rows = db.prepare(
    `SELECT r.id, r.reason, r.moderator_note, r.status, r.resolved_at, r.resolved_by,
            rbu.email AS resolver_email, rbp.display_name AS resolver_display_name,
            dp.display_name AS reported_display_name
       FROM reports r
       LEFT JOIN users rbu ON rbu.id = r.resolved_by
       LEFT JOIN profiles rbp ON rbp.user_id = r.resolved_by
       LEFT JOIN profiles dp ON dp.user_id = r.reported_id
      WHERE r.resolved_by IS NOT NULL
        AND r.resolved_by != ?
        AND NOT EXISTS (SELECT 1 FROM moderation_qa_reviews q WHERE q.report_id = r.id)
      ORDER BY RANDOM()
      LIMIT ?`
  ).all(userId, limit);

  res.json({
    sample: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      // The decision/action note the resolving moderator recorded.
      moderatorNote: r.moderator_note || '',
      status: r.status,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by
        ? { displayName: r.resolver_display_name || '', email: r.resolver_email || '' }
        : null,
      // Reported user's display name only — reporter identity is never exposed
      // here (same as the normal report card's public surface).
      reportedName: r.reported_display_name || '',
    })),
  });
});

// POST /admin/qa/:reportId/review  body { verdict: 'agree'|'disagree', note? }
// Records one calibration verdict. 400 on a bad verdict; 404 if the report is
// unknown; 409 if the report isn't resolved, the caller resolved it themselves,
// or it's already been QA-reviewed.
router.post('/qa/:reportId/review', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const verdict = req.body?.verdict;
  if (verdict !== 'agree' && verdict !== 'disagree') {
    return res.status(400).json({ error: "verdict must be 'agree' or 'disagree'." });
  }
  const rawNote = req.body?.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== 'string') {
    return res.status(400).json({ error: 'note must be a string.' });
  }
  const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 500) : '';

  const report = db.prepare('SELECT id, resolved_by FROM reports WHERE id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (!report.resolved_by) {
    return res.status(409).json({ error: "This report isn't resolved yet — nothing to QA." });
  }
  if (report.resolved_by === userId) {
    return res.status(409).json({ error: "You can't QA a decision you made yourself." });
  }
  const existing = db.prepare('SELECT 1 FROM moderation_qa_reviews WHERE report_id = ?').get(report.id);
  if (existing) {
    return res.status(409).json({ error: 'This decision has already been QA-reviewed.' });
  }

  const id = newId();
  const now = Date.now();
  db.prepare(
    'INSERT INTO moderation_qa_reviews (id, report_id, reviewer_id, verdict, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, report.id, userId, verdict, note || null, String(now));

  res.status(201).json({
    review: { id, reportId: report.id, reviewerId: userId, verdict, note, createdAt: now },
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
    'SELECT id, email, created_at, suspended, banned, last_active_at, is_admin FROM users WHERE id = ?'
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

  // Needed #7/#11: enforcement state — warn count + the latest due-process notice
  // (kind + reason + when). Distinct from the reversible `suspended` flag.
  const warnCount = db.prepare(
    "SELECT COUNT(*) AS c FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'"
  ).get(id).c;
  const noticeRow = db.prepare(
    'SELECT kind, reason, created_at FROM enforcement_notices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(id);
  const latestNotice = noticeRow
    ? { kind: noticeRow.kind, reason: noticeRow.reason || '', createdAt: noticeRow.created_at }
    : null;

  res.json({
    userContext: {
      userId: user.id,
      email: user.email,
      createdAt: user.created_at,
      suspended: !!user.suspended,
      banned: !!user.banned,
      displayName: profile?.display_name || '',
      tagline: profile?.tagline || '',
      bio: profile?.bio || '',
      commNote: profile?.comm_note || '',
      relationshipGoal: profile?.relationship_goal || '',
      distCity: profile?.dist_city || '',
    },
    verified: !!profile?.identity_verified,
    suspended: !!user.suspended,
    banned: !!user.banned,
    // Manual-access state for the drawer. `isEnvAdmin` = an ADMIN_EMAILS root
    // (immutable via the UI — shown as a locked "Owner/root" state). `isDbAdmin`
    // = the migration-055 flag (the only thing the toggle changes). `isAdmin` is
    // the combined authoritative check the backend actually gates on.
    isAdmin: isAdminUser(user),
    isEnvAdmin: isAdminEmail(user.email),
    isDbAdmin: !!user.is_admin,
    // Current subscription tier (no row = free) so the drawer's Free↔Companion
    // toggle reflects reality on open.
    tier: getEntitlement(db, id).tier,
    warnCount,
    latestNotice,
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
