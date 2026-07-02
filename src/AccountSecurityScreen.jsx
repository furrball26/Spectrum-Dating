import { useState, useRef, useEffect } from "react";
import { changePassword, changeEmail, deleteAccount, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";

// AccountSecurityScreen — Spectrum Dating
// Split out of ProfileScreen so the dating profile and account controls live in
// separate, calmer surfaces. Contains: change password, change email, and the
// (permanent) delete-account danger zone. The password/email/delete flows are
// relocated INTACT from ProfileScreen — same api.js calls, same UX.


// Gates all transitions on prefers-reduced-motion.
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

// Small label pattern (mirrors ProfileScreen's FieldLabel).
function FieldLabel({ htmlFor, children }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{ display: "block", fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}
    >
      {children}
    </label>
  );
}

// Shared input style (mirrors ProfileScreen's inputStyle).
function inputStyle(hasError) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: `1.5px solid ${hasError ? t.danger : t.formBorder}`,
    borderRadius: 10,
    // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
    fontSize: 16,
    color: t.text,
    background: t.surface,
    fontFamily: t.sans,
    outline: "none",
  };
}

// ── Account & security: change password / change email ────────────────────────
// Relocated from ProfileScreen intact.
function AccountSecuritySection() {
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwStatus, setPwStatus] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [emPw, setEmPw] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emStatus, setEmStatus] = useState("");
  const [emBusy, setEmBusy] = useState(false);

  const field = { ...inputStyle(false), marginBottom: 10 };
  const submitBtn = (busy) => ({
    background: t.accentFill, color: "#fff", border: "none", borderRadius: 10,
    padding: "10px 18px", minHeight: 44, fontSize: 16, fontWeight: 600,
    cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
  });

  async function submitPw(e) {
    e.preventDefault();
    setPwStatus("");
    if (newPw.length < 8) { setPwStatus("New password must be at least 8 characters."); return; }
    setPwBusy(true);
    try { await changePassword(curPw, newPw); setPwStatus("✓ Password updated."); setCurPw(""); setNewPw(""); }
    catch (err) { setPwStatus(safeErrorMessage(err, "Couldn't change your password right now. Please try again.")); }
    finally { setPwBusy(false); }
  }
  async function submitEmail(e) {
    e.preventDefault();
    setEmStatus("");
    setEmBusy(true);
    try {
      const r = await changeEmail(newEmail, emPw);
      setEmStatus(r.emailVerified ? "✓ Email updated." : "✓ Email updated — check your inbox to verify.");
      setNewEmail(""); setEmPw("");
    } catch (err) { setEmStatus(safeErrorMessage(err, "Couldn't change your email right now. Please try again.")); }
    finally { setEmBusy(false); }
  }

  // Success messages are prefixed with "✓"; anything else is an error. Errors
  // must read AND sound like errors — role="alert" + t.danger (D28).
  const isPwOk = pwStatus.startsWith("✓");
  const isEmOk = emStatus.startsWith("✓");

  return (
    <div style={{ marginTop: 4 }}>
      <form onSubmit={submitPw} style={{ marginBottom: 22 }}>
        <FieldLabel htmlFor="cur-pw">Change password</FieldLabel>
        <input id="cur-pw" type="password" autoComplete="current-password" aria-label="Current password"
          placeholder="Current password"
          value={curPw} onChange={(e) => setCurPw(e.target.value)} style={field} />
        <input type="password" autoComplete="new-password" aria-label="New password"
          placeholder="New password (min 8 chars)"
          value={newPw} onChange={(e) => setNewPw(e.target.value)} style={field} />
        <button type="submit" disabled={pwBusy} style={submitBtn(pwBusy)}>
          {pwBusy ? "Saving…" : "Update password"}
        </button>
        {pwStatus && (
          isPwOk
            ? <p role="status" style={{ margin: "8px 0 0", fontSize: 14, color: t.textSoft }}>{pwStatus}</p>
            : <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: t.danger }}>{pwStatus}</p>
        )}
      </form>

      <form onSubmit={submitEmail}>
        <FieldLabel htmlFor="new-email">Change email</FieldLabel>
        <input id="new-email" type="email" autoComplete="email" placeholder="New email"
          value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={field} />
        <input type="password" autoComplete="current-password" aria-label="Current password"
          placeholder="Current password"
          value={emPw} onChange={(e) => setEmPw(e.target.value)} style={field} />
        <button type="submit" disabled={emBusy} style={submitBtn(emBusy)}>
          {emBusy ? "Saving…" : "Update email"}
        </button>
        {emStatus && (
          isEmOk
            ? <p role="status" style={{ margin: "8px 0 0", fontSize: 14, color: t.textSoft }}>{emStatus}</p>
            : <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: t.danger }}>{emStatus}</p>
        )}
      </form>
    </div>
  );
}

