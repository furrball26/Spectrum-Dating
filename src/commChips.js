// Shared mapping from a matched person's comms/sensory/social preference fields
// to short, plain-language chips. Used by MatchProfileModal (their profile view)
// and the "What to expect" card in the conversation view, so the two stay
// consistent. Keep the mapping identical in both places — edit here only.
export function commChips(p) {
  const c = [];
  if (!p) return c;
  if (p.commDirectness === "direct") c.push("Direct");
  if (p.commDirectness === "softened") c.push("Softened");
  if (p.commLiteral === "literal") c.push("Literal");
  if (p.commLiteral === "playful") c.push("Playful");
  if (p.commCadence === "instant") c.push("Quick replies");
  if (p.commCadence === "daily") c.push("Replies once a day");
  if (p.sensoryEnvironment === "quiet") c.push("Quiet settings");
  if (p.sensoryEnvironment === "lively") c.push("Lively settings");
  if (p.sensoryLighting === "dim") c.push("Dim lighting");
  if (p.sensoryLighting === "bright") c.push("Bright lighting");
  if (p.socialDuration === "short") c.push("Short meetups");
  if (p.socialDuration === "long") c.push("Longer meetups");
  return c;
}
