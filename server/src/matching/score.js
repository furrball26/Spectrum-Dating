// Scores a candidate against the viewer.
// Returns { score, sharedInterests, sharedSpecialInterests, whyReasons }.
// Weighted score:
//   sharedInterests.length * 2         (generic interests weighted higher)
//   + sharedSpecialInterests.length * 3 (D-17: deep-interest overlap IS the moat)
//   + (sameRelationshipGoal ? 3 : 0)   (goal alignment bonus)
//   + (sameCity ? 2 : 0)               (proximity bonus)
// Tie-break by candidate's updated_at (recency) in candidates.js.
//
// SOFT-SCORE ONLY: special_interests reorders the deck; it NEVER excludes anyone.
// A candidate with ZERO shared special interests still scores (just lower) and is
// still returned by candidates.js — the filter there never reads this field.

// D-17 — special_interests is stored as JSON-array text ('' or '["…"]'), the same
// facet shape as F28. Parse tolerantly (never throw; always return string[]).
function parseSpecialInterests(str) {
  if (!str || typeof str !== 'string') return [];
  try {
    const arr = JSON.parse(str);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function scoreCandidate(viewer, candidate) {
  // Back-compat: callers may pass an array of interests, or a viewer object.
  const viewerInterests = Array.isArray(viewer) ? viewer : (viewer?.interests ?? []);
  const viewerGoal = Array.isArray(viewer) ? '' : (viewer?.relationship_goal ?? '');
  const viewerCity = Array.isArray(viewer) ? '' : (viewer?.dist_city ?? '');
  const viewerSensory = Array.isArray(viewer) ? '' : (viewer?.sensory_environment ?? '');
  const viewerCadence = Array.isArray(viewer) ? '' : (viewer?.comm_cadence ?? '');
  const viewerDirectness = Array.isArray(viewer) ? '' : (viewer?.comm_directness ?? '');
  const viewerLiteral = Array.isArray(viewer) ? '' : (viewer?.comm_literal ?? '');
  const viewerLighting = Array.isArray(viewer) ? '' : (viewer?.sensory_lighting ?? '');
  const viewerSocialDuration = Array.isArray(viewer) ? '' : (viewer?.social_duration ?? '');

  const viewerSet = new Set(viewerInterests);
  const sharedInterests = candidate.interests.filter(i => viewerSet.has(i));

  // D-17 special interests — case-insensitive overlap. Candidate casing is kept
  // for display in the why-reason. Empty on either side → no overlap, no bonus.
  const viewerSpecial = Array.isArray(viewer) ? [] : parseSpecialInterests(viewer?.special_interests);
  const viewerSpecialSet = new Set(viewerSpecial.map(s => s.trim().toLowerCase()));
  const sharedSpecialInterests = parseSpecialInterests(candidate.special_interests)
    .filter(s => viewerSpecialSet.has(s.trim().toLowerCase()));

  const sameRelationshipGoal = !!viewerGoal && viewerGoal === candidate.relationship_goal;
  const normCity = (s) => (s || '').trim().toLowerCase();
  const sameCity = normCity(viewerCity) !== '' && normCity(viewerCity) === normCity(candidate.dist_city);

  // Differentiator nudges: only EXACT, non-empty, non-'either' matches count.
  const sameSensory =
    viewerSensory !== '' && viewerSensory !== 'either' &&
    viewerSensory === candidate.sensory_environment;
  const sameCadence =
    viewerCadence !== '' && viewerCadence !== 'either' &&
    viewerCadence === candidate.comm_cadence;
  const sameDirectness =
    viewerDirectness !== '' && viewerDirectness !== 'either' &&
    viewerDirectness === candidate.comm_directness;
  const sameLiteral =
    viewerLiteral !== '' && viewerLiteral !== 'either' &&
    viewerLiteral === candidate.comm_literal;
  const sameLighting =
    viewerLighting !== '' && viewerLighting !== 'either' &&
    viewerLighting === candidate.sensory_lighting;
  const sameSocialDuration =
    viewerSocialDuration !== '' && viewerSocialDuration !== 'either' &&
    viewerSocialDuration === candidate.social_duration;

  const score =
    sharedInterests.length * 2 +
    sharedSpecialInterests.length * 3 +
    (sameRelationshipGoal ? 3 : 0) +
    (sameCity ? 2 : 0) +
    (sameSensory ? 2 : 0) +
    (sameCadence ? 2 : 0) +
    (sameDirectness ? 2 : 0) +
    (sameLiteral ? 2 : 0) +
    (sameLighting ? 2 : 0) +
    (sameSocialDuration ? 2 : 0);

  const whyReasons = buildWhyReasons(sharedInterests, candidate, {
    sameRelationshipGoal, sameCity, sameSensory, sameCadence,
    sameDirectness, sameLiteral, sameLighting, sameSocialDuration,
    sharedSpecialInterests,
  });

  return { score, sharedInterests, sharedSpecialInterests, whyReasons };
}

function buildWhyReasons(sharedInterests, candidate, opts = {}) {
  const reasons = [];
  if (sharedInterests.length > 0) {
    reasons.push(`You both enjoy ${listify(sharedInterests.slice(0, 3))}`);
  }
  // D-17 — a shared deep interest is the strongest hook; lead with the first one.
  if (opts.sharedSpecialInterests && opts.sharedSpecialInterests.length > 0) {
    reasons.push(`You could both talk for hours about ${opts.sharedSpecialInterests[0]}`);
  }
  if (opts.sameCity && candidate.dist_city) {
    reasons.push(`You're both in ${candidate.dist_city}`);
  }
  if (opts.sameSensory) {
    const envMap = { quiet: 'quiet settings', lively: 'lively settings' };
    const env = envMap[candidate.sensory_environment];
    if (env) reasons.push(`You both prefer ${env}`);
  }
  if (opts.sameCadence) {
    const cadenceMap = {
      instant: 'You both like to message back and forth quickly',
      daily: 'You both like to check in about once a day',
      whenever: 'You both like to message whenever it suits',
    };
    const c = cadenceMap[candidate.comm_cadence];
    if (c) reasons.push(c);
  }
  if (opts.sameDirectness) {
    const directnessMap = {
      direct: 'You both prefer direct communication',
      softened: 'You both prefer a gentler, softened tone',
    };
    const d = directnessMap[candidate.comm_directness];
    if (d) reasons.push(d);
  }
  if (opts.sameLiteral) {
    const literalMap = {
      literal: 'You both take language literally',
      playful: 'You both enjoy playful, figurative language',
    };
    const l = literalMap[candidate.comm_literal];
    if (l) reasons.push(l);
  }
  if (opts.sameLighting) {
    const lightingMap = {
      dim: 'You both like dim lighting',
      bright: 'You both like bright lighting',
    };
    const lg = lightingMap[candidate.sensory_lighting];
    if (lg) reasons.push(lg);
  }
  if (opts.sameSocialDuration) {
    const durationMap = {
      short: 'You both prefer shorter get-togethers',
      long: 'You both enjoy longer get-togethers',
    };
    const sd = durationMap[candidate.social_duration];
    if (sd) reasons.push(sd);
  }
  if (candidate.comm_note) {
    reasons.push(`About talking: "${candidate.comm_note}"`);
  }
  if (candidate.relationship_goal) {
    const goalMap = {
      'long-term': 'Looking for something long-term',
      'friendship': 'Open to friendship first',
      'open': 'Open to whatever feels right',
    };
    if (goalMap[candidate.relationship_goal]) reasons.push(goalMap[candidate.relationship_goal]);
  }
  return reasons;
}

function listify(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
}
