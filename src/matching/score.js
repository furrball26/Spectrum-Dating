// Scores a candidate against the viewer.
// Returns { score, sharedInterests, whyReasons }.
// Weighted score:
//   sharedInterests.length * 2  (interests weighted higher)
//   + (sameRelationshipGoal ? 3 : 0)  (goal alignment bonus)
//   + (sameCity ? 2 : 0)              (proximity bonus)
// Tie-break by candidate's updated_at (recency) in candidates.js.

export function scoreCandidate(viewer, candidate) {
  // Back-compat: callers may pass an array of interests, or a viewer object.
  const viewerInterests = Array.isArray(viewer) ? viewer : (viewer?.interests ?? []);
  const viewerGoal = Array.isArray(viewer) ? '' : (viewer?.relationship_goal ?? '');
  const viewerCity = Array.isArray(viewer) ? '' : (viewer?.dist_city ?? '');
  const viewerSensory = Array.isArray(viewer) ? '' : (viewer?.sensory_environment ?? '');
  const viewerCadence = Array.isArray(viewer) ? '' : (viewer?.comm_cadence ?? '');

  const viewerSet = new Set(viewerInterests);
  const sharedInterests = candidate.interests.filter(i => viewerSet.has(i));

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

  const score =
    sharedInterests.length * 2 +
    (sameRelationshipGoal ? 3 : 0) +
    (sameCity ? 2 : 0) +
    (sameSensory ? 2 : 0) +
    (sameCadence ? 2 : 0);

  const whyReasons = buildWhyReasons(sharedInterests, candidate, { sameRelationshipGoal, sameCity, sameSensory, sameCadence });

  return { score, sharedInterests, whyReasons };
}

function buildWhyReasons(sharedInterests, candidate, opts = {}) {
  const reasons = [];
  if (sharedInterests.length > 0) {
    reasons.push(`You both enjoy ${listify(sharedInterests.slice(0, 3))}`);
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