// ── Danger zone: account deletion ────────────────────────────────────────────
// Relocated from ProfileScreen intact.
function DeleteAccountSection({ onAccountDeleted }) {
  const [showDialog, setShowDialog] = useState(false);
  const triggerRef = useRef(null);
  const f = useFocusable();

  return (
    <div style={{ marginTop: 28, paddingTop: 24, borderTop: `1px solid ${t.borderLight}`, textAlign: "center" }}>
      <h2
        style={{
          fontFamily: t.serif,
          fontSize: 16,
          fontWeight: 700,
          color: t.danger,
          margin: "0 0 4px",
        }}
      >
        Danger zone
      </h2>
      <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px" }}>
        Deleting your account is permanent and cannot be undone.
      </p>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setShowDialog(true)}
        {...f}
        style={{
          background: "transparent",
          border: `1px solid ${t.danger}`,
          borderRadius: 10,
          color: t.danger,
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          padding: "10px 24px",
          minHeight: 44,
          ...f.style,
        }}
      >
        Delete account
      </button>

      {showDialog && (
        <DeleteAccountDialog
          onAccountDeleted={onAccountDeleted}
          onCancel={() => {
            setShowDialog(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}

function DeleteAccountDialog({ onAccountDeleted, onCancel }) {
  const cancelRef = useRef(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const prefersReduced = usePrefersReduced();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const canConfirm = confirmText.trim() === "DELETE" && !deleting;

  // Focus the input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!deleting) onCancel();
      return;
    }
    if (e.key === "Tab") {
      const els = [cancelRef.current, inputRef.current, confirmRef.current].filter(Boolean);
      const idx = els.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); els[els.length - 1]?.focus(); }
      } else {
        if (idx === els.length - 1 || idx === -1) { e.preventDefault(); els[0]?.focus(); }
      }
    }
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setDeleting(true);
    setError("");
    try {
      await deleteAccount();
      onAccountDeleted?.();
    } catch {
      setDeleting(false);
      setError("Could not delete your account. Please try again.");
    }
  }

  const fCancel = useFocusable();
  const fConfirm = useFocusable();

  const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(36,51,45,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: "20px 16px",
  };
  const dialog = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    maxWidth: 440,
    width: "100%",
    boxShadow: t.shadow.lg,
    transition: prefersReduced ? "none" : "opacity 150ms ease",
    textAlign: "left",
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget && !deleting) onCancel(); }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-heading"
        aria-describedby="delete-account-body"
        style={dialog}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="delete-account-heading"
          style={{ fontFamily: t.serif, fontSize: 22, margin: "0 0 10px", fontWeight: 700, color: t.danger }}
        >
          Delete your account?
        </h2>
        <p id="delete-account-body" style={{ color: t.textSoft, margin: "0 0 18px", lineHeight: 1.6 }}>
          This permanently deletes your profile, matches, and messages. This cannot be undone.
        </p>

        <label
          htmlFor="delete-confirm-input"
          style={{ display: "block", fontWeight: 600, fontSize: 14, color: t.text, marginBottom: 6 }}
        >
          Type DELETE to confirm
        </label>
        <input
          ref={inputRef}
          id="delete-confirm-input"
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck="false"
          value={confirmText}
          disabled={deleting}
          onChange={(e) => setConfirmText(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={inputStyle(false)}
          placeholder="DELETE"
        />

        {error && (
          <span role="alert" style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 8, fontWeight: 500 }}>
            {error}
          </span>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-busy={deleting}
            style={{
              minHeight: 48,
              padding: "12px 20px",
              borderRadius: 12,
              border: `1px solid ${canConfirm ? t.danger : t.border}`,
              background: canConfirm ? t.danger : t.surfaceAlt,
              color: canConfirm ? "#fff" : t.textMuted,
              fontSize: 16,
              fontWeight: 600,
              cursor: canConfirm ? "pointer" : "not-allowed",
              ...fConfirm.style,
            }}
            onFocus={fConfirm.onFocus}
            onBlur={fConfirm.onBlur}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              minHeight: 48,
              padding: "12px 20px",
              borderRadius: 12,
              border: `1px solid ${t.border}`,
              background: t.surface,
              color: t.text,
              fontSize: 16,
              fontWeight: 600,
              cursor: deleting ? "not-allowed" : "pointer",
              ...fCancel.style,
            }}
            onFocus={fCancel.onFocus}
            onBlur={fCancel.onBlur}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Back button (mirrors SettingsScreen's SecondaryButton) ────────────────────
function BackButton({ onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.formBorder}`,
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: t.green100,
        color: t.text,
        ...f.style,
      }}
    >
      ← Back
    </button>
  );
}

export default function AccountSecurityScreen({ onBack, onAccountDeleted }) {
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 48px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: t.shadow.md,
  };

  return (
    <div style={page}>
      <div style={shell}>
        <BackButton onClick={onBack} />

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          Account &amp; security
        </h1>
        <p style={{ margin: "0 0 26px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
          Manage your sign-in details. Your dating profile lives on the Profile
          screen — this is just your account.
        </p>

        <div style={card}>
          <AccountSecuritySection />
        </div>

        {onAccountDeleted && (
          <div style={card}>
            <DeleteAccountSection onAccountDeleted={onAccountDeleted} />
          </div>
        )}
      </div>
    </div>
  );
}
