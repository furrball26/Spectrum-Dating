import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, isAdminEmail } from '../middleware/admin.js';
import { newId } from '../utils/ids.js';
import { disconnectUser } from '../socket/index.js';
import { syncPrimaryPhotoUrl } from './photos.js';
import { deleteObject } from '../storage/r2.js';
import { deleteUserRows, purgeStorageObjects } from '../data/deleteUser.js';

// Automated-test and demo account email domains. The purge endpoint targets the
// TEST domain by default; the DEMO domain is only touched when includeDemo=true.
const TEST_EMAIL_DOMAIN = '@spectrum-test.dev';
const DEMO_EMAIL_DOMAIN = '@sample.spectrum-dating.app';

const router = Router();

const RESOLVE_STATUSES = ['reviewed', 'actioned', 'dismissed'];
// A report in one of these states is FINAL evidence — never re-actionable. This
// mirrors the photo/attachment-queue guard (a queue item leaves 'pending_review'
// exactly once). 'reviewed' is intentionally NOT terminal (it's a triage note),
// so open→reviewed→actioned/dismissed still works.
const TERMINAL_REPORT_STATUSES = ['actioned', 'dismissed'];

// Test/demo accounts are excluded from the real member count (B-A).
const TEST_ACCOUNT_LIKE = `%${TEST_EMAIL_DOMAIN}`;
const DEMO_ACCOUNT_LIKE = `%${DEMO_EMAIL_DOMAIN}`;

// Append-only moderation audit log.
function logMod(db, actorId, action, targetId, detail = '') {
  db.prepare(
    'INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId(), actorId, action, targetId ?? null, detail, Date.now());
}

// Needed #7/#11: append one due-process record to enforcement_notices. This is
// the row an actioned user is later SHOWN (reason + appeal path) and that the
// moderation console reads for the member's enforcement state/history.
function recordNotice(db, userId, kind, reason = '') {
  db.prepare(
    'INSERT INTO enforcement_notices (id, user_id, kind, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(newId(), userId, kind, reason || '', Date.now());
}

// The most recent enforcement notice for a member (null if none). Powers the
// "latest reason" surfaced on the report card / member detail / history, and the
// reason shown to the user on a blocked login.
function latestNotice(db, userId) {
  const row = db.prepare(
    'SELECT kind, reason, created_at FROM enforcement_notices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId);
  return row ? { kind: row.kind, reason: row.reason || '', createdAt: row.created_at } : null;
}

// P1-D / Needed #7: auto-close a member's OPEN sibling reports as 'actioned' when
// they're suspended or banned — the enforcement IS the action, so leaving those
// reports "open" would be a false backlog. Only 'open' rows are touched;
// reviewed/terminal rows (which carry their own notes) are never clobbered.
// Returns the number of reports closed. Shared by the suspend and ban paths.
function autoCloseOpenReports(db, targetId, actorId, now, reasonText) {
  const openReports = db.prepare(
    "SELECT id FROM reports WHERE reported_id = ? AND status = 'open'"
  ).all(targetId);
  for (const rep of openReports) {
    db.prepare(
      'UPDATE reports SET status = ?, moderator_note = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
    ).run('actioned', reasonText, now, actorId, rep.id);
    logMod(db, actorId, 'resolve_report', rep.id, `actioned: ${reasonText}`);
  }
  return openReports.length;
}

// B-E: destructive actions accept an optional moderator note under either
// `note` or `reason`. Returns the trimmed string, or '' when absent. Throws a
// tagged error for a non-string so the caller can 400.
function readNote(body) {
  const raw = body?.note ?? body?.reason;
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    const err = new Error('note must be a string.');
    err.badNote = true;
    throw err;
  }
  return raw.trim();
}

// ---------------------------------------------------------------------------
// GET /admin/me — requireAuth only (NOT requireAdmin)
// Lets the frontend decide whether to show admin UI.
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  res.json({ isAdmin: isAdminEmail(row?.email) });
});

