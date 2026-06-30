import { t } from "./tokens.js";
import { SealCheckIcon } from "./icons.jsx";

// A small, calm "✓ Verified" trust pill. Subtle by design — no flash, no fill.
// Reused next to display names and in the profile verification section.
export default function VerifiedBadge({ style }) {
  return (
    <span
      title="Identity verified"
      aria-label="Identity verified"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        color: t.positive,
        border: `1px solid ${t.positive}`,
        background: "transparent",
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
        ...style,
      }}
    >
      <SealCheckIcon size={13} />
      Verified
    </span>
  );
}
