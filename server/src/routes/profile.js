import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { abuseReportLimiter } from '../middleware/rateLimits.js';
import { isAdminUser } from '../middleware/admin.js';
import { getEntitlement } from '../billing/entitlements.js';
import { emailConfigured } from '../email/resend.js';
import { listPhotos, listPublicPhotos } from './photos.js';
import { listPublicAudio, listOwnAudio } from './audio.js';
import { ageFromDob } from '../utils/time.js';
import { coarseCity, isGeocodable, stateFromCity } from '../utils/metros.js';
import { containsSlur } from '../utils/nameScreen.js';
import { isTransRiskState, isTransSpectrumGender } from '../data/transSafety.js';
import { newId } from '../utils/ids.js';
import {
  ALL_PROMPTS,
  ALL_PROMPT_KEYS,
  PROMPT_TEXT_BY_KEY,
  PROMPT_TYPE_BY_KEY,
  PROMPT_OPTIONS_BY_KEY,
} from '../data/prompts.js';
import { lookupGeo } from '../telemetry/geo.js';
import { isHostileRegion } from '../data/hostileRegions.js';

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
    // Type + options are derived from the CATALOG (authoritative), not the stored
    // row, so display always matches the current catalog shape. A choice prompt's
    // `answer` is the chosen option string — rendered exactly like a text answer
    // ("here's my pick"); we NEVER attach vote counts or any aggregate signal.
    const promptType = PROMPT_TYPE_BY_KEY.get(r.prompt_key) || 'text';
    const entry = { promptKey: r.prompt_key, promptText, answer: r.answer, promptType };
    if (promptType === 'choice') {
      entry.options = PROMPT_OPTIONS_BY_KEY.get(r.prompt_key) || [];
    }
    out.push(entry);
  }
  return out;
}

// F28 — structured "about me" facets. The two list facets are persisted as a
// JSON array string; '' means "unset". parseFacetList('') → []; an empty list
// serialises back to '' so "unset" and "empty list" are indistinguishable.
const MAX_OCCUPATION = 80;
const MAX_LANGUAGES = 120;
const MAX_FACET_ITEMS = 5;
const MAX_FACET_ITEM_LEN = 60;
// D-17 — special_interests reuses the F28 facet machinery but with its own caps:
// a tighter list (deep interests, not a laundry list) and slur-screened per item.
const MAX_SPECIAL_INTERESTS = 3;
const MAX_SPECIAL_INTEREST_LEN = 40;

