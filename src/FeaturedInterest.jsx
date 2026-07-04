import { t } from "./tokens.js";
import SectionRule from "./SectionRule.jsx";
import { FEATURED_PROMPT_TITLE } from "./featuredPrompt.js";

// D-17 Phase 0 — the "Could talk for hours about" hero moment. Promotes a
// member's `talk_for_hours` answer out of the generic prompt list into a single,
// brand-forward block: a calm uppercase eyebrow title, the spectrum-ramp
// SectionRule as the one confident brand beat (decorative, aria-hidden, static/
// flat → reduced-sensory-safe), then the answer in serif. The answer is user
// content, already length-capped server-side, rendered plainly. Renders nothing
// when there's no answer, so surfaces can mount it unconditionally.
export default function FeaturedInterest({ answer }) {
  if (!answer || !answer.trim()) return null;
  return (
    // minWidth:0 — this block can carry long, unbroken user text inside flex
    // parents; without it the answer can force horizontal overflow / overlap.
    <section aria-label={FEATURED_PROMPT_TITLE} style={{ minWidth: 0 }}>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          color: t.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          lineHeight: 1.4,
        }}
      >
        {FEATURED_PROMPT_TITLE}
      </p>
      <SectionRule style={{ marginTop: 8, marginBottom: 12 }} />
      <p
        style={{
          margin: 0,
          fontFamily: t.serif,
          fontSize: 24,
          fontWeight: 700,
          color: t.text,
          lineHeight: 1.4,
          overflowWrap: "anywhere",
        }}
      >
        {answer}
      </p>
    </section>
  );
}
