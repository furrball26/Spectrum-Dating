// Trans home-region alert — a SAFETY tool, not a judgement of any place or its
// people. It powers a calm, optional "you may want to hide your profile" prompt
// for trans and gender-diverse members whose STATED HOME STATE has enacted laws
// that restrict trans people's rights. The parallel to hostileRegions.js is
// deliberate: that file flags COUNTRIES that criminalise same-sex intimacy (a
// legal fact); this one flags US STATES that have enacted anti-trans law (also a
// legal fact) — neither is a claim about a community's warmth.
//
// SOURCE / RATIONALE
// ------------------
// Membership is scoped to a concrete, verifiable legal criterion rather than a
// vibe: states that have ENACTED a ban or major restriction on gender-affirming
// care and/or trans people's use of facilities / accurate ID. Compiled from the
// regularly-updated trackers most cited for this:
//   • Movement Advancement Project — "Equality Maps" (gender-identity policy
//     tallies). https://www.mapresearch.org/equality-maps
//   • Trans Legislation Tracker. https://translegislation.com
//   • ACLU — "Mapping Attacks on LGBTQ Rights". https://www.aclu.org/legislative-attacks-on-lgbtq-rights
// This snapshot reflects those sources as of 2024-06 and is intentionally
// CONSERVATIVE — clear, enacted statewide restrictions only, not merely proposed
// bills or narrow/enjoined measures.
//
// ⚠️ THIS IS NOT LEGAL ADVICE, and the landscape changes often IN BOTH
// DIRECTIONS (laws pass; courts enjoin; states repeal). This literal is the ONE
// place the set lives and it is meant to be REVIEWED AND OWNED BY THE CLIENT —
// update it here as the sources above change. Removing a state is as important
// as adding one, so we never wrongly flag a place.
export const US_TRANS_RISK_STATES = new Set([
  'AL', // Alabama
  'AR', // Arkansas
  'FL', // Florida
  'GA', // Georgia
  'ID', // Idaho
  'IN', // Indiana
  'IA', // Iowa
  'KY', // Kentucky
  'LA', // Louisiana
  'MS', // Mississippi
  'MO', // Missouri
  'MT', // Montana
  'NE', // Nebraska
  'ND', // North Dakota
  'OH', // Ohio
  'OK', // Oklahoma
  'SC', // South Carolina
  'SD', // South Dakota
  'TN', // Tennessee
  'TX', // Texas
  'UT', // Utah
  'WV', // West Virginia
  'WY', // Wyoming
]);

// True if a 2-letter state code is in the flagged set. Input is normalised to
// uppercase; anything falsy or unknown is a safe `false` (never over-flag).
export function isTransRiskState(state) {
  return US_TRANS_RISK_STATES.has(String(state || '').toUpperCase());
}

// The trans + nonbinary umbrella this alert covers. Anti-trans law (facilities,
// ID, healthcare) targets the whole gender-diverse umbrella, not only binary
// trans people, so the set is broad on purpose. It maps to the DISPLAY `gender`
// enum in profile.js (VALID_GENDERS). Intentionally EXCLUDES 'woman'/'man' and
// the sex-characteristic value 'intersex' and the exploratory 'questioning'.
// Adjust here if the client wants a narrower or wider trigger.
export const TRANS_SPECTRUM_GENDERS = new Set([
  'trans-man', 'trans-woman', 'nonbinary', 'genderfluid',
  'genderqueer', 'agender', 'bigender', 'two-spirit',
]);

// True if a (validated) display gender is on the trans/nonbinary umbrella above.
export function isTransSpectrumGender(gender) {
  return TRANS_SPECTRUM_GENDERS.has(String(gender || '').trim());
}