// Parse a stored facet-list column ('' or JSON array text) back into a string[].
// Tolerant of malformed/legacy values — never throws, always returns an array.
export function parseFacetList(str) {
  if (!str || typeof str !== 'string') return [];
  try {
    const arr = JSON.parse(str);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// Serialise a client-supplied facet list for storage: trim, drop empties, cap to
// maxItems. An empty result stores as '' (not '[]') so unset === empty.
function serializeFacetList(arr, maxItems = MAX_FACET_ITEMS) {
  const cleaned = arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length ? JSON.stringify(cleaned) : '';
}

// Validate a client-supplied facet list, pushing calm 400 copy on any violation.
// opts: { maxItems, maxItemLen, screenSlurs } — default to the F28 facet caps so
// existing helpsMe/hardForMe behaviour is unchanged. screenSlurs runs each item
// through containsSlur (used by special_interests) with the same non-shaming copy.
function validateFacetList(val, label, errors, opts = {}) {
  const maxItems = opts.maxItems ?? MAX_FACET_ITEMS;
  const maxItemLen = opts.maxItemLen ?? MAX_FACET_ITEM_LEN;
  if (!Array.isArray(val)) { errors.push(`${label} must be a list.`); return; }
  if (val.length > maxItems) {
    errors.push(`${label} can have at most ${maxItems} items.`);
  }
  for (const item of val) {
    if (typeof item !== 'string') { errors.push(`Each ${label} item must be text.`); break; }
    if (item.length > maxItemLen) {
      errors.push(`Each ${label} item must be ${maxItemLen} characters or fewer.`);
      break;
    }
    if (opts.screenSlurs && containsSlur(item)) {
      errors.push(`Please choose ${label} without offensive language.`);
      break;
    }
  }
}

const VALID_NOTIFICATION_TIERS = ['in_app', 'silent_push', 'name_only'];
const VALID_RADII = [0, 25, 50, 100, 250]; // miles; 0 = anywhere (no radius filter)
// D-11/D-12 — expanded gender ENUM (DISPLAY). The three legacy core values plus
// 'other'/'' are kept; the rest are new self-identify options. This is what the
// user sees on their profile — it is NOT what matching filters on.
const VALID_GENDERS = [
  '', 'woman', 'man', 'nonbinary', 'other',
  'agender', 'genderfluid', 'genderqueer', 'trans-man', 'trans-woman',
  'two-spirit', 'bigender', 'intersex', 'questioning',
];
// GENDER_GROUP — the ONLY thing matching reads. Collapses every expanded gender
// down to the 3-value matchable core (or '' = no core, sought by no one and
// seeking-agnostic). trans-man is sought by people seeking men; trans-woman by
// people seeking women; every other non-binary identity (and legacy 'other',
// previously a matching dead-end) folds into 'nonbinary'.
const GENDER_GROUP = {
  '': '',
  woman: 'woman',
  man: 'man',
  nonbinary: 'nonbinary',
  'trans-man': 'man',
  'trans-woman': 'woman',
  agender: 'nonbinary',
  genderfluid: 'nonbinary',
  genderqueer: 'nonbinary',
  bigender: 'nonbinary',
  'two-spirit': 'nonbinary',
  intersex: 'nonbinary',
  questioning: 'nonbinary',
  other: 'nonbinary',
};
// Derive the matchable-core group from a (validated) expanded gender. Unknown
// input collapses to '' — never leak an un-cored value into matching.
export function genderGroupFor(gender) {
  return Object.prototype.hasOwnProperty.call(GENDER_GROUP, gender) ? GENDER_GROUP[gender] : '';
}
const MAX_GENDER_CUSTOM = 40;
const SEEKING_TOKENS = ['woman', 'man', 'nonbinary']; // '' = open to everyone
// D-13 — sexual orientation (DISPLAY ONLY; never wired into candidates.js).
// comma-joined multi-select mirroring the proven `seeking` serialisation.
const ORIENTATION_TOKENS = [
  'straight', 'gay', 'lesbian', 'bisexual', 'pansexual',
  'asexual', 'demisexual', 'queer', 'questioning',
];
const VALID_RELATIONSHIP_GOALS = ['', 'long-term', 'friendship', 'open'];
// D-14 — relationship STRUCTURE (DISPLAY ONLY; never wired into candidates.js).
// Separate axis from relationship GOAL above — both coexist. '' = unset.
const VALID_RELATIONSHIP_STRUCTURE = [
  '', 'monogamous', 'open', 'polyamorous', 'queerplatonic', 'figuring-it-out',
];
const VALID_WANTS_CHILDREN = ['', 'yes', 'no', 'open'];
const VALID_FREQUENCY = ['', 'no', 'sometimes', 'yes']; // smoking & drinking
// Differentiator dimensions (autistic-friendly): communication style + sensory
const VALID_COMM_DIRECTNESS = ['', 'direct', 'softened'];
const VALID_COMM_LITERAL = ['', 'literal', 'playful'];
const VALID_COMM_CADENCE = ['', 'instant', 'daily', 'whenever'];
const VALID_SENSORY_ENVIRONMENT = ['', 'quiet', 'lively', 'either'];
const VALID_SENSORY_LIGHTING = ['', 'dim', 'bright', 'either'];
const VALID_SOCIAL_DURATION = ['', 'short', 'medium', 'long'];

// Assemble the OWNER'S full profile payload — the single source of truth for a
// user's own data, shared by GET /profile/me and the data export (export.js) so
// the two can never drift. Returns the object, or null when the user has no
// profile row (the caller decides how to surface that — 404 for /me).
export function assembleOwnProfile(db, userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) return null;

  const interestRows = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?').all(userId);
  const interests = interestRows.map(r => r.interest);

  const dobAge = profile.date_of_birth ? ageFromDob(profile.date_of_birth) : null;

  // At least one profile photo is REQUIRED to be onboarded. onboardingComplete is
  // derived server-side (never a client-set flag), so this is the real, un-
  // bypassable enforcement of the onboarding photo gate: any status counts
  // (a freshly uploaded photo sits in pending_review — the requirement is
  // "uploaded", not "approved"). The app routes a user to onboarding until this
  // is true, so a client can't skip the photo step by faking the flag.
  const photoCount = db.prepare('SELECT COUNT(*) AS c FROM profile_photos WHERE user_id = ?').get(userId).c;

  const onboardingComplete = !!(
    profile.display_name?.trim() &&
    profile.bio?.trim() &&
    interests.length > 0 &&
    profile.date_of_birth &&
    dobAge !== null && dobAge >= 18 &&
    photoCount > 0
  );

  const userRow = db.prepare('SELECT email, email_verified, is_admin FROM users WHERE id = ?').get(userId);

  // E19: profiles.identity_verified is the SINGLE SOURCE OF TRUTH for whether a
  // user is verified. verification_requests only tracks the QUEUE state
  // (pending / rejected) for a user who is NOT yet verified. To prevent the two
  // tables from drifting into a contradictory display (e.g. a verified user who
  // still shows a stale 'pending' request, or a 'rejected' row lingering after a
  // later approval), we short-circuit: if identity_verified is set, there is no
  // open request, full stop — we never even read verification_requests. The
  // `verified` flag below is the authoritative signal; verificationRequested is
  // only meaningful when NOT verified.
  const verificationRequested = profile.identity_verified
    ? null
    : (db.prepare(
        "SELECT status FROM verification_requests WHERE user_id = ? AND status != 'approved'"
      ).get(userId)?.status || null); // 'pending' | 'rejected' | null

  return {
    userId: profile.user_id,
    displayName: profile.display_name,
    tagline: profile.tagline,
    bio: profile.bio,
    commNote: profile.comm_note,
    relationshipGoal: profile.relationship_goal,
    relationshipStructure: profile.relationship_structure || '',
    distCity: profile.dist_city,
    searchRadiusMiles: profile.search_radius_miles ?? 0,
    gender: profile.gender || '',
    genderCustom: profile.gender_custom || '',
    genderGroup: profile.gender_group || '',
    orientation: profile.orientation || '',
    pronouns: profile.pronouns || '',
    seeking: profile.seeking || '',
    prefAgeMin: profile.pref_age_min ?? 18,
    prefAgeMax: profile.pref_age_max ?? 99,
    notificationTier: profile.notification_tier,
    weeklyDigest: !!profile.weekly_digest,
    photoUrl: profile.photo_url || '',
    // Owner viewing their OWN profile: include pending photos (each carries a
    // `pending` flag) so they can see photos still awaiting review (SAFETY-2).
    photos: listPhotos(db, userId, { includePending: true }),
    // Owner viewing their OWN profile: include pending/rejected audio (each
    // carries a `pending` + `reviewStatus` flag) so they can manage clips still
    // awaiting review. A pending clip exposes no public URL (play via
    // /audio/:id/playback-url).
    audio: listOwnAudio(db, userId),
    // G4: honest signal for the radius/distance UI. True iff metros.js can place
    // this user's city on the map (one of the supported metros). When false, the
    // radius filter can't apply, so the frontend shows a calm note instead of
    // letting distance silently no-op.
    locationGeocodable: isGeocodable(profile.dist_city),
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
    // F28 — structured "about me" facets (all optional).
    occupation: profile.occupation || '',
    languages: profile.languages || '',
    helpsMe: parseFacetList(profile.helps_me),
    hardForMe: parseFacetList(profile.hard_for_me),
    specialInterests: parseFacetList(profile.special_interests),
    interests,
    prompts: listPrompts(db, userId),
    onboardingComplete,
    verified: !!profile.identity_verified,
    verificationRequested,
    emailVerified: !!userRow?.email_verified,
    emailVerificationEnabled: emailConfigured(),
    isAdmin: isAdminUser(userRow),
    // Billing tier so the app knows free vs Companion on load (no row = free).
    tier: getEntitlement(db, userId).tier,
  };
}

// GET /profile/me
router.get('/me', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;

  const data = assembleOwnProfile(db, userId);
  if (!data) {
    return res.status(404).json({ error: 'Profile not found.' });
  }

  return res.json(data);
});

