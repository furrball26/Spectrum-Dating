// JRN-1 — display-name abuse screening.
//
// A deliberately CONSERVATIVE word-list of unambiguous slurs / hard profanity.
// The goal is to stop an obviously abusive display name (a slur as a name) at
// save time and to keep any already-offending name off Discover — NOT to police
// language broadly. False positives on real names are worse than a missed edge
// case here (there are always human reports + moderation for the rest), so the
// list stays short and unambiguous, and we match on WHOLE WORDS only (so
// "Scunthorpe"-style substrings inside legitimate names never trip it).
//
// Matching is case-insensitive and ignores common leetspeak substitutions
// (a→@/4, i→1/!, o→0, e→3, s→$/5) plus separators between letters, so trivial
// obfuscation ("n1gg3r", "f.a.g") is still caught. Kept intentionally small.

const BLOCKLIST = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'tranny',
  'kike', 'spic', 'chink', 'wetback', 'coon', 'gook', 'dyke',
  'cunt', 'whore', 'slut', 'rapist', 'pedophile', 'pedo', 'molester',
];

// Normalize a candidate token: lowercase, undo leetspeak, drop non-letters.
function deleet(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/[^a-z]/g, ''); // strip separators/punct so "f.a.g" -> "fag"
}

// Build a normalized set once.
const NORMALIZED_BLOCK = new Set(BLOCKLIST.map(deleet));

// Returns true if `name` contains a blocked slur/profanity as a whole word.
// We split on any non-letter/leet boundary, normalize each token, and also test
// the fully-collapsed string so spaced-out obfuscation ("n i g g e r") is caught.
export function containsSlur(name) {
  const raw = String(name || '');
  if (!raw.trim()) return false;

  // Token-level check (whole words) — avoids substring false positives.
  const tokens = raw.split(/[^0-9a-zA-Z@!|$]+/).filter(Boolean);
  for (const tok of tokens) {
    if (NORMALIZED_BLOCK.has(deleet(tok))) return true;
  }

  // Collapsed check — catches letter-by-letter spacing ("f a g g o t").
  const collapsed = deleet(raw);
  for (const bad of NORMALIZED_BLOCK) {
    // whole-string match only (collapsed === bad) OR bad surrounded by the
    // collapsed string is too aggressive (substring), so require exact equality
    // of the collapsed form to a blocked term.
    if (collapsed === bad) return true;
  }

  return false;
}

// Convenience inverse used by callers that read as "is this name allowed?".
export function isNameAllowed(name) {
  return !containsSlur(name);
}
