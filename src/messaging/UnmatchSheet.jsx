import { useState, useRef, useEffect } from "react";
import { t } from "../tokens.js";

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

// Advisory fix 2 — dynamic prefers-reduced-motion (replaces static snapshot)
function usePrefersReduced() {
  const [prefersReduced, setPrefersReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return prefersReduced;
}

export default function UnmatchSheet({ displayName, onConfirm, onCancel }) {
  const headingRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const prefersReduced = usePrefersReduced();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Escape to cancel
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        onCancel();
      }
      // Focus trap: Tab cycles between Cancel and "End conversation"
      if (e.key === "Tab") {
        const focusable = [cancelRef.current, confirmRef.current].filter(Boolean);
        const idx = focusable.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusable[focusable.length - 1]?.focus();
          }
        } else {
          if (idx === focusable.length - 1 || idx === -1) {
            e.preventDefault();
            focusable[0]?.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const fCancel = useFocusable();
  const fConfirm = useFocusable();

  const sheetStyle = {
    position: "fixed",
    bottom: 0,
    left: "50%",
    right: "auto",
    background: t.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: "28px 24px 40px",
    boxShadow: "0 -4px 24px rgba(36,51,45,0.14)",
    zIndex: 1000,
    width: "100%",
    maxWidth: 540,
    boxSizing: "border-box",
    transform: "translateX(-50%)",
    animation: prefersReduced ? "none" : "slideUp 200ms ease-out",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(36,51,45,0.45)",
          zIndex: 999,
          transition: prefersReduced ? "none" : "opacity 150ms",
        }}
      />

      <style>{`
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(60px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);   opacity: 1; }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unmatch-heading"
        style={sheetStyle}
      >
        <h2
          id="unmatch-heading"
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 22,
            fontWeight: 700,
            color: t.text,
            margin: "0 0 14px",
            lineHeight: 1.3,
            outline: "none",
          }}
        >
          End your conversation with {displayName}?
        </h2>
        <p style={{ color: t.textSoft, fontSize: 16, lineHeight: 1.65, margin: "0 0 14px" }}>
          Here's exactly what happens:
        </p>
        <ul style={{ color: t.textSoft, fontSize: 15, lineHeight: 1.6, margin: "0 0 28px", paddingLeft: 20 }}>
          <li>This ends the conversation and you won't see each other again.</li>
          <li>{displayName} <strong>won't be told</strong>, and won't know it was you.</li>
          <li>Your conversation becomes read-only — no one can send new messages.</li>
        </ul>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Cancel first in DOM order */}
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              minHeight: 56,
              width: "100%",
              borderRadius: 14,
              fontSize: 17,
              fontWeight: 600,
              cursor: "pointer",
              background: t.surface,
              color: t.text,
              border: `1px solid ${t.border}`,
              ...fCancel.style,
            }}
            onFocus={fCancel.onFocus}
            onBlur={fCancel.onBlur}
          >
            Cancel
          </button>

          {/* Destructive action */}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              minHeight: 56,
              width: "100%",
              borderRadius: 14,
              fontSize: 17,
              fontWeight: 600,
              cursor: "pointer",
              background: t.dangerFill,
              color: "#fff",
              border: `1px solid ${t.dangerFill}`,
              ...fConfirm.style,
            }}
            onFocus={fConfirm.onFocus}
            onBlur={fConfirm.onBlur}
          >
            End conversation
          </button>
        </div>
      </div>
    </>
  );
}