// Traveler / at-risk region alert — protective, transient, privacy-preserving.
//
// Looks up the caller's COARSE country from their IP for THIS request only, to
// tell them whether they appear to be somewhere LGBTQ+ people can face legal
// risk (so the client can offer to hide their profile — reusing the existing
// pause mechanism). The IP and country are NEVER stored and NEVER logged: we
// look up, decide `atRisk`, and discard — the same discipline as visitor
// telemetry. This endpoint writes NOTHING (no table, no column, no row). It is
// protective, not tracking. Defined BEFORE `/:userId` so the literal path wins.
router.get('/region-safety', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  // `trust proxy = 1` (src/index.js) yields the real client IP behind Railway's
  // proxy. lookupGeo is offline (geoip-lite) — zero network egress, and it keeps
  // only the country/region ISO codes, never the raw IP.
  const { country } = lookupGeo(req.ip);
  const atRisk = isHostileRegion(country);

  // Trans home-region alert (separate signal from the IP/country one above): is
  // this member trans/gender-diverse AND is their STATED HOME STATE one that has
  // enacted anti-trans law? Based on the member's OWN stored profile (gender +
  // coarse city), computed for and returned to that same member — nothing new is
  // stored or logged. The client shows a calm, optional "hide your profile"
  // prompt when this is true.
  const me = db.prepare('SELECT gender, dist_city FROM profiles WHERE user_id = ?').get(userId);
  const homeStateAtRisk = isTransRiskState(stateFromCity(me?.dist_city));
  const transAtRisk = isTransSpectrumGender(me?.gender) && homeStateAtRisk;

  // homeStateAtRisk is the GENDER-INDEPENDENT state signal (is the member's
  // stated home state one that has enacted anti-trans law?). The client combines
  // it — and the country `atRisk` — with the gender the member is CURRENTLY
  // choosing, to show a calm inline note in the gender section at selection time
  // (the stored-gender transAtRisk above drives the separate load-time banner).
  // Return ONLY these booleans + the member's OWN country code back to that same
  // member. Nothing here is persisted or logged.
  return res.json({ atRisk, country: country || '', transAtRisk, homeStateAtRisk });
});

