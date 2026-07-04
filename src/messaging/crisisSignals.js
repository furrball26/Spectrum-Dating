// Crisis-line auto-routing — client-side, best-effort detection of self-harm /
// suicidal-crisis language in a chat message.
//
// This detector exists ONLY to gently surface the crisis resources we already
// publish (988 Suicide & Crisis Lifeline, Crisis Text Line) to the person who
// expressed distress — privately, calmly, once. It is NOT moderation: it never
// blocks, alters, hides, reports, or logs a message, and nothing is ever shown
// to the other person.
//
// Design bias: FALSE NEGATIVES over false positives. An intrusive false alarm on
// a vulnerable user is worse than a quiet miss, so the phrase list is kept TIGHT
// and anchored to high-confidence, multi-word self-harm / suicidal-intent
// wording. Common hyperbole ("this traffic is killing me", "I'd die for pizza",
// "dying laughing", "you're killing me", "career suicide") must NOT trip it —
// hence the patterns anchor on "myself"/"my life"/"to die" etc. rather than the
// bare verb.
//
// Kept deliberately separate from safetySignals.js (scam / off-platform nudge):
// different detector, and a supportive — not cautionary — response.

// Each pattern is a high-confidence self-harm / suicidal-intent phrase. Flexible
// whitespace (\s+) and optional apostrophes tolerate real chat typing. Word
// boundaries keep them from firing inside unrelated words ("diet", "dye").
const CRISIS_PATTERNS = [
  // "kill myself", "killing myself", "kill my self", "want to kill myself".
  // NOT "you're killing me" / "this is killing me" (requires my(self)).
  /\bkill(?:ing)?\s+my\s?self\b/,

  // "want to die", "wanna die", "want die". NOT "die for pizza", "dying laughing"
  // (no "dying" pattern, and "want to" is required). \bdie\b won't match "diet".
  /\bwan(?:t|na)\s+(?:to\s+)?die\b/,
  // "want to be dead", "wanna be dead".
  /\bwan(?:t|na)\s+(?:to\s+)?be\s+dead\b/,

  // "don't want to be here anymore", "don't want to be alive", "don't want to
  // live", "don't wanna live", "don't want to wake up". "to" is optional so
  // "don't wanna live" matches.
  /\b(?:don'?t|do\s+not|dont)\s+wan(?:t\s+to|na)\s+(?:be\s+(?:here|alive)|live|exist|wake\s+up)\b/,

  // "end my life", "ending my life", "end my own life", "end this life".
  /\bend(?:ing)?\s+(?:my|my\s+own|this)\s+life\b/,
  // "end it all", "ending it all".
  /\bend(?:ing)?\s+it\s+all\b/,
  // "take my life", "take my own life", "taking my own life".
  /\btak(?:e|ing)\s+my\s+(?:own\s+)?life\b/,

  // "hurt myself", "hurting myself", "harm myself", "harming myself",
  // "cut myself", "cutting myself".
  /\b(?:hurt|hurting|harm|harming|cut|cutting)\s+my\s?self\b/,
  // "self-harm", "self harm", "selfharm" (+ -ing / -ed).
  /\bself[\s-]?harm(?:ing|ed)?\b/,

  // "suicidal" (e.g. "feeling suicidal", "suicidal thoughts"). Bare "suicide" is
  // intentionally excluded to avoid "career/political/social suicide" and titles.
  /\bsuicidal\b/,
  // "commit suicide", "committing suicide", "thinking about suicide",
  // "thoughts of suicide", "contemplating suicide".
  /\b(?:commit(?:ting|ted)?|contemplating|thinking\s+(?:about|of)|thoughts?\s+of)\s+suicide\b/,

  // "no reason to live", "no reason to be here", "no reason to go on".
  /\bno\s+reason\s+to\s+(?:live|be\s+here|go\s+on|keep\s+going)\b/,
  // "nothing to live for", "nothing left to live for".
  /\bnothing\s+(?:left\s+)?to\s+live\s+for\b/,
  // "no point in living", "no point being alive", "no point going on".
  /\bno\s+point\s+(?:in\s+)?(?:living|being\s+alive|going\s+on)\b/,

  // "better off dead", "better off without me".
  /\bbetter\s+off\s+(?:dead|without\s+me)\b/,
];

/**
 * Best-effort scan of a single message body for a HIGH-CONFIDENCE self-harm /
 * suicidal-crisis signal. Returns true only when the (trimmed, normalized) text
 * matches one of the anchored crisis phrases above.
 *
 * Conservative by design (favors false negatives). Trims, tolerates non-string
 * input, and never throws — the caller uses the boolean only to offer support.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasCrisisSignal(text) {
  if (typeof text !== "string") return false;
  // Lowercase, normalize curly apostrophes to straight, and collapse runs of
  // whitespace so multi-word phrases match across line breaks / double spaces.
  const body = text
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
  if (!body) return false;
  return CRISIS_PATTERNS.some((re) => re.test(body));
}
