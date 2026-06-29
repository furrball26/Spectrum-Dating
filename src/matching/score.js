// Scores a candidate against the viewer.
// Returns { score, sharedInterests, whyReasons }.
// Score = number of shared interests. Tie-break by candidate's updated_at (recency).

export function scoreCandidate(viewerInterests, candidate) {
  const viewerSet = new Set(viewerInterests);
  const sharedInterests = candidate.interests.filter(i => viewerSet.has(i));
  const score = sharedInterests.length;

  const whyReasons = buildWhyReasons(sharedInterests, candidate);

  return { score, sharedInterests, whyReasons };
}

function buildWhyReasons(sharedInterests, candidate) {
  const reasons = [];
  if (sharedInterests.length > 0) {
    reasons.push(`You both enjoy ${listify(sharedInterests.slice(0, 3))}`);
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
