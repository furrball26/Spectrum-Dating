import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdminEmail } from '../middleware/admin.js';
import { emailConfigured } from '../email/resend.js';
import { listPhotos } from './photos.js';
import { ageFromDob } from '../utils/time.js';
import { newId } from '../utils/ids.js';
import { PROMPTS, PROMPT_KEYS, PROMPT_TEXT_BY_KEY } from '../data/prompts.js';

const router = Router();

const MAX_PROMPTS = 3;
const MAX_PROMPT_ANSWER = 200;

// Serialize a user's chosen prompts, ordered by position. Joins the catalog
// text by key; rows whose key is no longer in the catalog are skipped so a
// dropped prompt never crashes or leaks a stale, text-less entry.
export function listPrompts(db, userId) {
  const rows = db.prepare(
    'SELECT prompt_key, answer FROM profile_prompts WHERE user_id = ? ORDER BY position ASC, created_at ASC'
  ).all(userId);
  const out = [];
  for (const r of rows) {
    const promptText = PROMPT_TEXT_BY_KEY.get(r.prompt_key);
    if (!promptText) continue; // key retired from catalog — skip silently
    out.push({ promptKey: r.prompt_key, promptText, answer: r.answer });
  }
  return out;
}

const VALID_NOTIFICATION_TIERS = ['in_app', 'silent_push', 'name_only'];
const VALID_RELATIONSHIP_GOALS = ['', 'long-term', 'friendship', 'open'];
const VALID_WANTS_CHILDREN = ['', 'yes', 'no', 'open'];
const VALID_FREQUENCY = ['', 'no', 'sometimes', 'yes']; // smoking & drinking
// Differentiator dimensions (autistic-friendly): communication style + sensory
const VALID_COMM_DIRECTNESS = ['', 'direct', 'softened'];
const VALID_COMM_LITERAL = ['', 'literal', 'playful'];
const VALID_COMM_CADENCE = ['', 'instant', 'daily', 'whenever'];
const VALID_SENSORY_ENVIRONMENT = ['', 'quiet', 'lively', 'either'];
const VALID_SENSORY_LIGHTING = ['', 'dim', 'bright', 'either'];
const VALID_SOCIAL_DURATION = ['', 'short', 'medium', 'long'];

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
    paused: !!profile.paused,
    commDirectness: profile.comm_directness || '',
    commLiteral: profile.comm_literal || '',
    commCadence: profile.comm_cadence || '',
    sensoryEnvironment: profile.sensory_environment || '',
    sensoryLighting: profile.sensory_lighting || '',
    socialDuration: profile.social_duration || '',
    contextCard: profile.context_card || '',
    interests,
    prompts: listPrompts(db, userId),
    onboardingComplete,
    verified: !!profile.identity_verified,
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
  if (body.commDirectness !== undefined) {
    if (!VALID_COMM_DIRECTNESS.includes(body.commDirectness)) {
      errors.push(`commDirectness must be one of: ${VALID_COMM_DIRECTNESS.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.commLiteral !== undefined) {
    if (!VALID_COMM_LITERAL.includes(body.commLiteral)) {
      errors.push(`commLiteral must be one of: ${VALID_COMM_LITERAL.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.commCadence !== undefined) {
    if (!VALID_COMM_CADENCE.includes(body.commCadence)) {
      errors.push(`commCadence must be one of: ${VALID_COMM_CADENCE.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.sensoryEnvironment !== undefined) {
    if (!VALID_SENSORY_ENVIRONMENT.includes(body.sensoryEnvironment)) {
      errors.push(`sensoryEnvironment must be one of: ${VALID_SENSORY_ENVIRONMENT.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.sensoryLighting !== undefined) {
    if (!VALID_SENSORY_LIGHTING.includes(body.sensoryLighting)) {
      errors.push(`sensoryLighting must be one of: ${VALID_SENSORY_LIGHTING.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.socialDuration !== undefined) {
    if (!VALID_SOCIAL_DURATION.includes(body.socialDuration)) {
      errors.push(`socialDuration must be one of: ${VALID_SOCIAL_DURATION.map(v => v === '' ? '""' : v).join(', ')}.`);
    }
  }
  if (body.contextCard !== undefined) {
    if (typeof body.contextCard !== 'string') errors.push('contextCard must be a string.');
    else if (body.contextCard.length > 300) errors.push('contextCard must be 300 characters or fewer.');
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
    commDirectness: 'comm_directness',
    commLiteral: 'comm_literal',
    commCadence: 'comm_cadence',
    sensoryEnvironment: 'sensory_environment',
    sensoryLighting: 'sensory_lighting',
    socialDuration: 'social_duration',
    contextCard: 'context_card',
  };

  // Boolean flags stored as 0/1, coerced from any truthy/falsy value.
  const boolFieldMap = {
    dbWantsChildren: 'db_wants_children',
    dbNonSmoker: 'db_non_smoker',
    dbMustBeLocal: 'db_must_be_local',
    // Pause/snooze: 1 hides the user from others' Discover; they keep full app access.
    paused: 'paused',
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
    paused: !!profile.paused,
    commDirectness: profile.comm_directness || '',
    commLiteral: profile.comm_literal || '',
    commCadence: profile.comm_cadence || '',
    sensoryEnvironment: profile.sensory_environment || '',
    sensoryLighting: profile.sensory_lighting || '',
    socialDuration: profile.social_duration || '',
    contextCard: profile.context_card || '',
    interests: interestRows.map(r => r.interest),
  });
});

// GET /profile/prompt-catalog — the fixed catalog of prompts the frontend offers
// as options. Auth not required: the catalog is public scaffolding, not user data.
router.get('/prompt-catalog', (req, res) => {
  return res.json({ prompts: PROMPTS });
});

// PUT /profile/prompts — replace the user's chosen prompt answers (max 3).
// Body: { prompts: [{ promptKey, answer }] }. Each promptKey must be in the
// catalog; each answer a non-empty string ≤ 200 chars. Replaces the whole set
// in a transaction (positions 0..n).
router.put('/prompts', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const body = req.body ?? {};

  if (!Array.isArray(body.prompts)) {
    return res.status(400).json({ error: 'prompts must be an array.' });
  }
  if (body.prompts.length > MAX_PROMPTS) {
    return res.status(400).json({ error: `You can choose at most ${MAX_PROMPTS} prompts.` });
  }

  for (const entry of body.prompts) {
    if (!entry || typeof entry !== 'object') {
      return res.status(400).json({ error: 'Each prompt must be an object with promptKey and answer.' });
    }
    if (typeof entry.promptKey !== 'string' || !PROMPT_KEYS.has(entry.promptKey)) {
      return res.status(400).json({ error: 'Each promptKey must be a valid prompt from the catalog.' });
    }
    if (typeof entry.answer !== 'string' || entry.answer.trim() === '') {
      return res.status(400).json({ error: 'Each answer must be a non-empty string.' });
    }
    if (entry.answer.length > MAX_PROMPT_ANSWER) {
      return res.status(400).json({ error: `Each answer must be ${MAX_PROMPT_ANSWER} characters or fewer.` });
    }
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM profile_prompts WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      'INSERT INTO profile_prompts (id, user_id, prompt_key, answer, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    body.prompts.forEach((entry, i) => {
      insert.run(newId(), userId, entry.promptKey, entry.answer, i, now);
    });
  })();

  return res.json({ prompts: listPrompts(db, userId) });
});

export default router;
