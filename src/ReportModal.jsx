import { useState, useRef, useEffect } from "react";
import { reportUser, blockUser } from "./api.js";
import { t } from "./tokens.js";
import { SAFETY_REASONS } from "./safetyReasons.js";
import { useFocusable } from "./useFocusable.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// Native control wired to the app's shared focus ring (t.focus) instead of the
// UA outline, so keyboard focus looks consistent with the rest of the app (A5).
// Each instance owns its own useFocusable hook — safe inside the reason .map().
function FocusRingInput({ style, ...props }) {
  const f = useFocusable();
  return <input {...props} onFocus={f.onFocus} onBlur={f.onBlur} style={{ ...style, ...f.style }} />;
}

// Block-or-report modal (shared by Discover and Matches). `candidate` needs
// { memberId, displayName }; `onBlocked(candidate)` fires only when a block
// actually landed (E27). Extracted from SuggestionScreen so the Matches page
// can offer the same calm block/report flow on people who liked you.
export default function ReportModal({ candidate, onClose, onBlocked, audioId }) {
  const plain = usePlainLanguage();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  // Block and report are independent choices. Default: report on (this is the
  // "Report" entry point), block on too since it's pre-match — but each is
  // optional and can be turned off. At least one is required.
  // Report-an-audio (audioId present): the intent is to flag a specific voice
  // note, not to cut off the whole (matched) person — so block defaults OFF while
  // staying available if they want it.
  const [doReport, setDoReport] = useState(true);
  const [doBlock, setDoBlock] = useState(!audioId);
  const [submitted, setSubmitted] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failMsg, setFailMsg] = useState("");
  const headingRef = useRef(null);
  const dialogRef = useRef(null);
  const statusRef = useRef(null);
  const fCancel = useFocusable();
  const fSubmit = useFocusable();

  // B27 — after submit the labelled heading unmounts; move focus to the success
  // status line (rather than letting it fall to <body>) so a screen-reader user
  // isn't dumped to the top. WCAG 2.4.3.
  useEffect(() => {
    if (submitted) statusRef.current?.focus();
  }, [submitted]);

  // Move focus into the dialog on open, restore to the trigger on close. WCAG 2.4.3.
  useEffect(() => {
    const prevFocus = document.activeElement;
    headingRef.current?.focus();
    return () => {
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
    };
  }, []);

  // Escape to close + Tab/Shift+Tab focus trap. Focusable set is dynamic
  // (checkboxes, reason radios, textarea, buttons), so query live. WCAG 2.4.3 / 2.1.2.
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !root.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !root.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const canSubmit = (doBlock || doReport) && !!reason && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFailed(false);

    // Report to moderators (independent of block).
    let reported = false;
    if (doReport) {
      try {
        // Thread audioId through when reporting a specific voice note; the
        // backend snapshots its transcript as durable evidence and soft-holds it.
        await reportUser(candidate.memberId, reason, details || undefined, undefined, undefined, audioId || undefined);
        reported = true;
      } catch (err) {
        console.warn("Report failed", err);
      }
    }
    // Block. blockUser canonicalises the reason to a valid block reason.
    let blocked = false;
    if (doBlock) {
      try {
        await blockUser(candidate.memberId, reason, details || undefined);
        blocked = true;
      } catch (err) {
        console.warn("Block failed", err);
      }
    }
    setSubmitting(false);

    // E27: only drop them from the deck / promise "gone" when the block landed.
    if (doBlock) {
      if (!blocked) {
        setFailMsg(`We couldn't block ${candidate.displayName}. Please try again.`);
        setFailed(true);
        return;
      }
      if (onBlocked) onBlocked(candidate);
    }
    if (!doBlock && doReport && !reported) {
      setFailMsg("We couldn't send your report. Please try again.");
      setFailed(true);
      return;
    }

    setConfirmMsg(
      blocked && reported
        ? `Blocked and reported. You won't see ${candidate.displayName} again, and our team will take a look.`
        : blocked && doReport && !reported
        // Block landed but the report didn't — stay honest about both. Don't
        // undo the successful block; point them to where they can retry.
        ? `You've blocked ${candidate.displayName}. We couldn't send your report to our team — you can try reporting again from Safety Center.`
        : blocked
        ? `Blocked. You won't see ${candidate.displayName} again.`
        : "Report submitted. Thank you — our team will take a look."
    );
    setSubmitted(true);
    setTimeout(onClose, 1600);
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(var(--c-scrimRgb, 36, 51, 45),0.35)",
          zIndex: 1100,
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-heading"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: t.surface,
          borderRadius: 20,
          padding: "28px 24px",
          width: "min(90vw, 400px)",
          maxHeight: "88vh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          zIndex: 1101,
          boxShadow: t.shadow.lg,
          boxSizing: "border-box",
          fontFamily: t.sans,
        }}
      >
        {submitted ? (
          <p
            role="status"
            ref={statusRef}
            tabIndex={-1}
            style={{ color: t.textSoft, textAlign: "center", margin: 0, lineHeight: 1.6, outline: "none" }}
          >
            {confirmMsg}
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2
              id="report-modal-heading"
              ref={headingRef}
              tabIndex={-1}
              style={{
                fontFamily: t.serif,
                fontSize: 20,
                fontWeight: 700,
                margin: "0 0 8px",
                color: t.text,
                outline: "none",
              }}
            >
              {audioId ? `Report ${candidate.displayName}'s voice note` : `Block or report ${candidate.displayName}`}
            </h2>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 20px", lineHeight: 1.55 }}>
              {audioId
                ? (plain
                  ? "Send this voice note to our team to check. You can block them too if you want. You don't have to do either."
                  : "Flag this voice note for our team to re-listen to. You can also block them if you'd like — neither is required.")
                : (plain
                  ? "Pick what you want to do. You can block, report, or both. You don't have to do either."
                  : "Choose what you'd like to do — you can block, report, or both. Neither is required.")}
            </p>
            {failed && (
              <div
                role="alert"
                style={{
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 16,
                  fontSize: 14,
                  color: t.text,
                  lineHeight: 1.5,
                }}
              >
                {failMsg}
              </div>
            )}
            <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
              <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 10 }}>
                {plain ? "What do you want to do?" : "What would you like to do?"}
              </legend>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, fontSize: 16, color: t.text, cursor: "pointer" }}>
                <FocusRingInput
                  type="checkbox"
                  checked={doBlock}
                  onChange={() => setDoBlock((v) => !v)}
                  style={{ minWidth: 18, minHeight: 18, marginTop: 2, accentColor: t.accent }}
                />
                <span>
                  <span style={{ display: "block", fontWeight: 600 }}>Block them</span>
                  <span style={{ display: "block", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
                    You won't see {candidate.displayName} again.
                  </span>
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 16, color: t.text, cursor: "pointer" }}>
                <FocusRingInput
                  type="checkbox"
                  checked={doReport}
                  onChange={() => setDoReport((v) => !v)}
                  style={{ minWidth: 18, minHeight: 18, marginTop: 2, accentColor: t.accent }}
                />
                <span>
                  <span style={{ display: "block", fontWeight: 600 }}>Report to our team</span>
                  <span style={{ display: "block", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
                    {plain
                      ? "Tell our team about this. You don't have to block them. It stays private."
                      : "Flag this for our team — you don't have to block them. It's private and low-stakes."}
                  </span>
                </span>
              </label>
              {!doBlock && !doReport && (
                <p style={{ fontSize: 14, color: t.textMuted, margin: "10px 0 0" }}>
                  Pick at least one to continue.
                </p>
              )}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
              <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 10 }}>
                What's going on?
              </legend>
              {SAFETY_REASONS.map((r) => (
                <label
                  key={r.value}
                  style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 16, color: t.text, cursor: "pointer" }}
                >
                  <FocusRingInput
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ minWidth: 18, minHeight: 18, accentColor: t.accent }}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 6 }}>
                Additional details (optional)
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 200))}
                maxLength={200}
                rows={3}
                placeholder="Tell us more…"
                style={{
                  width: "100%",
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                  // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
                  fontSize: 16,
                  color: t.text,
                  fontFamily: t.sans,
                  resize: "none",
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: t.textMuted }}>{200 - details.length} characters remaining</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                onFocus={fCancel.onFocus}
                onBlur={fCancel.onBlur}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: t.surface,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  ...fCancel.style,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                onFocus={fSubmit.onFocus}
                onBlur={fSubmit.onBlur}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  background: canSubmit ? t.dangerFill : t.borderLight,
                  color: canSubmit ? "#fff" : t.textMuted,
                  border: "none",
                  ...fSubmit.style,
                }}
              >
                {submitting
                  ? "Submitting…"
                  : failed
                  ? "Try again"
                  : doBlock && doReport
                  ? "Block and report"
                  : doReport
                  ? "Send report"
                  : "Block"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
