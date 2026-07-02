import { useState, useRef, useEffect } from "react";
import { t } from "./tokens.js";
import { SealCheckIcon } from "./icons.jsx";

// A small, calm "✓ Reviewed" trust pill. Subtle by design — no flash, no fill.
// Reused next to display names and in the profile verification section.
// Honest labeling (F25): this asserts a team review of the profile, NOT a formal
// identity/ID check — so it reads "Reviewed", not "Verified", to avoid a
// vulnerable audience over-trusting a literal "Verified".
//
// The pill is a button: tapping it opens a one-sentence plain-language
// explainer of what "Reviewed" does and doesn't mean, so the badge is a real,
// inspectable trust signal instead of unexplained decoration (works on touch,
// where the old title-tooltip was invisible). Escape / outside-click closes.
// `interactive={false}` renders a plain (non-button) pill — required when the
// badge sits inside another interactive element (e.g. the Messages row button),
// where nesting a <button> would be invalid HTML.
// `compact` renders the seal icon alone (no pill, no text) for dense list rows;
// it is aria-hidden, so the host row's aria-label must carry "Reviewed profile."
export default function VerifiedBadge({ style, interactive = true, compact = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // NOTE: this hook stays ABOVE the conditional returns — Rules of Hooks
  // (and our own eslint gate) forbid hooks after a conditional return.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (compact) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          color: t.positiveText,
          flexShrink: 0,
          verticalAlign: "middle",
          ...style,
        }}
      >
        <SealCheckIcon size={16} />
      </span>
    );
  }

  if (!interactive) {
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
          fontSize: 13,
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

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle", ...style }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label="Reviewed by our team. What does this mean?"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.2,
          color: t.positiveText,
          border: `1px solid ${t.positive}`,
          background: "transparent",
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          cursor: "pointer",
          fontFamily: t.sans,
        }}
      >
        <SealCheckIcon size={13} />
        Reviewed
      </button>
      {open && (
        <span
          role="note"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 400,
            width: 240,
            padding: "10px 12px",
            background: t.surface,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 12,
            boxShadow: t.shadow.md,
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.5,
            color: t.textSoft,
            textAlign: "left",
            whiteSpace: "normal",
            fontFamily: t.sans,
            letterSpacing: 0,
          }}
        >
          A member of our team has looked over this profile. It's a human
          review, not a formal identity or ID check.
        </span>
      )}
    </span>
  );
}
