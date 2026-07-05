// Shared profile-completeness logic — the single source of truth for the 7
// autism-specific "differentiator" fields that enrich a Spectrum profile beyond
// the required name + interests. Used by BOTH the in-form nudge inside
// ProfileScreen (the code-split editor chunk) AND the calm completeness cue on
// the Profile Hub. Kept in this tiny standalone module so the Hub / App can
// compute completeness without importing the heavy, code-split ProfileScreen.
//
// Calm-by-design: this is a gentle "here's what still helps" signal, never a
// score to chase — no "% complete!" pressure, no nagging, no gamification.

// NOTE: `seeking` is deliberately NOT a completeness field. The seeking control
// always presents a valid chosen state — specific genders OR an explicit "Open
// to everyone" (which maps to seeking === "", the default). Empty is therefore a
// complete, valid preference, so `!!seeking` would falsely flag every
// open-to-everyone user as incomplete with a chip they can never clear.
export const COMPLETENESS_FIELDS = [
  { key: "photo",     label: "Add a photo" },
  { key: "tagline",   label: "Add a tagline" },
  { key: "bio",       label: "Write your bio" },
  { key: "pronouns",  label: "Add pronouns / gender" },
  { key: "commStyle", label: "Fill in comms style" },
  { key: "sensory",   label: "Add sensory preferences" },
  { key: "prompt",    label: "Answer a prompt" },
];

// Brand spectrum ramp (literal hex — theme-constant, never flag colours) used to
// paint the completeness meter as the ramp filling left→right (D-8). Luminance
// rises MONOTONICALLY green→sand so the meter reads as steadily "filling" and
// never dips mid-run (~0.24 → 0.25 → 0.28 → 0.32 → 0.42 → 0.71).
export const COMPLETENESS_RAMP = ["#5E9459", "#539490", "#5E9C93", "#6FA39A", "#C9A875", "#E7D9C4"];

// Compute { score, total, missing } from a profile's fields. Every field is
// defaulted so a partial payload (e.g. /profile/me on the Hub, before every
// field is populated) never throws on `.trim()`.
export function computeCompleteness({
  photos = [], tagline = "", bio = "", gender = "", pronouns = "",
  commDirectness = "", commLiteral = "", commCadence = "",
  sensoryEnvironment = "", sensoryLighting = "", prompts = [],
} = {}) {
  const filled = {
    photo:     (photos || []).length > 0,
    tagline:   (tagline || "").trim().length > 0,
    bio:       (bio || "").trim().length > 0,
    pronouns:  !!(gender || pronouns),
    commStyle: !!(commDirectness || commLiteral || commCadence),
    sensory:   !!(sensoryEnvironment || sensoryLighting),
    prompt:    (prompts || []).length > 0,
  };
  const missing = COMPLETENESS_FIELDS.filter((f) => !filled[f.key]);
  return { score: COMPLETENESS_FIELDS.length - missing.length, total: COMPLETENESS_FIELDS.length, missing };
}
