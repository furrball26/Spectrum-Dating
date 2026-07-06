import { t } from "./tokens.js";
import SectionRule from "./SectionRule.jsx";
import { FEATURED_PROMPT_TITLE } from "./featuredPrompt.js";
import { sharedSpecialInterests } from "./specialInterests.js";

// D-17 — the "Could talk for hours about" section. Phase 0 rendered only the
// free-text `talk_for_hours` answer; Phase 2 MERGES in the structured, matchable
// `specialInterests` chips, which now LEAD as the headline (chips first), with
// the prose answer kept BELOW as supporting elaboration. One section, one home.
//
// Behaviour:
//   • chips only   → chips, no prose
//   • prose only   → today's behaviour (prose only)
//   • both         → chips, then prose
//   • neither      → null (surfaces can still mount it unconditionally)
//
// Shared-highlight: when `viewerSpecialInterests` is provided (viewing SOMEONE
// ELSE), the viewer's own matching chips visually pop — same mechanism as
// InterestPills' shared casual interests (case-insensitive, accent fill, ✦). On
// your OWN card, pass no viewer set so nothing is highlighted — just your chips.
//
// The SectionRule (spectrum ramp) is the one confident brand beat here:
// decorative, aria-hidden, static/flat. Under reduced-sensory it's dropped — the
// same treatment SuggestionScreen gives its decorative SpectrumStrip — so the
// section falls back to plain type with no brand decoration. `reducedSensory`
// defaults false, so every other caller keeps the rule unchanged.
export default function FeaturedInterest({ answer, specialInterests, viewerSpecialInterests = null, reducedSensory = false }) {
  const chips = (Array.isArray(specialInterests) ? specialInterests : []).filter(
    (s) => typeof s === "string" && s.trim()
  );
  const prose = answer && answer.trim() ? answer : "";

  // Render nothing unless there's at least a chip or the prose answer.
  if (chips.length === 0 && !prose) return null;

  // Shared set (lowercased) only when a viewer set is supplied — i.e. not on the
  // owner's own card, where every chip reads as a plain, unhighlighted tag.
  const sharedSet = viewerSpecialInterests
    ? new Set(sharedSpecialInterests(viewerSpecialInterests, chips).map((s) => s.toLowerCase()))
    : new Set();

  return (
    // minWidth:0 — this block carries long, unbroken user text/chips inside flex
    // parents; without it the content can force horizontal overflow / overlap.
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
      {!reducedSensory && <SectionRule style={{ marginTop: 8, marginBottom: 12 }} />}

      {/* The matchable chips lead. minWidth:0 on the row + each chip guards the
          truncatable tag text (past overlap/overflow class). */}
      {chips.length > 0 && (
        <ul
          role="list"
          aria-label={FEATURED_PROMPT_TITLE}
          style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none", minWidth: 0 }}
        >
          {chips.map((chip) => {
            const shared = sharedSet.has(chip.trim().toLowerCase());
            return (
              <li
                key={chip}
                role="listitem"
                aria-label={shared ? `${chip} — shared` : chip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  maxWidth: "100%",
                  minWidth: 0,
                  padding: "6px 14px",
                  borderRadius: 24,
                  fontSize: 15,
                  fontWeight: shared ? 600 : 500,
                  background: shared ? t.accentFill : t.surfaceAlt,
                  color: shared ? "#fff" : t.textSoft,
                  border: `1px solid ${shared ? t.accentFill : t.border}`,
                  letterSpacing: shared ? "0.01em" : 0,
                }}
              >
                {shared && <span aria-hidden="true" style={{ fontSize: 10 }}>✦</span>}
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{chip}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* The prose elaboration — the free-text talk_for_hours answer — below the
          chips as supporting detail (or standalone when there are no chips). */}
      {prose && (
        <p
          style={{
            margin: 0,
            marginTop: chips.length > 0 ? 14 : 0,
            fontFamily: t.serif,
            fontSize: chips.length > 0 ? 20 : 24,
            fontWeight: 700,
            color: t.text,
            lineHeight: 1.4,
            overflowWrap: "anywhere",
          }}
        >
          {prose}
        </p>
      )}
    </section>
  );
}
