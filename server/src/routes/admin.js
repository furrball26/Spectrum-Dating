import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, isAdminEmail } from '../middleware/admin.js';
import { newId } from '../utils/ids.js';
import { disconnectUser } from '../socket/index.js';
import { syncPrimaryPhotoUrl } from './photos.js';
import { deleteObject } from '../storage/r2.js';

const router = Router();

const RESOLVE_STATUSES = ['reviewed', 'actioned', 'dismissed'];

// Append-only moderation audit log.
function logMod(db, actorId, action, targetId, detail = '') {
  db.prepare(
    'INSERT INTO moderation_log (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId(), actorId, action, targetId ?? null, detail, Date.now());
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
           r.created_at, r.resolved_at,
           ru.email AS reporter_email, rp.display_name AS reporter_display_name,
           du.email AS reported_email, dp.display_name AS reported_display_name,
           du.suspended AS reported_suspended
    FROM reports r
    LEFT JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
    LEFT JOIN users du ON du.id = r.reported_id
    LEFT JOIN profiles dp ON dp.user_id = r.reported_id
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
  const { status, note } = req.body ?? {};

  if (!RESOLVE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${RESOLVE_STATUSES.join(', ')}` });
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return res.status(400).json({ error: 'note must be a string.' });
  }

  const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Report not found.' });

  db.prepare(
    'UPDATE reports SET status = ?, moderator_note = ?, resolved_at = ? WHERE id = ?'
  ).run(status, note ?? null, Date.now(), req.params.id);
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

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (suspended) {
    // Suspend AND force-logout immediately by bumping token_version.
    db.prepare(
      'UPDATE users SET suspended = 1, token_version = token_version + 1 WHERE id = ?'
    ).run(req.params.id);
    // Kill any already-open sockets so the suspended user stops live-receiving
    // room events immediately (the socket auth check only runs at connect time).
    disconnectUser(req.app.locals.io, req.params.id);
  } else {
    db.prepare('UPDATE users SET suspended = 0 WHERE id = ?').run(req.params.id);
  }
  logMod(db, req.ctx.userId, suspended ? 'suspend' : 'unsuspend', req.params.id);

  res.json({ ok: true, suspended });
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

  const result = db.prepare(
    'UPDATE profiles SET identity_verified = ? WHERE user_id = ?'
  ).run(verified ? 1 : 0, req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Profile not found.' });
  }
  logMod(db, req.ctx.userId, verified ? 'verify' : 'unverify', req.params.id);

  // E19: profiles.identity_verified (set above) is the SINGLE SOURCE OF TRUTH.
  // We still advance the verification_requests row so the moderation QUEUE
  // reflects the decision (approved/rejected) and stops re-surfacing this user,
  // but profile.js no longer trusts this column to decide "verified" — it reads
  // identity_verified directly and only consults verification_requests for the
  // queue state of NOT-yet-verified users. So even if this UPDATE were to no-op
  // (e.g. the user never filed a request), the user's verified state is correct.
  const newStatus = verified ? 'approved' : 'rejected';
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
  const rows = db.prepare(`
    SELECT m.id, m.action, m.target_id, m.detail, m.created_at,
           u.email AS actor_email
    FROM moderation_log m
    LEFT JOIN users u ON u.id = m.actor_id
    ORDER BY m.created_at DESC
    LIMIT 200
  `).all();
  res.json({ log: rows.map(r => ({
    id: r.id, action: r.action, targetId: r.target_id,
    detail: r.detail, createdAt: r.created_at, actor: r.actor_email || 'unknown',
  })) });
});

// ---------------------------------------------------------------------------
// GET /admin/stats — platform + moderation counts
// ---------------------------------------------------------------------------
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const { db } = req.ctx;

  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const suspendedUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE suspended = 1').get().c;
  const totalMatches = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  const totalConversations = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
  const totalMessages = db.prepare('SELECT COUNT(*) AS c FROM messages').get().c;

  const reportRows = db.prepare('SELECT status, COUNT(*) AS c FROM reports GROUP BY status').all();
  const reports = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
  for (const row of reportRows) {
    reports[row.status] = row.c;
  }

  res.json({
    totalUsers,
    suspendedUsers,
    totalMatches,
    totalConversations,
    totalMessages,
    reports,
  });
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
  logMod(db, userId, decision === 'approved' ? 'approve_attachment' : 'reject_attachment', req.params.id);

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

  logMod(db, userId, decision === 'approve' ? 'approve_profile_photo' : 'reject_profile_photo', photo.id);

  // On reject, best-effort remove the object from R2 (skip empty/legacy keys).
  if (decision === 'reject' && photo.storage_key) {
    deleteObject(photo.storage_key).catch(() => {});
  }

  res.json({ ok: true, status: nextStatus });
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
    reporter: { email: r.reporter_email, displayName: r.reporter_display_name || '' },
    reported: {
      email: r.reported_email,
      displayName: r.reported_display_name || '',
      suspended: !!r.reported_suspended,
    },
  };
}

function userContext(db, userId) {
  const user = db.prepare('SELECT id, email, created_at, suspended FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const profile = db.prepare(
    'SELECT display_name, tagline, bio, comm_note, relationship_goal, dist_city FROM profiles WHERE user_id = ?'
  ).get(userId);
  return {
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
  };
}

export default router;
