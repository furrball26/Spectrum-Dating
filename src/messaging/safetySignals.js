// F26 — client-side, best-effort safety-signal detection for in-chat friction.
//
// This is a HEURISTIC helper only. It NEVER blocks, hides, redacts, or alters a
// message — the sole output is a boolean used to surface ONE calm, informational
// note per conversation. False positives are harmless by design (they just show
// a gentle reminder), so the patterns lean broad and forgiving.
//
// Two signal families are detected, case-insensitively, in EITHER person's text
// (protecting the user whether they're receiving a scammy ask or about to
// overshare their own contact details):
//   1. Off-platform contact — URLs, emails, phone numbers, and the names of
//      common external messaging / social apps, plus "add/text/message me"-style
//      handoff phrases.
//   2. Money / scam — money-transfer apps, crypto, gift cards, and "send money"
//      / "help me out"-style asks.

// --- Off-platform contact ---------------------------------------------------

// URLs: http(s):// or bare www. or a domain-like token with a common TLD.
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|app|link|xyz|info|biz|gg)\b/i;

// Email addresses.
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

// Phone numbers: 7+ digits allowing spaces, dashes, dots, parens, and an
// optional leading +country code. Kept deliberately loose but requires enough
// digits to avoid matching short numbers like ages or "24/7".
const PHONE_RE =
  /(?:\+?\d[\s().-]?){7,}\d/;

// External app / platform names and social handoffs.
const OFF_PLATFORM_APP_RE =
  /\b(?:whats\s?app|telegram|signal|instagram|insta|snapchat|snap\s?chat|snap|kik|discord|wechat|viber|line\s?app|messenger|facebook|fb\s?messenger|tiktok|onlyfans|skype)\b/i;

// "add me on…", "text me at…", "hit me up on…", "dm me on…", "message me on…",
// "reach me at…", "my number is…", "my handle is…", "find me on…".
const HANDOFF_RE =
  /\b(?:add|text|message|msg|dm|hit|reach|call|find|contact)\s+me\b|\bmy\s+(?:number|handle|username|user\s?name|snap|insta|kik|cell|digits|@)\b|\bmove\s+(?:this|the\s+chat|to)\b|\bget\s+off\s+(?:this\s+)?app\b/i;

// --- Money / scam -----------------------------------------------------------

const MONEY_APP_RE =
  /\b(?:venmo|cash\s?app|\$cashtag|zelle|paypal|pay\s?pal|western\s?union|money\s?gram|revolut|wise|apple\s?pay|google\s?pay|g\s?pay)\b/i;

const CRYPTO_RE =
  /\b(?:bitcoin|btc|ethereum|eth|crypto(?:currency)?|usdt|tether|binance|coinbase|wallet\s+address|seed\s+phrase|blockchain|nft)\b/i;

const MONEY_ASK_RE =
  /\b(?:gift\s?cards?|wire(?:\s+transfer|\s+money|\s+the)?|send\s+(?:me\s+)?money|send\s+(?:me\s+)?\$|help\s+me\s+out|need\s+(?:some\s+)?(?:money|cash|help\s+with\s+money)|loan\s+me|lend\s+me|western\s+union|invest(?:ment)?\s+(?:opportunity|with\s+me)|steam\s+card)\b/i;

const CONTACT_PATTERNS = [URL_RE, EMAIL_RE, PHONE_RE, OFF_PLATFORM_APP_RE, HANDOFF_RE];
const MONEY_PATTERNS = [MONEY_APP_RE, CRYPTO_RE, MONEY_ASK_RE];

/**
 * Best-effort scan of a single message body for a grooming/scam risk signal.
 * Returns true if ANY off-platform-contact or money/scam pattern matches.
 * Informational only — the caller must never block or alter the message.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasSafetySignal(text) {
  if (!text || typeof text !== "string") return false;
  return (
    CONTACT_PATTERNS.some((re) => re.test(text)) ||
    MONEY_PATTERNS.some((re) => re.test(text))
  );
}

/**
 * Needed #6 (sender pre-send nudge) — should we show the calm "Are you sure?"
 * nudge before sending `text`?
 *
 * Pure and side-effect-free so it can be unit-tested in isolation. Returns true
 * only when the (trimmed) body trips a safety signal AND it isn't the exact text
 * the user has already confirmed via "Send anyway" — so the gentle nudge appears
 * at most ONCE per composed message. The caller holds the confirmed text (in a
 * ref) and passes it here; editing the text after confirming re-arms the nudge.
 *
 * This NEVER blocks — it only decides whether to surface a dismissible prompt.
 *
 * @param {string} text            the message body about to be sent
 * @param {string|null} confirmedText  text the user already confirmed, if any
 * @returns {boolean}
 */
export function shouldNudgeBeforeSend(text, confirmedText) {
  if (typeof text !== "string") return false;
  const body = text.trim();
  if (!body) return false;
  if (confirmedText != null && confirmedText === body) return false;
  return hasSafetySignal(body);
}