// POST /profile/verification-request
// Idempotent — submits (or re-submits after rejection) an identity-verification
// request. Rate-limited: max 10 requests per 15 minutes per user (same limiter as
// abuse reports — prevents spam to the moderation queue).
router.post('/verification-request', requireAuth, abuseReportLimiter, (req, res) => {
  const { db, userId } = req.ctx;

  // Check current state
  const profile = db.prepare('SELECT identity_verified FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  if (profile.identity_verified) {
    return res.status(409).json({ error: 'Your identity is already verified.' });
  }

  const existing = db.prepare('SELECT status FROM verification_requests WHERE user_id = ?').get(userId);
  if (existing?.status === 'pending') {
    // Already waiting — idempotent, return success without creating a duplicate.
    return res.json({ ok: true, status: 'pending' });
  }

  // Insert or update (upsert) the request
  db.prepare(`
    INSERT INTO verification_requests (id, user_id, status, requested_at)
    VALUES (?, ?, 'pending', ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at
  `).run(newId(), userId, Date.now());

  res.json({ ok: true, status: 'pending' });
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
    // JRN-1: screen display names for unambiguous slurs/profanity. Calm, non-
    // shaming copy — we don't quote the word back or explain the list.
    else if (containsSlur(body.displayName)) {
      errors.push('Please choose a display name without offensive language.');
    }
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
  if (body.searchRadiusMiles !== undefined) {
    if (!VALID_RADII.includes(body.searchRadiusMiles)) {
      errors.push(`searchRadiusMiles must be one of: ${VALID_RADII.join(', ')} (0 = anywhere).`);
    }
  }
  if (body.gender !== undefined) {
    if (!VALID_GENDERS.includes(body.gender)) {
      errors.push(`gender must be one of: ${VALID_GENDERS.filter(Boolean).join(', ')} (or empty).`);
    }
  }
  // Self-describe free text: capped + slur-screened (same calm, non-shaming copy
  // as display names). Empty string clears it.
  if (body.genderCustom !== undefined) {
    if (typeof body.genderCustom !== 'string') {
      errors.push('genderCustom must be a string.');
    } else if (body.genderCustom.length > MAX_GENDER_CUSTOM) {
      errors.push(`genderCustom must be ${MAX_GENDER_CUSTOM} characters or fewer.`);
    } else if (containsSlur(body.genderCustom)) {
      errors.push('Please describe your gender without offensive language.');
    }
  }
  // D-13 orientation — DISPLAY ONLY. Validated like `seeking`; never affects the deck.
  if (body.orientation !== undefined) {
    if (typeof body.orientation !== 'string') {
      errors.push('orientation must be a comma-separated string.');
    } else {
      const toks = body.orientation.split(',').map(s => s.trim()).filter(Boolean);
      if (!toks.every(t => ORIENTATION_TOKENS.includes(t))) {
        errors.push(`orientation tokens must be from: ${ORIENTATION_TOKENS.join(', ')}.`);
      }
    }
  }
  const validAge = (v) => Number.isInteger(v) && v >= 18 && v <= 99;
  if (body.prefAgeMin !== undefined && !validAge(body.prefAgeMin)) {
    errors.push('prefAgeMin must be an integer between 18 and 99.');
  }
  if (body.prefAgeMax !== undefined && !validAge(body.prefAgeMax)) {
    errors.push('prefAgeMax must be an integer between 18 and 99.');
  }
  // Cross-field range check. When BOTH bounds are sent, compare them directly.
  // When only ONE is sent, compare it against the STORED opposite bound — else a
  // single-field update (e.g. from Discover filters) can silently persist an
  // inverted range (min > max) that empties the deck with no error. Guarded by
  // validAge so we never double-report an already-invalid value.
  if (body.prefAgeMin !== undefined && body.prefAgeMax !== undefined) {
    if (validAge(body.prefAgeMin) && validAge(body.prefAgeMax) && body.prefAgeMin > body.prefAgeMax) {
      errors.push('prefAgeMin cannot be greater than prefAgeMax.');
    }
  } else if (body.prefAgeMin !== undefined && validAge(body.prefAgeMin)) {
    const storedMax = db.prepare('SELECT pref_age_max FROM profiles WHERE user_id = ?').get(userId)?.pref_age_max ?? 99;
    if (body.prefAgeMin > storedMax) {
      errors.push('prefAgeMin cannot be greater than your current maximum age.');
    }
  } else if (body.prefAgeMax !== undefined && validAge(body.prefAgeMax)) {
    const storedMin = db.prepare('SELECT pref_age_min FROM profiles WHERE user_id = ?').get(userId)?.pref_age_min ?? 18;
    if (body.prefAgeMax < storedMin) {
      errors.push('prefAgeMax cannot be less than your current minimum age.');
    }
  }
  if (body.pronouns !== undefined) {
    if (typeof body.pronouns !== 'string') errors.push('pronouns must be a string.');
    else if (body.pronouns.length > 40) errors.push('pronouns must be 40 characters or fewer.');
    // JRN-1: pronouns were the one identity field with NO abuse screen, so a slur
    // or hard profanity as a "pronoun" ("Shit/shat/shart") sailed straight onto a
    // profile. Screen it with the same whole-word gate as displayName/genderCustom.
    else if (containsSlur(body.pronouns)) {
      errors.push('Please choose pronouns without offensive language.');
    }
  }
  if (body.seeking !== undefined) {
    if (typeof body.seeking !== 'string') {
      errors.push('seeking must be a comma-separated string.');
    } else {
      const toks = body.seeking.split(',').map(s => s.trim()).filter(Boolean);
      if (!toks.every(t => SEEKING_TOKENS.includes(t))) {
        errors.push(`seeking tokens must be from: ${SEEKING_TOKENS.join(', ')}.`);
      }
    }
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
  if (body.relationshipStructure !== undefined) {
    if (!VALID_RELATIONSHIP_STRUCTURE.includes(body.relationshipStructure)) {
      errors.push(`relationshipStructure must be one of: ${VALID_RELATIONSHIP_STRUCTURE.map(v => v === '' ? '""' : v).join(', ')}.`);
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
  // F28 facets
  if (body.occupation !== undefined) {
    if (typeof body.occupation !== 'string') errors.push('occupation must be a string.');
    else if (body.occupation.length > MAX_OCCUPATION) errors.push(`occupation must be ${MAX_OCCUPATION} characters or fewer.`);
  }
  if (body.languages !== undefined) {
    if (typeof body.languages !== 'string') errors.push('languages must be a string.');
    else if (body.languages.length > MAX_LANGUAGES) errors.push(`languages must be ${MAX_LANGUAGES} characters or fewer.`);
  }
  if (body.helpsMe !== undefined) validateFacetList(body.helpsMe, 'helpsMe', errors);
  if (body.hardForMe !== undefined) validateFacetList(body.hardForMe, 'hardForMe', errors);
  // D-17 special_interests — DISPLAY + SOFT-SCORE facet. Tighter caps than F28,
  // and each item is slur-screened (it's shown on the profile + deck card).
  if (body.specialInterests !== undefined) {
    validateFacetList(body.specialInterests, 'specialInterests', errors, {
      maxItems: MAX_SPECIAL_INTERESTS,
      maxItemLen: MAX_SPECIAL_INTEREST_LEN,
      screenSlurs: true,
    });
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
    // Age-gate lock (security hardening): once a DOB is on file it CANNOT be
    // self-edited through this shared PUT. A user who could freely rewrite their
    // DOB post-signup could sidestep the 18+ gate; a genuine correction must go
    // through support, not a silent self-edit. Re-submitting the SAME value is a
    // harmless no-op (profile saves legitimately resend it), so we only block an
    // actual change. First-time set (no DOB yet) still works normally below.
    // TODO: add a support-reviewed DOB-correction path if a real need appears.
    const currentDob = db.prepare('SELECT date_of_birth FROM profiles WHERE user_id = ?').get(userId)?.date_of_birth;
    if (currentDob && currentDob !== body.dateOfBirth) {
      return res.status(403).json({ error: 'Your date of birth is already set and can’t be changed here. Please contact support if it needs correcting.' });
    }
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
    relationshipStructure: 'relationship_structure',
    distCity: 'dist_city',
    searchRadiusMiles: 'search_radius_miles',
    gender: 'gender',
    genderCustom: 'gender_custom',
    pronouns: 'pronouns',
    seeking: 'seeking',
    prefAgeMin: 'pref_age_min',
    prefAgeMax: 'pref_age_max',
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
    // F28 short free-text facets (the two list facets are handled separately
    // below because they need JSON serialisation).
    occupation: 'occupation',
    languages: 'languages',
  };

  // Boolean flags stored as 0/1, coerced from any truthy/falsy value.
  const boolFieldMap = {
    dbWantsChildren: 'db_wants_children',
    dbNonSmoker: 'db_non_smoker',
    dbMustBeLocal: 'db_must_be_local',
    // Pause/snooze: 1 hides the user from others' Discover; they keep full app access.
    paused: 'paused',
    // F6 weekly digest opt-in (OFF by default). Only opted-in users are mailed.
    weeklyDigest: 'weekly_digest',
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

  // F28 list facets — serialise array → JSON string ('' when empty). Kept in
  // lock-step with setClauses/values ordering (both arrays grow together).
  if (body.helpsMe !== undefined) {
    setClauses.push('helps_me = ?');
    values.push(serializeFacetList(body.helpsMe));
  }
  if (body.hardForMe !== undefined) {
    setClauses.push('hard_for_me = ?');
    values.push(serializeFacetList(body.hardForMe));
  }
  // D-17 special_interests — same JSON-array serialisation, capped to 3 items.
  if (body.specialInterests !== undefined) {
    setClauses.push('special_interests = ?');
    values.push(serializeFacetList(body.specialInterests, MAX_SPECIAL_INTERESTS));
  }

  // D-12 — whenever gender changes, recompute the stored matchable-core group.
  // This is the ONLY column matching reads, so it MUST stay in lock-step with
  // the expanded `gender` display value.
  if (body.gender !== undefined) {
    setClauses.push('gender_group = ?');
    values.push(genderGroupFor(body.gender));
  }
  // D-13 orientation — normalise to a clean, de-duplicated comma-join of valid
  // tokens (mirrors how we treat `seeking`). Display only.
  if (body.orientation !== undefined) {
    const toks = [...new Set(
      body.orientation.split(',').map(s => s.trim()).filter(t => ORIENTATION_TOKENS.includes(t))
    )];
    setClauses.push('orientation = ?');
    values.push(toks.join(','));
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
    relationshipStructure: profile.relationship_structure || '',
    distCity: profile.dist_city,
    searchRadiusMiles: profile.search_radius_miles ?? 0,
    gender: profile.gender || '',
    genderCustom: profile.gender_custom || '',
    genderGroup: profile.gender_group || '',
    orientation: profile.orientation || '',
    pronouns: profile.pronouns || '',
    seeking: profile.seeking || '',
    prefAgeMin: profile.pref_age_min ?? 18,
    prefAgeMax: profile.pref_age_max ?? 99,
    notificationTier: profile.notification_tier,
    weeklyDigest: !!profile.weekly_digest,
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
    occupation: profile.occupation || '',
    languages: profile.languages || '',
    helpsMe: parseFacetList(profile.helps_me),
    hardForMe: parseFacetList(profile.hard_for_me),
    specialInterests: parseFacetList(profile.special_interests),
    interests: interestRows.map(r => r.interest),
  });
});

// GET /profile/prompt-catalog — the fixed catalog of prompts the frontend offers
// as options. Auth not required: the catalog is public scaffolding, not user data.
router.get('/prompt-catalog', (req, res) => {
  // ALL_PROMPTS = text prompts (type: 'text') + choice prompts (type: 'choice',
  // with their fixed `options`). The frontend renders a textarea for text prompts
  // and a single-select choice control for choice prompts.
  return res.json({ prompts: ALL_PROMPTS });
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
    if (typeof entry.promptKey !== 'string' || !ALL_PROMPT_KEYS.has(entry.promptKey)) {
      return res.status(400).json({ error: 'Each promptKey must be a valid prompt from the catalog.' });
    }
    if (typeof entry.answer !== 'string' || entry.answer.trim() === '') {
      return res.status(400).json({ error: 'Each answer must be a non-empty string.' });
    }
    const promptType = PROMPT_TYPE_BY_KEY.get(entry.promptKey) || 'text';
    if (promptType === 'choice') {
      // A CHOICE answer must be an EXACT match of one of the prompt's defined
      // options — reject anything else. This is what keeps a choice prompt a
      // constrained, calm self-disclosure (not free text, not a fabricated value).
      const options = PROMPT_OPTIONS_BY_KEY.get(entry.promptKey) || [];
      if (!options.includes(entry.answer)) {
        return res.status(400).json({ error: 'Your choice must be one of the options for this prompt.' });
      }
    } else if (entry.answer.length > MAX_PROMPT_ANSWER) {
      // Text answers keep the existing ≤200-char cap.
      return res.status(400).json({ error: `Each answer must be ${MAX_PROMPT_ANSWER} characters or fewer.` });
    }
  }

  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM profile_prompts WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      'INSERT INTO profile_prompts (id, user_id, prompt_key, answer, prompt_type, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    body.prompts.forEach((entry, i) => {
      const promptType = PROMPT_TYPE_BY_KEY.get(entry.promptKey) || 'text';
      insert.run(newId(), userId, entry.promptKey, entry.answer, promptType, i, now);
    });
  })();

  return res.json({ prompts: listPrompts(db, userId) });
});