// ---------------------------------------------------------------------------
// GET /admin/reports?status=open — list reports joined with user context
// ---------------------------------------------------------------------------
router.get('/reports', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const status = req.query.status || 'open';

  const base = `
    SELECT r.id, r.reporter_id, r.reported_id, r.conversation_id,
           r.reason, r.details, r.status, r.moderator_note,
           r.created_at, r.resolved_at, r.resolved_by, r.reported_message,
           ru.email AS reporter_email, rp.display_name AS reporter_display_name,
           du.email AS reported_email, dp.display_name AS reported_display_name,
           du.suspended AS reported_suspended, du.banned AS reported_banned, du.created_at AS reported_created_at,
           dp.identity_verified AS reported_verified,
           rbu.email AS resolver_email, rbp.display_name AS resolver_display_name,
           (SELECT COUNT(*) FROM reports r2 WHERE r2.reported_id = r.reported_id) AS reported_report_count,
           (SELECT COUNT(*) FROM reports r3 WHERE r3.reported_id = r.reported_id AND r3.status = 'actioned') AS reported_actioned_count,
           (SELECT COUNT(DISTINCT b.blocker_id) FROM blocks b WHERE b.blocked_id = r.reported_id) AS reported_block_count,
           (SELECT COUNT(*) FROM chat_safety_signals cs WHERE cs.user_id = r.reported_id) AS reported_chat_signal_count,
           (SELECT COUNT(*) FROM enforcement_notices en WHERE en.user_id = r.reported_id AND en.kind = 'warn') AS reported_warn_count,
           (SELECT en.kind FROM enforcement_notices en WHERE en.user_id = r.reported_id ORDER BY en.created_at DESC LIMIT 1) AS reported_notice_kind,
           (SELECT en.reason FROM enforcement_notices en WHERE en.user_id = r.reported_id ORDER BY en.created_at DESC LIMIT 1) AS reported_notice_reason,
           (SELECT en.created_at FROM enforcement_notices en WHERE en.user_id = r.reported_id ORDER BY en.created_at DESC LIMIT 1) AS reported_notice_at
    FROM reports r
    LEFT JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
    LEFT JOIN users du ON du.id = r.reported_id
    LEFT JOIN profiles dp ON dp.user_id = r.reported_id
    LEFT JOIN users rbu ON rbu.id = r.resolved_by
    LEFT JOIN profiles rbp ON rbp.user_id = r.resolved_by
  `;

  let rows;
  if (status === 'all') {
    rows = db.prepare(`${base} ORDER BY r.created_at DESC`).all();
  } else {
    rows = db.prepare(`${base} WHERE r.status = ? ORDER BY r.created_at DESC`).all(status);
  }

  res.json({ reports: rows.map(serializeReport) });
});

