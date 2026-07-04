// Deeper compatibility filters — the second Companion-gated feature
// (audit/MONETIZATION_STRATEGY.md §5 #3).
//
// DESIGN LAW (do not weaken):
//   • Base filters (age/distance/seeking) stay FREE and are handled elsewhere —
//     this module ONLY ever ADDS a soft re-rank on top of the already-scored deck.
//   • Advanced prefs are POST-SCORE REFINEMENTS, never a hard wall. applyRerank
//     boosts a candidate's effective ordering when they match the member's
//     preferred comm/sensory facets (and, if the toggle is on, when they share a
//     special interest). It NEVER drops a candidate, so a filter can never empty
//     the deck (the E20 scaling concern — a 0-card deck is a bug).
//   • Companion-gated: the CALLER (route) decides whether to pass filters in; a
//     free/non-Companion viewer's deck is left byte-identical (filters === null).
//
// The stored JSON shape is a small object with camelCase keys (aligned with the
// card/API convention), validated against a strict allowlist. Unknown keys are
// stripped; a KNOWN key with an out-of-allowlist value is REJECTED (→ 400 on PUT).

// Preferred-facet keys → the candidate column they compare against + the allowed
// values. Values mirror the score.js facet maps exactly, so the re-rank and the
// base scoring speak the same vocabulary.
export const ADVANCED_FACETS = {
  commDirectness: { col: 'comm_directness', values: ['direct', 'softened'] },
  commLiteral: { col: 'comm_literal', values: ['literal', 'playful'] },
  commCadence: { col: 'comm_cadence', values: ['instant', 'daily', 'whenever'] },
  sensoryEnvironment: { col: 'sensory_environment', values: ['quiet', 'lively'] },
  sensoryLighting: { col: 'sensory_lighting', values: ['dim', 'bright'] },
};

// A boolean toggle (not a facet): "prioritize people who share my special
// interests". When true, candidates with ≥1 shared special interest get boosted.
export const PRIORITIZE_SHARED_INTERESTS_KEY = 'prioritizeSharedInterests';

// Per matched preference, how much to add to a candidate's effective ordering
// score. A soft nudge — comparable to the base scoring's per-facet weight (2) but
// a bit stronger so an explicit preference reliably floats matching people up,
// WITHOUT ever changing which candidates are present.
const BOOST_PER_MATCH = 5;

// Validate + normalize an incoming/stored value into a clean filter object.
//   • Accepts an object OR a JSON string ('' → {} ; unparseable → null).
//   • Returns the cleaned object on success.
//   • Returns null when the input is structurally invalid (not an object) OR a
//     KNOWN facet carries a value outside its allowlist / the toggle is non-bool.
//   • Unknown keys are ignored. A false toggle is dropped (kept minimal).
export function validateAdvancedFilters(input) {
  if (input === null || input === undefined) return {};
  let obj = input;
  if (typeof input === 'string') {
    if (input.trim() === '') return {};
    try {
      obj = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) return null;

  const clean = {};
  for (const [key, spec] of Object.entries(ADVANCED_FACETS)) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (typeof v !== 'string' || !spec.values.includes(v)) return null; // bad value → reject
    clean[key] = v;
  }
  if (PRIORITIZE_SHARED_INTERESTS_KEY in obj) {
    const v = obj[PRIORITIZE_SHARED_INTERESTS_KEY];
    if (typeof v !== 'boolean') return null;
    if (v) clean[PRIORITIZE_SHARED_INTERESTS_KEY] = true;
  }
  return clean;
}

// Parse a STORED column value into a clean object, tolerating corruption. Unlike
// validateAdvancedFilters this never returns null — a bad stored value degrades
// to "no preferences" (the deck is simply un-re-ranked) rather than throwing.
export function parseStoredAdvancedFilters(str) {
  const clean = validateAdvancedFilters(str);
  return clean === null ? {} : clean;
}

// Does this cleaned object carry any active preference?
export function hasAdvancedFilters(filters) {
  return !!filters && Object.keys(filters).length > 0;
}

// POST-SCORE re-rank. Mutates each candidate to attach `advancedBoost` (for
// transparency / greppable behavior) and re-sorts the array in place by the
// EFFECTIVE score (base score + boost), keeping the base recency tie-break. The
// honest `score` field is left untouched. Count is preserved — nobody is dropped,
// so the deck can never be emptied here. Returns the same array for chaining.
export function applyAdvancedRerank(scored, filters) {
  if (!hasAdvancedFilters(filters)) return scored;
  const prioritize = filters[PRIORITIZE_SHARED_INTERESTS_KEY] === true;

  for (const c of scored) {
    let boost = 0;
    for (const [key, spec] of Object.entries(ADVANCED_FACETS)) {
      const want = filters[key];
      if (want && c[spec.col] === want) boost += BOOST_PER_MATCH;
    }
    if (prioritize && Array.isArray(c.sharedSpecialInterests) && c.sharedSpecialInterests.length > 0) {
      boost += BOOST_PER_MATCH;
    }
    c.advancedBoost = boost;
  }

  scored.sort(
    (a, b) =>
      (b.score + (b.advancedBoost || 0)) - (a.score + (a.advancedBoost || 0)) ||
      b.updated_at - a.updated_at
  );
  return scored;
}