// GET /profile/:userId — a matched person's PUBLIC profile (read-only). Gated:
// only returns data when the viewer is MATCHED with the target (or it's self).
// Registered last so it never shadows /me, /prompt-catalog, /prompts.
router.get('/:userId', requireAuth, (req, res) => {
  const { db, userId } = req.ctx;
  const targetId = req.params.userId;

  if (targetId !== userId) {
    const matched = db.prepare(
      `SELECT 1 FROM matches
       WHERE ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))
         AND ended_at IS NULL`
    ).get(userId, targetId, targetId, userId);
    if (!matched) {
      return res.status(403).json({ error: 'You can only view the profile of someone you have matched with.' });
    }
    // A block does not end the match row, but it MUST end profile visibility in
    // both directions. Without this a blocked (or blocking) user could still
    // fetch the other person's full profile — photos, audio, coarse city —
    // straight around the block. Uniform 403 (never reveals the block exists).
    const blocked = db.prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    ).get(userId, targetId, targetId, userId);
    if (blocked) {
      return res.status(403).json({ error: 'You can only view the profile of someone you have matched with.' });
    }
  }

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(targetId);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  const interests = db.prepare('SELECT interest FROM user_interests WHERE user_id = ?').all(targetId).map(r => r.interest);
  const age = profile.date_of_birth ? ageFromDob(profile.date_of_birth) : null;
  const distCity = coarseCity(profile.dist_city);

  return res.json({
    userId: profile.user_id,
    displayName: profile.display_name,
    tagline: profile.tagline || '',
    bio: profile.bio || '',
    pronouns: profile.pronouns || '',
    // D-11/D-13 display: expanded gender (+ self-describe text when set) and
    // display-only orientation. gender_group is internal (matching) — never leaked.
    gender: profile.gender || '',
    genderCustom: profile.gender_custom || '',
    orientation: profile.orientation || '',
    age,
    distCity,
    verified: !!profile.identity_verified,
    photoUrl: profile.photo_url || '',
    // PROD-6: approved-only gallery, primary-first (SAFETY-2 approved default).
    photos: listPublicPhotos(db, targetId),
    // Approved-only audio prompt answers (FREE to view + read the transcript;
    // recording is Companion-gated, being seen never is). Same approved-only
    // discipline as photos — pending/rejected clips never surface here.
    audio: listPublicAudio(db, targetId),
    interests,
    relationshipGoal: profile.relationship_goal || '',
    relationshipStructure: profile.relationship_structure || '',
    commNote: profile.comm_note || '',
    commDirectness: profile.comm_directness || '',
    commLiteral: profile.comm_literal || '',
    commCadence: profile.comm_cadence || '',
    sensoryEnvironment: profile.sensory_environment || '',
    sensoryLighting: profile.sensory_lighting || '',
    socialDuration: profile.social_duration || '',
    contextCard: profile.context_card || '', // post-match disclosure — they're matched
    // F28 facets — low-stakes, fine to expose on a matched profile.
    occupation: profile.occupation || '',
    languages: profile.languages || '',
    helpsMe: parseFacetList(profile.helps_me),
    hardForMe: parseFacetList(profile.hard_for_me),
    specialInterests: parseFacetList(profile.special_interests),
    prompts: listPrompts(db, targetId),
  });
});

export default router;
