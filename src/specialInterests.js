// D-17 Phase 2 — the structured, MATCHABLE "special interests" field.
//
// These are the chips that LEAD the "Could talk for hours about" merged section
// (chips first, the free-text talk_for_hours prose below). Unlike the casual
// `interests` list, a viewer's OWN special interests are used to highlight the
// shared ones on someone else's card — the soft-score made visible, mirroring
// how InterestPills highlights shared casual interests.
//
// Caps MUST match the backend exactly (PUT /profile/me: ≤3 items, ≤40 chars
// each, slur-screened) so the client never submits what the server rejects.
// This module is pure (no React) so the shared-highlight + normalisation logic
// can be unit-tested under `node --test`.

export const SPECIAL_INTERESTS_MAX = 3;      // max items (server MAX_SPECIAL_INTERESTS)
export const SPECIAL_INTEREST_MAX_LEN = 40;  // per-item char cap (server MAX_SPECIAL_INTEREST_LEN)

// Trim, drop empties, enforce the per-item length cap, dedupe case-insensitively
// (preserving the first-seen casing), and cap the count. Used to clean the save
// payload so it matches what the server would accept — never throws on bad input.
export function normalizeSpecialInterests(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, SPECIAL_INTEREST_MAX_LEN).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= SPECIAL_INTERESTS_MAX) break;
  }
  return out;
}

// Add one raw entry to an existing list, returning a NEW array — or the SAME
// reference (identity-equal) when nothing changed (blank, duplicate, or at cap),
// so callers can cheaply detect a no-op. Casing of the first occurrence wins.
export function addSpecialInterest(items, raw) {
  const list = Array.isArray(items) ? items : [];
  if (list.length >= SPECIAL_INTERESTS_MAX) return items;
  const trimmed = (typeof raw === "string" ? raw : "").trim().slice(0, SPECIAL_INTEREST_MAX_LEN).trim();
  if (!trimmed) return items;
  const key = trimmed.toLowerCase();
  if (list.some((x) => typeof x === "string" && x.trim().toLowerCase() === key)) return items;
  return [...list, trimmed];
}

// The set of THEIR special interests that the VIEWER also lists — compared
// case-insensitively, returning the values in `theirs`' own casing so the chip
// text is unchanged. This is the shared-highlight input, mirroring the
// case-insensitive shared-interest check in SuggestionScreen's InterestPills.
export function sharedSpecialInterests(mine, theirs) {
  const mineSet = new Set(
    (Array.isArray(mine) ? mine : [])
      .filter((s) => typeof s === "string")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return (Array.isArray(theirs) ? theirs : []).filter(
    (s) => typeof s === "string" && s.trim() && mineSet.has(s.trim().toLowerCase())
  );
}
