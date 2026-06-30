import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, isAdminEmail } from '../middleware/admin.js';

const router = Router();

const RESOLVE_STATUSES = ['reviewed', 'actioned', 'dismissed'];

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
  } else {
    db.prepare('UPDATE users SET suspended = 0 WHERE id = ?').run(req.params.id);
  }

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

  res.json({ ok: true, verified });
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