// ---------------------------------------------------------------------------
// GET /admin/reports/:id — single report with full profile context
// ---------------------------------------------------------------------------
router.get('/reports/:id', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found.' });

  res.json({
    report: {
      id: r.id,
      reporterId: r.reporter_id,
      reportedId: r.reported_id,
      conversationId: r.conversation_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      moderatorNote: r.moderator_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    },
    reporter: userContext(db, r.reporter_id),
    reported: userContext(db, r.reported_id),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/reports/:id/resolve — body { status, note }
// ---------------------------------------------------------------------------
router.post('/reports/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const { status } = req.body ?? {};

  if (!RESOLVE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${RESOLVE_STATUSES.join(', ')}` });
  }
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }

  const existing = db.prepare('SELECT id, status FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Report not found.' });

  // Terminal guard — mirror the photo/attachment-queue guard (admin.js photo
  // review). Once a report is actioned or dismissed the decision is FINAL; block
  // re-actioning so its note, timestamp, and resolver identity can never be
  // overwritten. (A 'reviewed' report is not terminal and can still be
  // actioned/dismissed.) This does not affect the "resolved drops out of the
  // Open filter" behavior — status is still written for every non-open outcome.
  if (TERMINAL_REPORT_STATUSES.includes(existing.status)) {
    return res.status(409).json({ error: `Report already ${existing.status} — this decision is final.` });
  }

  // A terminal decision must carry a moderator note (accountability trail). A
  // 'reviewed' triage mark may be noteless.
  if (TERMINAL_REPORT_STATUSES.includes(status) && !note) {
    return res.status(400).json({ error: 'A note is required to action or dismiss a report.' });
  }

  db.prepare(
    'UPDATE reports SET status = ?, moderator_note = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
  ).run(status, note || null, Date.now(), req.ctx.userId, req.params.id);
  logMod(db, req.ctx.userId, 'resolve_report', req.params.id, note ? `${status}: ${note}` : status);

  res.json({ ok: true, status });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/suspend — body { suspended: boolean }
// ---------------------------------------------------------------------------
router.post('/users/:id/suspend', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const { suspended } = req.body ?? {};

  if (typeof suspended !== 'boolean') {
    return res.status(400).json({ error: 'suspended must be a boolean.' });
  }
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  // B-E: a suspension (a destructive, force-logout action) must be justified.
  if (suspended && !note) {
    return res.status(400).json({ error: 'A note/reason is required to suspend a user.' });
  }

  const user = db.prepare('SELECT id, suspended FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // B-D: idempotency guard — no-op requests 409 rather than re-writing an audit
  // row (and, for suspend, re-bumping token_version / re-closing reports).
  if (!!user.suspended === suspended) {
    return res.status(409).json({ error: suspended ? 'User is already suspended.' : 'User is not suspended.' });
  }

  const userId = req.ctx.userId;
  let autoClosedReports = 0;

  if (suspended) {
    const now = Date.now();
    // P1-D: suspending a user atomically auto-closes their sibling OPEN reports
    // as 'actioned' — the suspension IS the action, so leaving those reports
    // "open" would be a false backlog. Only 'open' reports are touched;
    // reviewed/terminal rows (which carry their own notes) are never clobbered.
    const suspendTxn = db.transaction(() => {
      // Suspend AND force-logout immediately by bumping token_version.
      db.prepare(
        'UPDATE users SET suspended = 1, token_version = token_version + 1 WHERE id = ?'
      ).run(req.params.id);
      logMod(db, userId, 'suspend', req.params.id, note);
      // Needed #11: due-process record the suspended user can SEE (reason + appeal).
      recordNotice(db, req.params.id, 'suspend', note);

      // Nuke the suspended user's PENDING outbound message-request intros — a
      // suspended user must not keep a live first-contact channel to non-matches.
      // Silent to the sender (a withdrawn intro never surfaces to them). Logged
      // to the mod trail for accountability.
      const nukedIntros = db.prepare(
        "UPDATE message_requests SET status = 'withdrawn', decided_at = ? WHERE sender_id = ? AND status = 'pending'"
      ).run(now, req.params.id);
      if (nukedIntros.changes > 0) {
        logMod(db, userId, 'nuke_intros', req.params.id, `withdrew ${nukedIntros.changes} pending outbound intro(s) on suspend`);
      }

      autoClosedReports = autoCloseOpenReports(db, req.params.id, userId, now, 'auto-closed: user suspended');
    });
    suspendTxn();
    // Kill any already-open sockets so the suspended user stops live-receiving
    // room events immediately (the socket auth check only runs at connect time).
    disconnectUser(req.app.locals.io, req.params.id);
  } else {
    db.prepare('UPDATE users SET suspended = 0 WHERE id = ?').run(req.params.id);
    logMod(db, userId, 'unsuspend', req.params.id, note);
    recordNotice(db, req.params.id, 'unsuspend', note);
  }

  res.json({ ok: true, suspended, autoClosedReports });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/warn — body { note REQUIRED }  (Needed #7)
// The lightest rung of the enforcement ladder: record a due-process notice the
// member can SEE, but do NOT lock them out. A warning is a recorded notice, not
// a suspension — so it never bumps token_version and never changes
// suspended/banned. Multiple warns are allowed (no idempotency guard).
// ---------------------------------------------------------------------------
router.post('/users/:id/warn', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!note) return res.status(400).json({ error: 'A note is required to warn a user.' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  recordNotice(db, req.params.id, 'warn', note);
  logMod(db, userId, 'warn', req.params.id, note);

  res.json({ ok: true, kind: 'warn' });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/ban — body { note REQUIRED }  (Needed #7)
// The top rung: a PERMANENT ban, distinct from the reversible suspend. Sets
// banned=1, force-logs-out (token_version bump), disconnects live sockets,
// auto-closes the member's open reports (reuses the suspend path's logic), and
// records a due-process notice. 409 if already banned. Reversible only via the
// separate /unban action (a ban is intentionally harder to undo than a suspend).
// ---------------------------------------------------------------------------
router.post('/users/:id/ban', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!note) return res.status(400).json({ error: 'A note is required to ban a user.' });

  const user = db.prepare('SELECT id, banned FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.banned) return res.status(409).json({ error: 'User is already banned.' });

  const now = Date.now();
  let autoClosedReports = 0;
  const banTxn = db.transaction(() => {
    // Ban AND force-logout immediately by bumping token_version.
    db.prepare(
      'UPDATE users SET banned = 1, token_version = token_version + 1 WHERE id = ?'
    ).run(req.params.id);
    logMod(db, userId, 'ban', req.params.id, note);
    recordNotice(db, req.params.id, 'ban', note);

    // A banned user must not keep a live first-contact channel to non-matches.
    const nukedIntros = db.prepare(
      "UPDATE message_requests SET status = 'withdrawn', decided_at = ? WHERE sender_id = ? AND status = 'pending'"
    ).run(now, req.params.id);
    if (nukedIntros.changes > 0) {
      logMod(db, userId, 'nuke_intros', req.params.id, `withdrew ${nukedIntros.changes} pending outbound intro(s) on ban`);
    }

    autoClosedReports = autoCloseOpenReports(db, req.params.id, userId, now, 'auto-closed: user banned');
  });
  banTxn();
  // Kill any already-open sockets so the banned user stops live-receiving events.
  disconnectUser(req.app.locals.io, req.params.id);

  res.json({ ok: true, banned: true, autoClosedReports });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/unban — body { note REQUIRED }  (Needed #7)
// Reverses a permanent ban. Kept a DISTINCT action from unsuspend so lifting a
// ban is a deliberate decision. Clears banned=0 and writes an audit row. 409 if
// the user is not banned.
// ---------------------------------------------------------------------------
router.post('/users/:id/unban', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!note) return res.status(400).json({ error: 'A note is required to unban a user.' });

  const user = db.prepare('SELECT id, banned FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.banned) return res.status(409).json({ error: 'User is not banned.' });

  db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(req.params.id);
  logMod(db, userId, 'unban', req.params.id, note);

  res.json({ ok: true, banned: false });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/verify — body { verified: boolean }
// Manual/admin identity verification. Flips the profiles.identity_verified
// trust signal. A real ID/photo vendor can write this same column later via a
// webhook — this endpoint lets moderators verify people in the meantime.
// ---------------------------------------------------------------------------
router.post('/users/:id/verify', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const { verified } = req.body ?? {};

  if (typeof verified !== 'boolean') {
    return res.status(400).json({ error: 'verified must be a boolean.' });
  }
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }

  const profile = db.prepare(
    'SELECT identity_verified FROM profiles WHERE user_id = ?'
  ).get(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  const newStatus = verified ? 'approved' : 'rejected';
  const request = db.prepare(
    'SELECT status FROM verification_requests WHERE user_id = ?'
  ).get(req.params.id);

  // B-D: idempotency guard — 409 ONLY when the action would change NOTHING:
  // neither the identity_verified flag NOR the queue request's status. Rejecting
  // a PENDING request is a REAL action even though identity_verified stays 0 (it
  // moves the request out of the pending queue), so it must not 409 — otherwise
  // the rejected request re-surfaces forever (the guard returned before the
  // verification_requests UPDATE below ever ran).
  const identityChanges = !!profile.identity_verified !== verified;
  const requestChanges = !!request && request.status !== newStatus;
  if (!identityChanges && !requestChanges) {
    return res.status(409).json({ error: verified ? 'User is already verified.' : 'User is not verified.' });
  }

  db.prepare(
    'UPDATE profiles SET identity_verified = ? WHERE user_id = ?'
  ).run(verified ? 1 : 0, req.params.id);
  logMod(db, req.ctx.userId, verified ? 'verify' : 'unverify', req.params.id, note);

  // E19: profiles.identity_verified (set above) is the SINGLE SOURCE OF TRUTH.
  // We still advance the verification_requests row so the moderation QUEUE
  // reflects the decision (approved/rejected) and stops re-surfacing this user,
  // but profile.js no longer trusts this column to decide "verified" — it reads
  // identity_verified directly and only consults verification_requests for the
  // queue state of NOT-yet-verified users. So even if this UPDATE were to no-op
  // (e.g. the user never filed a request), the user's verified state is correct.
  db.prepare(`
    UPDATE verification_requests SET status = ?, reviewed_at = ?
    WHERE user_id = ?
  `).run(newStatus, Date.now(), req.params.id);

  res.json({ ok: true, verified });
});

// ---------------------------------------------------------------------------
// GET /admin/verification-requests?status=pending — self-serve identity
// verification queue. Joins verification_requests → users (email) → profiles
// (display_name, photo_url). Newest first by requested_at. Default status
// filter is 'pending'. Admins act on each via POST /admin/users/:id/verify.
// ---------------------------------------------------------------------------
router.get('/verification-requests', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const status = req.query.status || 'pending';

  const rows = db.prepare(`
    SELECT vr.user_id, vr.status, vr.requested_at,
           u.email AS email,
           p.display_name AS display_name, p.photo_url AS photo_url
    FROM verification_requests vr
    LEFT JOIN users u ON u.id = vr.user_id
    LEFT JOIN profiles p ON p.user_id = vr.user_id
    WHERE vr.status = ?
    ORDER BY vr.requested_at DESC
  `).all(status);

  const requests = rows.map(r => ({
    userId: r.user_id,
    email: r.email || null,
    displayName: r.display_name || '',
    photoUrl: r.photo_url || null,
    requestedAt: r.requested_at,
    status: r.status,
  }));

  res.json({ requests });
});

// ---------------------------------------------------------------------------
// GET /admin/audit-log — recent moderation actions (newest first)
// ---------------------------------------------------------------------------
router.get('/audit-log', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  // P1-C: LEFT JOIN target_id → email/display-name so the Activity view can show
  // a human name instead of a raw id. The join only resolves for USER-targeted
  // actions (suspend/verify); for report/photo/attachment targets it yields null
  // (target_id isn't a user id) — the frontend falls back to the raw id there.
  const rows = db.prepare(`
    SELECT m.id, m.action, m.target_id, m.detail, m.created_at,
           u.email AS actor_email,
           tu.email AS target_email, tp.display_name AS target_display_name
    FROM moderation_log m
    LEFT JOIN users u ON u.id = m.actor_id
    LEFT JOIN users tu ON tu.id = m.target_id
    LEFT JOIN profiles tp ON tp.user_id = m.target_id
    ORDER BY m.created_at DESC
    LIMIT 200
  `).all();
  res.json({ log: rows.map(r => ({
    id: r.id, action: r.action, targetId: r.target_id,
    targetEmail: r.target_email || null,
    targetName: r.target_display_name || null,
    detail: r.detail, createdAt: r.created_at, actor: r.actor_email || 'unknown',
  })) });
});

// ---------------------------------------------------------------------------
// GET /admin/stats — platform + moderation counts
// ---------------------------------------------------------------------------
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  // B-A: real member count EXCLUDES automated-test + demo personas (these inflate
  // the "Members" figure and produced the phantom "597"). `testAccounts` is
  // surfaced so the UI can show an explainable "(+N test)".
  //
  // Admin-gated demo toggle (?demo=1): when ON, the @sample demo members are
  // INCLUDED in the member/suspended counts (so the whole dashboard populates for
  // a demo) and `testAccounts` narrows to the genuinely-excluded test accounts.
  // When OFF (default), demo is excluded and the real-member discipline holds.
  // Test accounts are ALWAYS excluded from the member count either way.
  const includeDemo = req.query.demo === '1' || req.query.demo === 'true';
  const memberFilter = includeDemo ? 'email NOT LIKE ?' : 'email NOT LIKE ? AND email NOT LIKE ?';
  const memberParams = includeDemo ? [TEST_ACCOUNT_LIKE] : [TEST_ACCOUNT_LIKE, DEMO_ACCOUNT_LIKE];
  const members = db.prepare(
    `SELECT COUNT(*) AS c FROM users WHERE ${memberFilter}`
  ).get(...memberParams).c;
  // Accounts excluded from the member count: test always; demo only when the
  // toggle is OFF (when ON, demo is counted as members, so it's not "excluded").
  const testAccounts = includeDemo
    ? db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ?').get(TEST_ACCOUNT_LIKE).c
    : db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ? OR email LIKE ?').get(TEST_ACCOUNT_LIKE, DEMO_ACCOUNT_LIKE).c;
  const suspendedUsers = db.prepare(
    `SELECT COUNT(*) AS c FROM users WHERE suspended = 1 AND ${memberFilter}`
  ).get(...memberParams).c;

  const totalMatches = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  const totalConversations = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
  const totalMessages = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;

  const reportRows = db.prepare('SELECT status, COUNT(*) AS c FROM reports GROUP BY status').all();
  const reports = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
  for (const row of reportRows) {
    if (row.status in reports) reports[row.status] = row.c;
  }

  // B-B: per-queue depth + oldest-pending age so the dashboard can flag backlog
  // and past-SLA items. All hit existing indexes / small pending sets.
  const pendingAttachments = db.prepare(
    "SELECT COUNT(*) AS c FROM message_attachments WHERE upload_status = 'pending_review'"
  ).get().c;
  const pendingProfilePhotos = db.prepare(
    "SELECT COUNT(*) AS c FROM profile_photos WHERE review_status = 'pending_review'"
  ).get().c;
  const pendingVerifications = db.prepare(
    "SELECT COUNT(*) AS c FROM verification_requests WHERE status = 'pending'"
  ).get().c;

  const oldestOpenReportAt = db.prepare(
    "SELECT MIN(created_at) AS t FROM reports WHERE status = 'open'"
  ).get().t ?? null;
  const oldestPendingAttachmentAt = db.prepare(
    "SELECT MIN(created_at) AS t FROM message_attachments WHERE upload_status = 'pending_review'"
  ).get().t ?? null;
  const oldestPendingProfilePhotoAt = db.prepare(
    "SELECT MIN(created_at) AS t FROM profile_photos WHERE review_status = 'pending_review'"
  ).get().t ?? null;
  const oldestPendingVerificationAt = db.prepare(
    "SELECT MIN(requested_at) AS t FROM verification_requests WHERE status = 'pending'"
  ).get().t ?? null;

  res.json({
    // Real members (test/demo excluded). `totalUsers` kept as an alias for
    // backward compat with the current dashboard read.
    totalUsers: members,
    members,
    testAccounts,
    suspendedUsers,
    totalMatches,
    totalConversations,
    totalMessages,
    reports,
    pendingAttachments,
    pendingProfilePhotos,
    pendingVerifications,
    oldestOpenReportAt,
    oldestPendingAttachmentAt,
    oldestPendingProfilePhotoAt,
    oldestPendingVerificationAt,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/purge-test-accounts — bulk-delete automated-test accounts.
// Deletes every user whose email ends with @spectrum-test.dev via the shared
// account-deletion cascade, in one transaction. Body flag { includeDemo } (default
// false) ALSO purges @sample.spectrum-dating.app demo personas — the default MUST
// NOT touch demo accounts. Returns { deleted: <count> } and writes an audit row.
// ---------------------------------------------------------------------------
router.post('/purge-test-accounts', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const includeDemo = req.body?.includeDemo === true;

  const patterns = [`%${TEST_EMAIL_DOMAIN}`];
  if (includeDemo) patterns.push(`%${DEMO_EMAIL_DOMAIN}`);
  const where = patterns.map(() => 'email LIKE ?').join(' OR ');
  const targets = db.prepare(`SELECT id FROM users WHERE ${where}`).all(...patterns).map(r => r.id);

  const allKeys = [];
  const purge = db.transaction((ids) => {
    for (const id of ids) allKeys.push(...deleteUserRows(db, id));
    // Audit row inside the same transaction so it's atomic with the deletions.
    logMod(db, userId, 'purge_test_accounts', null, `deleted ${ids.length}${includeDemo ? ' (incl. demo)' : ''}`);
  });

  try {
    purge(targets);
  } catch (e) {
    console.error('Purge test accounts error:', e);
    return res.status(500).json({ error: 'Could not purge test accounts. Please try again.' });
  }

  // Best-effort R2 cleanup after the commit — never blocks or fails the request.
  purgeStorageObjects(allKeys);

  res.json({ deleted: targets.length });
});

// ---------------------------------------------------------------------------
// GET /admin/feedback — user-submitted feedback, newest first. LEFT JOIN users
// for the submitter's email (null if the user was deleted — feedback.user_id is
// ON DELETE SET NULL).
// ---------------------------------------------------------------------------
router.get('/feedback', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  const rows = db.prepare(`
    SELECT f.id, f.message, f.created_at, u.email AS user_email
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC
  `).all();

  const feedback = rows.map(r => ({
    id: r.id,
    userEmail: r.user_email || null,
    message: r.message,
    createdAt: r.created_at,
  }));

  res.json({ feedback });
});

// ---------------------------------------------------------------------------
// GET /admin/attachments?status=pending_review — message photo-attachment
// review queue (newest first). Default status is 'pending_review'.
// ---------------------------------------------------------------------------
router.get('/attachments', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const status = req.query.status || 'pending_review';

  const rows = db.prepare(`
    SELECT a.id, a.uploader_id, a.public_url, a.mime_type, a.created_at,
           u.email AS uploader_email
    FROM message_attachments a
    LEFT JOIN users u ON u.id = a.uploader_id
    WHERE a.upload_status = ?
    ORDER BY a.created_at DESC
  `).all(status);

  const attachments = rows.map(r => ({
    id: r.id,
    uploaderId: r.uploader_id,
    uploaderEmail: r.uploader_email || null,
    publicUrl: r.public_url,
    mimeType: r.mime_type,
    createdAt: r.created_at,
  }));

  res.json({ attachments });
});

// ---------------------------------------------------------------------------
// POST /admin/attachments/:id/review — body { decision: 'approved'|'rejected' }
// Sets upload_status + reviewed_at + reviewed_by and writes a moderation_log row.
// ---------------------------------------------------------------------------
router.post('/attachments/:id/review', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const { decision } = req.body ?? {};

  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  // B-E: a rejection (a destructive moderation action) must be justified.
  if (decision === 'rejected' && !note) {
    return res.status(400).json({ error: 'A note/reason is required to reject an attachment.' });
  }

  const attachment = db.prepare(
    'SELECT id, upload_status FROM message_attachments WHERE id = ?'
  ).get(req.params.id);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });
  if (attachment.upload_status !== 'pending_review') {
    return res.status(409).json({ error: `Cannot review: status is '${attachment.upload_status}'.` });
  }

  db.prepare(
    'UPDATE message_attachments SET upload_status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
  ).run(decision, Date.now(), userId, req.params.id);
  logMod(db, userId, decision === 'approved' ? 'approve_attachment' : 'reject_attachment', req.params.id, note);

  res.json({ ok: true, status: decision });
});

// ---------------------------------------------------------------------------
// GET /admin/profile-photos/pending — profile-photo review queue (SAFETY-2).
// Lists profile_photos awaiting moderation with owner context, newest first.
// Mirrors GET /admin/attachments.
// ---------------------------------------------------------------------------
router.get('/profile-photos/pending', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  const rows = db.prepare(`
    SELECT pp.id, pp.user_id, pp.url, pp.description, pp.created_at,
           u.email AS owner_email, p.display_name AS owner_display_name
    FROM profile_photos pp
    LEFT JOIN users u ON u.id = pp.user_id
    LEFT JOIN profiles p ON p.user_id = pp.user_id
    WHERE pp.review_status = 'pending_review'
    ORDER BY pp.created_at DESC
  `).all();

  const photos = rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    ownerEmail: r.owner_email || null,
    ownerDisplayName: r.owner_display_name || '',
    url: r.url,
    description: r.description || '',
    createdAt: r.created_at,
  }));

  res.json({ photos });
});

// ---------------------------------------------------------------------------
// POST /admin/profile-photos/:id/review — body { decision: 'approve'|'reject' }
// Approve: mark approved + reviewer bookkeeping, then re-sync the owner's public
// photo_url so the newly-approved photo becomes servable. Reject: mark rejected
// (no longer served — listPhotos/photo_url both ignore non-approved rows) and
// best-effort soft-delete the object from R2. Writes a moderation_log row.
// ---------------------------------------------------------------------------
router.post('/profile-photos/:id/review', requireAuth, requireAdmin, (req, res) => {
  const { db, userId } = req.ctx;
  const { decision } = req.body ?? {};

  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'." });
  }
  let note;
  try {
    note = readNote(req.body);
  } catch (e) {
    if (e.badNote) return res.status(400).json({ error: e.message });
    throw e;
  }
  // B-E: a rejection (a destructive moderation action) must be justified.
  if (decision === 'reject' && !note) {
    return res.status(400).json({ error: 'A note/reason is required to reject a photo.' });
  }

  const photo = db.prepare(
    'SELECT id, user_id, review_status, storage_key FROM profile_photos WHERE id = ?'
  ).get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  if (photo.review_status !== 'pending_review') {
    return res.status(409).json({ error: `Cannot review: status is '${photo.review_status}'.` });
  }

  const now = Date.now();
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

  db.transaction(() => {
    db.prepare(
      'UPDATE profile_photos SET review_status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
    ).run(nextStatus, now, userId, photo.id);
    // Re-derive the owner's public photo_url from their approved photos. On
    // approve this surfaces the newly-approved photo; on reject it's a safe no-op
    // (a rejected photo was pending and never mirrored) that also cleans up if the
    // approved set is now empty.
    syncPrimaryPhotoUrl(db, photo.user_id, now);
  })();

  logMod(db, userId, decision === 'approve' ? 'approve_profile_photo' : 'reject_profile_photo', photo.id, note);

  // On reject, best-effort remove the object from R2 (skip empty/legacy keys).
  if (decision === 'reject' && photo.storage_key) {
    deleteObject(photo.storage_key).catch(() => {});
  }

  res.json({ ok: true, status: nextStatus });
});

// ---------------------------------------------------------------------------
// GET /admin/reports/:id/context — P1-A: surface the reported conversation so a
// moderator isn't triaging blind. Returns the last ~30 messages of the report's
// conversation (sender-attributed, with attachment refs). If the live
// conversation is gone (CASCADE-deleted with a departed user / ended match), we
// fall back to the message text snapshotted onto the report at report time.
// Read-only, admin-gated.
// ---------------------------------------------------------------------------
router.get('/reports/:id/context', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const report = db.prepare(
    'SELECT id, conversation_id, reported_id, reported_message FROM reports WHERE id = ?'
  ).get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  let messages = [];
  if (report.conversation_id) {
    const rows = db.prepare(`
      SELECT m.id, m.sender_id, m.body, m.deleted, m.sent_at,
             p.display_name AS sender_display_name, u.email AS sender_email
      FROM messages m
      LEFT JOIN profiles p ON p.user_id = m.sender_id
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at DESC
      LIMIT 30
    `).all(report.conversation_id);

    const attachStmt = db.prepare(
      'SELECT id, public_url, mime_type, upload_status FROM message_attachments WHERE message_id = ?'
    );

    // Oldest-first for natural reading order.
    messages = rows.reverse().map(m => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_display_name || '',
      senderEmail: m.sender_email || null,
      fromReported: m.sender_id === report.reported_id,
      body: m.deleted ? null : m.body,
      deleted: !!m.deleted,
      createdAt: m.sent_at,
      attachments: attachStmt.all(m.id).map(a => ({
        id: a.id, url: a.public_url, mimeType: a.mime_type, status: a.upload_status,
      })),
    }));
  }

  res.json({
    conversationId: report.conversation_id || null,
    // `live` = the conversation is still present; else the caller renders the
    // snapshot fallback.
    live: messages.length > 0,
    messages,
    snapshot: report.reported_message || null,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/history — P1-B: repeat-offender context for one user.
// Prior reports against them (and how many were actioned), distinct members who
// blocked them (strong, non-gameable signal), and account age. Query-only,
// hits idx_reports_reported. Read-only, admin-gated.
// ---------------------------------------------------------------------------
router.get('/users/:id/history', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;
  const user = db.prepare('SELECT id, email, created_at, suspended, banned FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const reportsAgainst = db.prepare(
    'SELECT COUNT(*) AS c FROM reports WHERE reported_id = ?'
  ).get(req.params.id).c;
  const reportsActioned = db.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE reported_id = ? AND status = 'actioned'"
  ).get(req.params.id).c;
  const distinctBlockers = db.prepare(
    'SELECT COUNT(DISTINCT blocker_id) AS c FROM blocks WHERE blocked_id = ?'
  ).get(req.params.id).c;
  const chatSignalCount = db.prepare(
    'SELECT COUNT(*) AS c FROM chat_safety_signals WHERE user_id = ?'
  ).get(req.params.id).c;
  const warnCount = db.prepare(
    "SELECT COUNT(*) AS c FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'"
  ).get(req.params.id).c;

  res.json({
    userId: user.id,
    email: user.email,
    suspended: !!user.suspended,
    // Needed #7/#11: full enforcement state + latest reason for the drill-down.
    banned: !!user.banned,
    warnCount,
    latestNotice: latestNotice(db, req.params.id),
    accountCreatedAt: user.created_at,
    reportsAgainst,
    reportsActioned,
    distinctBlockers,
    chatSignalCount,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeReport(r) {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    reportedId: r.reported_id,
    conversationId: r.conversation_id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    moderatorNote: r.moderator_note,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    // B-C: who resolved it (null until resolved / if the resolver was deleted).
    resolvedBy: r.resolved_by
      ? { userId: r.resolved_by, email: r.resolver_email, displayName: r.resolver_display_name || '' }
      : null,
    // P1-A: durable snapshot of the reported user's message(s) at report time.
    reportedMessage: r.reported_message || null,
    reporter: { email: r.reporter_email, displayName: r.reporter_display_name || '' },
    reported: {
      email: r.reported_email,
      displayName: r.reported_display_name || '',
      suspended: !!r.reported_suspended,
      // Needed #7: PERMANENT ban state (distinct from reversible suspend).
      banned: !!r.reported_banned,
      // Needed #7/#11: how many warnings this member has accrued + the latest
      // enforcement notice (kind + reason + when) so the moderator sees the full
      // enforcement state and the most recent reason on the card.
      warnCount: r.reported_warn_count ?? 0,
      latestNotice: r.reported_notice_kind
        ? { kind: r.reported_notice_kind, reason: r.reported_notice_reason || '', createdAt: r.reported_notice_at ?? null }
        : null,
      // B-F: real verification state (the badge previously always lied).
      verified: !!r.reported_verified,
      // P1-B: repeat-offender signal on every card. `reportCount` is the TOTAL
      // reports against this user (incl. the current one); `blockedByCount` is
      // distinct members who blocked them (strong, non-gameable).
      createdAt: r.reported_created_at ?? null,
      reportCount: r.reported_report_count ?? 0,
      actionedCount: r.reported_actioned_count ?? 0,
      blockedByCount: r.reported_block_count ?? 0,
      // Needed #4: observe-only off-platform/money chat signals attributed to
      // this user — a "repeat off-platform/money pusher" grooming indicator.
      chatSignalCount: r.reported_chat_signal_count ?? 0,
    },
  };
}

function userContext(db, userId) {
  const user = db.prepare('SELECT id, email, created_at, suspended, banned FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const profile = db.prepare(
    'SELECT display_name, tagline, bio, comm_note, relationship_goal, dist_city FROM profiles WHERE user_id = ?'
  ).get(userId);
  const warnCount = db.prepare(
    "SELECT COUNT(*) AS c FROM enforcement_notices WHERE user_id = ? AND kind = 'warn'"
  ).get(userId).c;
  return {
    userId: user.id,
    email: user.email,
    createdAt: user.created_at,
    suspended: !!user.suspended,
    // Needed #7/#11: enforcement state + latest reason on the single-report view.
    banned: !!user.banned,
    warnCount,
    latestNotice: latestNotice(db, userId),
    displayName: profile?.display_name || '',
    tagline: profile?.tagline || '',
    bio: profile?.bio || '',
    commNote: profile?.comm_note || '',
    relationshipGoal: profile?.relationship_goal || '',
    distCity: profile?.dist_city || '',
  };
}

export default router;
