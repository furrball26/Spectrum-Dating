import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdminEmail } from '../middleware/admin.js';
import { emailConfigured } from '../email/resend.js';
import { listPhotos } from './photos.js';
import { ageFromDob } from '../utils/time.js';

const router = Router();

const VALID_NOTIFICATION_TIERS = ['in_app', 'silent_push', 'name_only'];
const VALID_RELATIONSHIP_GOALS = ['', 'long-term', 'friendship', 'open'];
const VALID_WANTS_CHILDREN = ['', 'yes', 'no', 'open'];
const VALID_FREQUENCY = ['', 'no', 'sometimes', 'yes']; // smoking & drinking

// GET /profile/me
router.get('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  const interestRows = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?').all(userId);
  const interests = interestRows.map(r => r.interest);

  const dobAge = profile.date_of_birth ? ageFromDob(profile.date_of_birth) : null;

  const onboardingComplete = !!(
    profile.display_name?.trim() &&
    profile.bio?.trim() &&
    interests.length > 0 &&
    profile.date_of_birth &&
    dobAge !== null && dobAge >= 18
  );

  const userRow = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(userId);

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
    photos: listPhotos(db, userId),
    dateOfBirth: profile.date_of_birth || '',
    age: dobAge,
    wantsChildren: profile.wants_children || '',
    smoking: profile.smoking || '',
    drinking: profile.drinking || '',
    dbWantsChildren: !!profile.db_wants_children,
    dbNonSmoker: !!profile.db_non_smoker,
    dbMustBeLocal: !!profile.db_must_be_local,
    interests,
    onboardingComplete,
    emailVerified: !!userRow?.email_verified,
    emailVerificationEnabled: emailConfigured(),
    isAdmin: isAdminEmail(userRow?.email),
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
  if (body.wantsChildren !== undefined) {
    if (!VALID_WANTS_CHILDREN.includes(body.wantsChildren)) {
      errors.push(`wantsChildren must be one of: ${VALID_WANTS_CHILDREN.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.smoking !== undefined) {
    if (!VALID_FREQUENCY.includes(body.smoking)) {
      errors.push(`smoking must be one of: ${VALID_FREQUENCY.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.drinking !== undefined) {
    if (!VALID_FREQUENCY.includes(body.drinking)) {
      errors.push(`drinking must be one of: ${VALID_FREQUENCY.map(v => v === '' ? '""' : v).join(', ')}.`);
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

  // Date of birth: must be a real YYYY-MM-DD date and 18+.
  if (body.dateOfBirth !== undefined) {
    if (typeof body.dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth)) {
      return res.status(400).json({ error: 'Please enter a valid date of birth.' });
    }
    const age = ageFromDob(body.dateOfBirth);
    if (age === null) {
      // Malformed / impossible calendar date (e.g. 2020-02-30).
      return res.status(400).json({ error: 'Please enter a valid date of birth.' });
    }
    if (age < 18) {
      return res.status(400).json({ error: 'You must be 18 or older to use Spectrum Dating.' });
    }
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
    dateOfBirth: 'date_of_birth',
    wantsChildren: 'wants_children',
    smoking: 'smoking',
    drinking: 'drinking',
  };

  // Deal-breaker flags: stored as 0/1, coerced from any truthy/falsy boolean.
  const boolFieldMap = {
    dbWantsChildren: 'db_wants_children',
    dbNonSmoker: 'db_non_smoker',
    dbMustBeLocal: 'db_must_be_local',
  };

  const setClauses = [];
  const values = [];

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) {
      setClauses.push(`${dbCol} = ?`);
      values.push(body[jsKey]);
    }
  }

  for (const [jsKey, dbCol] of Object.entries(boolFieldMap)) {
    if (body[jsKey] !== undefined) {
      setClauses.push(`${dbCol} = ?`);
      values.push(body[jsKey] ? 1 : 0);
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
    dateOfBirth: profile.date_of_birth || '',
    age: profile.date_of_birth ? ageFromDob(profile.date_of_birth) : null,
    wantsChildren: profile.wants_children || '',
    smoking: profile.smoking || '',
    drinking: profile.drinking || '',
    dbWantsChildren: !!profile.db_wants_children,
    dbNonSmoker: !!profile.db_non_smoker,
    dbMustBeLocal: !!profile.db_must_be_local,
    interests: interestRows.map(r => r.interest),
  });
});

export default router;
