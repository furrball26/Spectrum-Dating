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

const REASONS = [
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

const MAX_DETAILS = 500;

export default function BlockReportScreen({ displayName, onSubmit, onBack }) {
  const headingRef = useRef(null);
  const confirmRef = useRef(null);
  const statusRef = useRef(null);

  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const fBack = useFocusable();
  const fSubmit = useFocusable();
  const fTextarea = useFocusable();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (submitted && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [submitted]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!reason) return;
    setSubmitted(true);
    setStatusMsg(`You have blocked and reported ${displayName}. You will not see them again.`);
    if (onSubmit) onSubmit({ reason, details });
  }

  return (
    <div
      style={{
        minHeight: "100%",
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 17,
        lineHeight: 1.65,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 540, margin: "0 auto", padding: "20px 16px 48px" }}>
        {/* Back button — touch target fix + aria-label for accessible name */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to matches"
          style={{
            background: "transparent",
            border: "none",
            color: t.accent,
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            padding: "8px 0",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 6,
            minHeight: 44,
            minWidth: 44,
            ...fBack.style,
          }}
          onFocus={fBack.onFocus}
          onBlur={fBack.onBlur}
        >
          ← Back to matches
        </button>

        {/* Page heading */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 24px",
            color: t.text,
            lineHeight: 1.25,
            outline: "none",
          }}
        >
          Block and report {displayName}
        </h1>

        {/* Status/confirmation region */}
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            left: "-9999px",
            width: 1,
            height: 1,
            overflow: "hidden",
          }}
        >
          {statusMsg}
        </div>

        {submitted ? (
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 20,
              padding: "28px 24px",
            }}
          >
            <p
              ref={confirmRef}
              tabIndex={-1}
              style={{
                fontSize: 17,
                color: t.text,
                lineHeight: 1.65,
                margin: 0,
                outline: "none",
              }}
            >
              You have blocked and reported {displayName}. You will not see them again.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 20,
              padding: "28px 24px",
              boxShadow: "0 2px 8px rgba(36,51,45,0.07)",
            }}
          >
            <fieldset
              style={{
                border: "none",
                margin: "0 0 24px",
                padding: 0,
              }}
            >
              <legend
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: t.text,
                  marginBottom: 14,
                  display: "block",
                  float: "none",
                  width: "100%",
                  padding: 0,
                }}
              >
                Why are you reporting {displayName}?
              </legend>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {REASONS.map((r) => (
                  <RadioOption
                    key={r.value}
                    name="reason"
                    value={r.value}
                    label={r.label}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                ))}
              </div>
            </fieldset>

            <div style={{ marginBottom: 28 }}>
              <label
                htmlFor="block-report-details"
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 500,
                  color: t.textSoft,
                  marginBottom: 8,
                }}
              >
                Additional details (optional)
              </label>
              {/* Security Fix 5 — maxLength 500 */}
              <textarea
                id="block-report-details"
                aria-label="Additional details (optional)"
                placeholder="Tell us more if you'd like."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                maxLength={MAX_DETAILS}
                style={{
                  width: "100%",
                  border: `1px solid ${t.formBorder}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 16,
                  color: t.text,
                  background: t.bg,
                  resize: "vertical",
                  fontFamily: t.sans,
                  lineHeight: 1.5,
                  boxSizing: "border-box",
                  ...fTextarea.style,
                }}
                onFocus={fTextarea.onFocus}
                onBlur={fTextarea.onBlur}
              />
            </div>

            <button
              type="submit"
              disabled={!reason}
              style={{
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                fontSize: 17,
                fontWeight: 600,
                cursor: reason ? "pointer" : "not-allowed",
                background: reason ? t.danger : t.borderLight,
                color: reason ? "#fff" : t.textMuted,
                border: "none",
                ...fSubmit.style,
              }}
              onFocus={fSubmit.onFocus}
              onBlur={fSubmit.onBlur}
            >
              Block and report
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// Advisory fix 1 — radio option transition gated on prefersReduced
// Advisory fix 2 — dynamic prefersReduced inside RadioOption
function RadioOption({ name, value, label, checked, onChange }) {
  const [focused, setFocused] = useState(false);
  const prefersReduced = usePrefersReduced();

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        fontSize: 16,
        color: t.text,
        padding: "10px 14px",
        borderRadius: 10,
        background: checked ? t.surfaceAlt : "transparent",
        border: `1px solid ${checked ? t.formBorder : t.borderLight}`,
        transition: prefersReduced ? "none" : "background 120ms",
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          accentColor: t.accent,
          width: 18,
          height: 18,
          flexShrink: 0,
          outline: focused ? `2px solid ${t.focus}` : "none",
          outlineOffset: "2px",
        }}
      />
      {label}
    </label>
  );
}
