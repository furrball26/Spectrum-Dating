// Message-content screening for the "hide inappropriate messages by default"
// safety feature.
//
// This is NOT a gate — a flagged message is still delivered and stored exactly
// as sent. The flag only tells the CLIENT to render the message COLLAPSED for the
// RECIPIENT ("This message may contain strong or explicit language — tap to
// view"), so nobody is shown slurs / hard profanity / explicit sexual content
// unless they choose to. The recipient can reveal it and report it. The sender
// sees their own message normally (plus a gentle heads-up client-side).
//
// Scope vs nameScreen.js: display names must be false-positive-safe against real
// names, so nameScreen matches WHOLE WORDS only. A chat message is different —
// "you're a fucking creep" should collapse even though "fucking" is a suffixed
// form. So here we STEM-match hard profanity/slurs (word-boundary + optional
// suffix), which a collapsed message can recover from with one tap. We still
// anchor at word boundaries and enumerate suffix-safe stems so clean words
// ("cocktail", "Dickinson", "assassin", "class") never trip it.
//
// Matching is case-insensitive and undoes trivial leetspeak so "f u c k" /
// "n1gg3r" still collapse.

// Undo common leetspeak so obfuscated variants normalize to letters. We keep
// spaces/word boundaries here (unlike nameScreen's full collapse) so the stem
// regexes below can still anchor on \b.
function normalizeLeet(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/\$/g, 's')
    // Collapse single-char letter spacing ("f u c k" -> "fuck") without gluing
    // whole words together: only fuse runs of single letters separated by one
    // space/dot/dash. Applied repeatedly-safe via a global pass.
    .replace(/\b([a-z])[\s.\-_]([a-z])[\s.\-_]([a-z])[\s.\-_]([a-z])\b/g, '$1$2$3$4');
}

// Hard slurs — always inappropriate. Word-boundary anchored with a permissive
// trailing suffix (plurals / -ing / -ot etc.), which is safe because none of
// these stems begins a common clean English word.
const SLUR_RE =
  /\b(?:n[i]gg(?:er|a|ers|as|az)|faggot|faggy|fags?|kikes?|spics?|chinks?|gooks?|wetbacks?|coons?|dykes?|trann(?:y|ies)|retard(?:ed|s)?)\b/i;

// Hard profanity — enumerated so word boundaries + explicit suffix lists keep
// clean words safe (e.g. "cocktail"/"cockpit" never match \bcock\b, "Dickinson"
// never matches \bdick(head|wad|face|s)?\b, "class"/"pass" never match \bass\b).
const PROFANITY_RE =
  /\bfuck\w*|\bmotherfuck\w*|\bshit(?:s|ty|head|hole|bag|ted|ting)?\b|\bbullshit\b|\bbitch(?:es|ing|y|ass)?\b|\bcunts?\b|\bassholes?\b|\bdumbass\w*|\bjackass\w*|\bpuss(?:y|ies)\b|\bcocksuck\w*|\bcock\b|\bdick(?:head|wad|face|s|ish)?\b|\bprick\b|\btwats?\b|\bwankers?\b|\bslut(?:s|ty)?\b|\bwhores?\b/i;

// Explicit sexual content / solicitation — inappropriate especially in a
// first-contact dating message. Kept to overt terms + common solicitation
// phrases, not innocuous words.
const SEXUAL_RE =
  /\b(?:blow\s?jobs?|handjobs?|rimjobs?|cumshots?|creampie|cum(?:ming|med)?\b|jerk(?:ing)?\s+off|jack(?:ing)?\s+off|dick\s?pics?|send\s+(?:me\s+)?nudes?|send\s+(?:me\s+)?pics?|nudes?\b|horny|make\s+you\s+cum|suck\s+(?:my|your)\s+\w+|eat\s+(?:you|your)\s+\w+|fuck\s+(?:you|your|me)|get\s+(?:you\s+)?wet|hard\s+for\s+you|sit\s+on\s+my|tits?\b|titties|boobs?|pussy|anal\b)\b/i;

/**
 * Returns true if the message body should be COLLAPSED for the recipient by
 * default (strong/explicit language). This does NOT block or alter the message.
 * @param {string} text
 * @returns {boolean}
 */
export function classifyInappropriate(text) {
  if (!text || typeof text !== 'string') return false;
  const norm = normalizeLeet(text);
  return SLUR_RE.test(norm) || PROFANITY_RE.test(norm) || SEXUAL_RE.test(norm);
}
