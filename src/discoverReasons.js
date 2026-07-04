// D-2 — pure "why you fit" reason helpers for the Discover moat, extracted from
// SuggestionScreen so the differentiation logic can be unit-tested in isolation
// (node --test) without a React render. SuggestionScreen imports these; keeping
// them in a plain .js module also avoids a react-refresh boundary warning that
// non-component exports would trigger inside the .jsx.
//
// Behaviour is IDENTICAL to the former in-component definitions — this is a
// lift-and-shift, not a change.

// D-2 — a reason is a TRUE mutual signal only when it's phrased as a shared
// ("You both…" / "You're both…") fact. One-sided context the backend echoes
// from the candidate ("About talking: …", relationship-goal notes) is NOT a
// mutual signal and must not wear the same green ✓ — that dilutes real fit.
export function isMutualReason(reason) {
  return /^(you both|you'?re both)\b/i.test((reason || "").trim());
}

// The backend echoes the candidate's comm_note into whyReasons as an
// `About talking: "…"` line. That exact sentence ALSO has a dedicated, better-
// styled home — the bolded "About talking:" note below the bio — so surfacing
// it in the why-block too rendered the same sentence twice, ~250px apart
// (design-review #1). We strip it from the why list and keep the standalone
// note as its single home.
export function isCommNoteReason(reason) {
  return /^about talking:/i.test((reason || "").trim());
}

// Sort reasons so real mutual signals lead, preserving order within each group.
// Used to pick the strongest 1–2 for the above-the-fold "why you fit" hook.
export function sortReasonsMutualFirst(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  const mutual = list.filter(isMutualReason);
  const other = list.filter((r) => !isMutualReason(r));
  return [...mutual, ...other];
}
