import { useState, useRef, useEffect } from "react";
import { sendMessageRequest, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";

// "Send an intro" compose sheet — the calm, opt-in way to reach a non-match from
// the Discover profile (audit/MESSAGE_REQUESTS.md §3). A plain textarea (≤300
// chars, no formatting pressure), a remaining-count, Send + Cancel.
//
// SAFETY-CRITICAL: the backend returns an identical 201 for EVERY outcome (real
// send / blocked / already-requested / recipient gone), so ANY success shows the
// SAME generic confirmation and never reveals whether the intro was delivered,
// blocked, or declined. We only surface the REAL errors the backend raises:
// 400 (bad intro — the sender's own text, safe to echo), 422 pending-cap, 429
// rate-limit — all via the api allowlist so no raw/dev string can leak.
const MAX_INTRO = 300;

export default function IntroComposeSheet({ person, onClose, plainLanguage = false }) {
  const [intro, setIntro] = useState("");
  // 'compose' | 'sending' | 'sent'
  const [stage, setStage] = useState("compose");
  const [errorMsg, setErrorMsg] = useState("");
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const confirmRef = useRef(null);

  const name = person?.displayName || "this person";

  // Focus into the textarea on open; restore to the trigger on close (WCAG 2.4.3).
  useEffect(() => {
    const prevFocus = document.activeElement;
    textareaRef.current?.focus();
    return () => {
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
    };
  }, []);

  // Move focus to the confirmation when it appears so SR/keyboard users land on it.
  useEffect(() => {
    if (stage === "sent") confirmRef.current?.focus();
  }, [stage]);

  // Escape to close + Tab/Shift+Tab focus trap (WCAG 2.4.3 / 2.1.2).
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

  const trimmed = intro.trim();
  const remaining = MAX_INTRO - intro.length;
  const canSend = trimmed.length > 0 && stage !== "sending";

  async function handleSend() {
    if (!canSend) return;
    setErrorMsg("");
    setStage("sending");
    try {
      await sendMessageRequest(person.memberId, trimmed);
      // ANY 2xx → the single calm confirmation. We deliberately do NOT inspect
      // the response: delivered, blocked, and already-requested all look the same.
      setStage("sent");
    } catch (err) {
      // Real, surface-able errors only. safeErrorMessage gates on the allowlist /
      // known codes, so a slur/link/money 400, a 422 pending-cap, or a 429 shows
      // calm copy — and anything unrecognised falls back to the generic line.
      setErrorMsg(
        safeErrorMessage(err, "We couldn't send that just now. Please try again in a little while.")
      );
      setStage("compose");
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(var(--c-scrimRgb, 36, 51, 45),0.35)", zIndex: 1100 }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Send an intro to ${name}`}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: t.surface,
          borderRadius: 20,
          padding: "24px 20px",
          width: "min(92vw, 420px)",
          maxHeight: "88vh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          zIndex: 1101,
          boxShadow: t.shadow.lg,
          boxSizing: "border-box",
          fontFamily: t.sans,
        }}
      >
        {stage === "sent" ? (
          <div>
            <p
              ref={confirmRef}
              tabIndex={-1}
              role="status"
              style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text, margin: "0 0 8px", outline: "none", lineHeight: 1.35 }}
            >
              Your intro is on its way.
            </p>
            <p style={{ color: t.textSoft, fontSize: 16, lineHeight: 1.6, margin: "0 0 20px" }}>
              {plainLanguage
                ? "There's no rush. If they'd like to talk, they can accept your intro and a conversation will start. You don't need to do anything else."
                : "There's no rush. If they'd like to talk, they can accept and a conversation will open. You'll see it in Messages if that happens — nothing to watch for in the meantime."}
            </p>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%",
                minHeight: 48,
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 600,
                cursor: "pointer",
                background: t.accentFill,
                color: "#fff",
                border: "none",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div>
            <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: t.text }}>
              Send an intro to {name}
            </h2>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 16px", lineHeight: 1.55 }}>
              {plainLanguage
                ? "Write a short hello. Keep it simple — a sentence or two is plenty. They'll decide if they want to talk."
                : "A short, plain hello is perfect — no pressure to be clever. They'll choose whether to reply, and you won't be told either way."}
            </p>

            {errorMsg && (
              <div
                role="alert"
                style={{
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 14,
                  fontSize: 14,
                  color: t.text,
                  lineHeight: 1.5,
                }}
              >
                {errorMsg}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={intro}
              maxLength={MAX_INTRO}
              onChange={(e) => setIntro(e.target.value)}
              rows={5}
              placeholder="e.g. Hi — I saw we both love quiet hikes. I'd enjoy hearing about your favourite trail."
              aria-label={`Your intro to ${name}`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontFamily: t.sans,
                // ≥16px so iOS Safari doesn't auto-zoom on focus.
                fontSize: 16,
                color: t.text,
                background: t.bg,
                border: `1px solid ${t.formBorder}`,
                borderRadius: 10,
                padding: "12px 14px",
                resize: "vertical",
                lineHeight: 1.6,
              }}
            />
            <div style={{ fontSize: 13, color: t.textMuted, margin: "6px 2px 18px" }}>
              {remaining} character{remaining === 1 ? "" : "s"} left
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
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
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: canSend ? "pointer" : "not-allowed",
                  background: canSend ? t.accentFill : t.borderLight,
                  color: canSend ? "#fff" : t.textMuted,
                  border: "none",
                }}
              >
                {stage === "sending" ? "Sending…" : "Send intro"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
