import { t } from "./tokens.js";
import { SealCheckIcon } from "./icons.jsx";

// A small, calm "✓ Reviewed" trust pill. Subtle by design — no flash, no fill.
// Reused next to display names and in the profile verification section.
// Honest labeling (F25): this asserts a team review of the profile, NOT a formal
// identity/ID check — so it reads "Reviewed", not "Verified", to avoid a
// vulnerable audience over-trusting a literal "Verified".
export default function VerifiedBadge({ style }) {
  return (
    <span
      title="Reviewed by our team"
      aria-label="Reviewed by our team"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        color: t.positiveText,
        border: `1px solid ${t.positive}`,
        background: "transparent",
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
        ...style,
      }}
    >
      <SealCheckIcon size={13} />
      Reviewed
    </span>
  );
}
