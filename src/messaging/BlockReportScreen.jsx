import { useState, useRef, useEffect } from "react";
import { t } from "../tokens.js";
import { SAFETY_REASONS } from "../safetyReasons.js";
import { useFocusable } from "../useFocusable.js";


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

const MAX_DETAILS = 500;

export default function BlockReportScreen({ displayName, onSubmit, onBack }) {
  const headingRef = useRef(null);
  const confirmRef = useRef(null);

  // Block and report are independent, optional choices. Default: block on
  // (this flow is reached from a conversation the user wants to leave), report
  // off (reporting is a separate, deliberate choice). At least one is required.
  const [doBlock, setDoBlock] = useState(true);
  const [doReport, setDoReport] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failMsg, setFailMsg] = useState("");
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

  const canSubmit = (doBlock || doReport) && !!reason && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setFailed(false);
    setSubmitting(true);

    let result;
    try {
      result = onSubmit
        ? await onSubmit({ reason, details, doBlock, doReport })
        : { blocked: doBlock, reported: doReport };
    } catch {
      result = { blocked: false, reported: false };
    }
    setSubmitting(false);

    // Treat a missing/undefined result as success for backward-compatibility
    // with callers that don't return a status.
    const blocked = result ? result.blocked !== false : true;
    const reported = result ? result.reported !== false : true;

    // E27: only ever claim the actions that actually landed. If a requested
    // block failed, surface a calm retry and don't confirm anything.
    if (doBlock && !blocked) {
      setFailed(true);
      setFailMsg(`We couldn't block ${displayName}. Please try again.`);
      setStatusMsg(`We couldn't block ${displayName}. Please try again.`);
      return;
    }
    // A block-free report that failed also gets a calm retry.
    if (!doBlock && doReport && !reported) {
      setFailed(true);
      setFailMsg(`We couldn't send your report. Please try again.`);
      setStatusMsg(`We couldn't send your report. Please try again.`);
      return;
    }

    // Build an honest confirmation from what actually happened.
    let msg;
    if (blocked && reported) {
      msg = `You have blocked and reported ${displayName}. You won't see them again, and our team will take a look.`;
    } else if (blocked) {
      msg = `You have blocked ${displayName}. You won't see them again.`;
    } else {
      msg = `Thank you. You've flagged ${displayName} for our team — we'll take a look. You haven't blocked them.`;
    }
    setConfirmMsg(msg);
    setStatusMsg(msg);
    setSubmitted(true);
  }

  // Dynamic labels reflect the chosen actions so nothing overpromises.
  const heading =
    doBlock && doReport
      ? `Block or report ${displayName}`
      : doReport && !doBlock
      ? `Report ${displayName}`
      : `Block ${displayName}`;

  const actionLabel =
    doBlock && doReport
      ? "Block and report"
      : doReport
      ? "Send report"
      : "Block";

  const submittingLabel =
    doBlock && doReport ? "Submitting…" : doReport ? "Sending…" : "Blocking…";

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
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "20px 16px 48px" }}>
        {/* Back button — touch target fix + aria-label for accessible name */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to matches"
          style={{
            background: "transparent",
            border: "none",
            color: t.accentStrong,
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
            margin: "0 0 8px",
            color: t.text,
            lineHeight: 1.25,
            outline: "none",
          }}
        >
          {heading}
        </h1>
        {!submitted && (
          <p style={{ fontSize: 16, color: t.textSoft, margin: "0 0 24px", lineHeight: 1.6 }}>
            Choose what you'd like to do. You can block, report, or both — whatever feels
            right. Neither is required.
          </p>
        )}

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
              {confirmMsg}
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
              boxShadow: t.shadow.sm,
            }}
          >
            {failed && (
              <div
                role="alert"
                style={{
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 20,
                  fontSize: 16,
                  color: t.text,
                  lineHeight: 1.5,
                }}
              >
                {failMsg}
              </div>
            )}

            {/* Two independent choices */}
            <fieldset style={{ border: "none", margin: "0 0 24px", padding: 0 }}>
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
                What would you like to do?
              </legend>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <ActionOption
                  checked={doBlock}
                  onChange={() => setDoBlock((v) => !v)}
                  title="Block them"
                  description={`${displayName} won't be able to message you, and you won't see each other again.`}
                />
                <ActionOption
                  checked={doReport}
                  onChange={() => setDoReport((v) => !v)}
                  title="Report to our team"
                  description="Flag this for our team — you don't have to block them. It's private, low-stakes, and there's no wrong reason to reach out."
                />
              </div>

              {!doBlock && !doReport && (
                <p style={{ fontSize: 14, color: t.textMuted, margin: "12px 0 0" }}>
                  Pick at least one to continue.
                </p>
              )}
            </fieldset>

            {/* Reason — needed for whichever action is chosen */}
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
                What's going on? {doReport && !doBlock ? "This helps our team." : ""}
              </legend>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {SAFETY_REASONS.map((r) => (
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
                  fontSize: 16,
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
              disabled={!canSubmit}
              style={{
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                fontSize: 17,
                fontWeight: 600,
                cursor: canSubmit ? "pointer" : "not-allowed",
                background: canSubmit ? t.danger : t.borderLight,
                color: canSubmit ? "#fff" : t.textMuted,
                border: "none",
                ...fSubmit.style,
              }}
              onFocus={fSubmit.onFocus}
              onBlur={fSubmit.onBlur}
            >
              {submitting ? submittingLabel : failed ? "Try again" : actionLabel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// A single independent action toggle (Block / Report), presented as a checkbox
// with a plain-language description. Reuses the app's calm radio-card styling.
function ActionOption({ checked, onChange, title, description }) {
  const [focused, setFocused] = useState(false);
  const prefersReduced = usePrefersReduced();

  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        cursor: "pointer",
        fontSize: 16,
        color: t.text,
        padding: "14px 16px",
        borderRadius: 12,
        background: checked ? t.surfaceAlt : "transparent",
        border: `1px solid ${checked ? t.formBorder : t.borderLight}`,
        transition: prefersReduced ? "none" : "background 120ms",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          accentColor: t.accent,
          width: 20,
          height: 20,
          flexShrink: 0,
          marginTop: 2,
          outline: focused ? `2px solid ${t.focus}` : "none",
          outlineOffset: "2px",
        }}
      />
      <span>
        <span style={{ display: "block", fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, lineHeight: 1.5, marginTop: 4 }}>
          {description}
        </span>
      </span>
    </label>
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
