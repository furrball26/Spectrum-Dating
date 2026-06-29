import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const VALID_NOTIFICATION_TIERS = ['in_app', 'silent_push', 'name_only'];
const VALID_RELATIONSHIP_GOALS = ['', 'long-term', 'friendship', 'open'];

// GET /profile/me
router.get('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  const interestRows = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?').all(userId);
  const interests = interestRows.map(r => r.interest);

  return res.json({
    userId: profile.user_id,
    displayName: profile.display_name,
    tagline: profile.tagline,
    bio: profile.bio,
    commNote: profile.comm_note,
    relationshipGoal: profile.relationship_goal,
    distCity: profile.dist_city,
    notificationTier: profile.notification_tier,
    photoUrl: profile.photo_url || '',
    interests,
  });
});

// PUT /profile/me
router.put('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const body = req.body ?? {};

  // Field-level validation
  const errors = [];

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') errors.push('displayName must be a string.');
    else if (body.displayName.length > 30) errors.push('displayName must be 30 characters or fewer.');
  }
  if (body.tagline !== undefined) {
    if (typeof body.tagline !== 'string') errors.push('tagline must be a string.');
    else if (body.tagline.length > 80) errors.push('tagline must be 80 characters or fewer.');
  }
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string') errors.push('bio must be a string.');
    else if (body.bio.length > 500) errors.push('bio must be 500 characters or fewer.');
  }
  if (body.commNote !== undefined) {
    if (typeof body.commNote !== 'string') errors.push('commNote must be a string.');
    else if (body.commNote.length > 120) errors.push('commNote must be 120 characters or fewer.');
  }
  if (body.distCity !== undefined) {
    if (typeof body.distCity !== 'string') errors.push('distCity must be a string.');
    else if (body.distCity.length > 100) errors.push('distCity must be 100 characters or fewer.');
  }
  if (body.notificationTier !== undefined) {
    if (!VALID_NOTIFICATION_TIERS.includes(body.notificationTier)) {
      errors.push(`notificationTier must be one of: ${VALID_NOTIFICATION_TIERS.join(', ')}.`);
    }
  }
  if (body.relationshipGoal !== undefined) {
    if (!VALID_RELATIONSHIP_GOALS.includes(body.relationshipGoal)) {
      errors.push(`relationshipGoal must be one of: ${VALID_RELATIONSHIP_GOALS.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests)) {
      errors.push('interests must be an array.');
    } else {
      if (body.interests.length > 50) errors.push('interests may contain at most 50 items.');
      for (const item of body.interests) {
        if (typeof item !== 'string') { errors.push('Each interest must be a string.'); break; }
        if (item.length > 30) { errors.push('Each interest must be 30 characters or fewer.'); break; }
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  // Build SET clause dynamically — only update provided fields
  const fieldMap = {
    displayName: 'display_name',
    tagline: 'tagline',
    bio: 'bio',
    commNote: 'comm_note',
    relationshipGoal: 'relationship_goal',
    distCity: 'dist_city',
    notificationTier: 'notification_tier',
  };

  const setClauses = [];
  const values = [];

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) {
      setClauses.push(`${dbCol} = ?`);
      values.push(body[jsKey]);
    }
  }

  const now = Date.now();

  db.transaction(() => {
    // Update profile fields if any provided
    if (setClauses.length > 0) {
      setClauses.push('updated_at = ?');
      values.push(now, userId);
      db.prepare(`UPDATE profiles SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);
    }

    // Replace interests if provided
    if (body.interests !== undefined) {
      db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
      const insertInterest = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
      for (const interest of body.interests) {
        insertInterest.run(userId, interest);
      }
    }
  })();

  // Return the full updated profile
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const interestRows = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?').all(userId);

  return res.json({
    userId: profile.user_id,
    displayName: profile.display_name,
    tagline: profile.tagline,
    bio: profile.bio,
    commNote: profile.comm_note,
    relationshipGoal: profile.relationship_goal,
    distCity: profile.dist_city,
    notificationTier: profile.notification_tier,
    photoUrl: profile.photo_url || '',
    interests: interestRows.map(r => r.interest),
  });
});

export default router;
