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

  const viewerSet = new Set(viewerInterests);
  const sharedInterests = candidate.interests.filter(i => viewerSet.has(i));

  const sameRelationshipGoal = !!viewerGoal && viewerGoal === candidate.relationship_goal;
  const sameCity = !!viewerCity && viewerCity === candidate.dist_city;

  const score =
    sharedInterests.length * 2 +
    (sameRelationshipGoal ? 3 : 0) +
    (sameCity ? 2 : 0);

  const whyReasons = buildWhyReasons(sharedInterests, candidate, { sameRelationshipGoal, sameCity });

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
