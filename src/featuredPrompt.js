// D-17 Phase 0 — reframe of the deep-dive `talk_for_hours` prompt answer.
//
// This is a DISPLAY reframe only: no schema change, no backend, no scoring. The
// answer already flows to the client inside the generic prompt list. Here we
// pull it OUT of that list so a surface can feature it as a distinct, brand-
// forward "Could talk for hours about" hero moment, while every OTHER prompt
// keeps rendering normally. Mirrors the D-2 pattern (the comm-note has one home,
// filtered out of the generic list so it never duplicates).

// The one prompt key we promote. STABLE — matches server/src/data/prompts.js.
export const FEATURED_PROMPT_KEY = "talk_for_hours";

// The calm hero title shown ABOVE the answer — deliberately NOT the raw prompt
// sentence ("Something I could talk about for hours…"). Confident and quiet.
export const FEATURED_PROMPT_TITLE = "Could talk for hours about";

// Split a prompt list ([{ promptKey, promptText?, answer }]) into
// { featured, rest }:
//   • `featured` — the ANSWERED talk_for_hours prompt (or null). Only a non-empty
//     answer is featured; an unanswered talk_for_hours prompt is left in `rest`
//     so downstream valid-answer filters drop it exactly as they do today.
//   • `rest` — every OTHER prompt, ORDER PRESERVED, so the generic PromptCards
//     list is unchanged for the remaining 11 keys.
// Never throws on nullish / non-array input.
export function splitFeaturedPrompt(prompts) {
  const list = Array.isArray(prompts) ? prompts : [];
  let featured = null;
  const rest = [];
  for (const p of list) {
    const isFeatured =
      !featured &&
      p &&
      p.promptKey === FEATURED_PROMPT_KEY &&
      typeof p.answer === "string" &&
      p.answer.trim().length > 0;
    if (isFeatured) {
      featured = p;
    } else {
      rest.push(p);
    }
  }
  return { featured, rest };
}
