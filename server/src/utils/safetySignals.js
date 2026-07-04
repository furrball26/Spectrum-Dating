// Server-side safety-signal screening for message-request INTROS.
//
// This is a SECURITY GATE (not the client's informational-only in-chat hint).
// The client copy (src/messaging/safetySignals.js) can't be trusted for a gate,
// so the same regex families are ported here and run on the server. An intro
// that trips a signal is REFUSED — unsolicited off-platform-contact / money asks
// are the #1 grooming/scam opener, and a first-contact message is where that
// bar must be STRICTER than in an already-consented conversation.
//
// Two signal families are detected, case-insensitively:
//   1. Off-platform contact — URLs, emails, phone numbers, external messaging /
//      social app names, and "add/text/message me"-style handoff phrases.
//   2. Money / scam — money-transfer apps, crypto, gift cards, "send money" /
//      "help me out"-style asks.

// --- Off-platform contact ---------------------------------------------------

// URLs: http(s):// or bare www. or a domain-like token with a common TLD.
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|app|link|xyz|info|biz|gg)\b/i;

// Email addresses.
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

// Phone numbers: 7+ digits allowing spaces, dashes, dots, parens, and an
// optional leading +country code.
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}\d/;

// External app / platform names and social handoffs.
const OFF_PLATFORM_APP_RE =
  /\b(?:whats\s?app|telegram|signal|instagram|insta|snapchat|snap\s?chat|snap|kik|discord|wechat|viber|line\s?app|messenger|facebook|fb\s?messenger|tiktok|onlyfans|skype)\b/i;

// "add me on…", "text me at…", "hit me up on…", "dm me on…", "my number is…", etc.
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
 * Returns true if the text trips ANY off-platform-contact or money/scam pattern.
 * @param {string} text
 * @returns {boolean}
 */
export function hasSafetySignal(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    CONTACT_PATTERNS.some((re) => re.test(text)) ||
    MONEY_PATTERNS.some((re) => re.test(text))
  );
}
