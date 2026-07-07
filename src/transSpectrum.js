// Frontend mirror of the backend trans/nonbinary umbrella. MUST stay in sync
// with server/src/data/transSafety.js `TRANS_SPECTRUM_GENDERS` — anti-trans law
// (facilities, ID, healthcare) targets the whole gender-diverse umbrella, not
// only binary trans people, so the set is broad on purpose. It maps to the
// DISPLAY `gender` enum. Intentionally EXCLUDES 'woman'/'man', the
// sex-characteristic value 'intersex', and the exploratory 'questioning'.
// If you change this set, change it in BOTH files.
export const TRANS_SPECTRUM_GENDERS = new Set([
  "trans-man", "trans-woman", "nonbinary", "genderfluid",
  "genderqueer", "agender", "bigender", "two-spirit",
]);

// True if a display gender is on the trans/nonbinary umbrella above.
// Anything falsy or unknown is a safe `false` (never over-flag).
export function isTransSpectrumGender(gender) {
  return TRANS_SPECTRUM_GENDERS.has(String(gender || "").trim());
}
