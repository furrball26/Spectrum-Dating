import { useState, useRef, useEffect } from "react";
import { register, login, forgotPassword, resendVerification, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";
import SpectrumMark from "./SpectrumMark.jsx";
import { useFocusable } from "./useFocusable.js";


function inputStyle(hasError) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 14px",
    border: `1.5px solid ${hasError ? t.danger : t.formBorder}`,
    borderRadius: 10,
    fontSize: 16,
    color: t.text,
    background: t.surface,
  };
}

export default function AuthScreen({ onAuth, initialMode = "login", onBack }) {
  const [mode, setMode] = useState(initialMode === "register" ? "register" : "login"); // "login" | "register" | "forgot" | "check-email"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // D13 — split errors: field-level validation renders INLINE under the offending
  // field (calm, associated via aria-describedby); form-level errors (server
  // failures not tied to one field) render as a soft, non-alarming notice.
  const [fieldErrors, setFieldErrors] = useState({}); // { email?, password? }
  const [error, setError] = useState(""); // form-level only (server / generic)
  const [forgotSent, setForgotSent] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(null); // auth data held while on check-email screen
  const [resendStatus, setResendStatus] = useState("idle"); // 'idle' | 'sending' | 'sent' | 'error'
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  // Move focus to the offending field (inline error) or the form-level notice so
  // the problem is announced and reachable (M2 / D13).
  useEffect(() => {
    if (fieldErrors.email && emailRef.current) emailRef.current.focus();
    else if (fieldErrors.password && passwordRef.current) passwordRef.current.focus();
    else if (fieldErrors.confirmPassword && confirmPasswordRef.current) confirmPasswordRef.current.focus();
    else if (error && errorRef.current) errorRef.current.focus();
  }, [error, fieldErrors]);
  const fEmail = useFocusable();
  const fPassword = useFocusable();
  const fConfirm = useFocusable();
  const fSubmit = useFocusable();
  const fToggle = useFocusable();
  const fBack = useFocusable();

  useEffect(() => {
    headingRef.current?.focus();
  }, [mode]);

  // Keep document.title in sync with the auth subview. The app-level title effect
  // only tracks login/register, so the in-card toggle and the forgot-password /
  // check-email subviews would otherwise leave a stale title.
  useEffect(() => {
    let sub;
    if (mode === "check-email") sub = "Check your email";
    else if (mode === "forgot") sub = forgotSent ? "Check your email" : "Reset your password";
    else if (mode === "register") sub = "Create account";
    else sub = "Sign in";
    document.title = `${sub} · Spectrum`;
  }, [mode, forgotSent]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    if (!email.trim()) { setFieldErrors({ email: "Please enter your email." }); return; }

    // Forgot-password: request a reset link. Always show the same confirmation
    // (success or not) so we never reveal whether an email is registered.
    if (mode === "forgot") {
      setLoading(true);
      try { await forgotPassword(email.trim().toLowerCase()); } catch { /* ignore */ }
      setForgotSent(true);
      setLoading(false);
      return;
    }

    if (password.length < 8) { setFieldErrors({ password: "Password must be at least 8 characters." }); return; }
    // Sign-up requires confirming the password so a typo can't lock someone out
    // of the account they just created. Run alongside the strength check above.
    if (mode === "register") {
      if (!confirmPassword) { setFieldErrors({ confirmPassword: "Please confirm your password." }); return; }
      if (confirmPassword !== password) { setFieldErrors({ confirmPassword: "Passwords don't match." }); return; }
    }
    setLoading(true);
    try {
      let data;
      if (mode === "register") {
        data = await register(email.trim().toLowerCase(), password);
        // If email verification is configured, pause here and show the check-email
        // screen rather than immediately landing in the app. This gives the user a
        // clear handoff moment and avoids the "why is there a banner?" confusion.
        if (data.emailVerificationEnabled && !data.emailVerified) {
          setPendingAuth(data);
          setResendStatus("idle");
          setMode("check-email");
          return;
        }
      } else {
        data = await login(email.trim().toLowerCase(), password);
      }
      onAuth(data);
    } catch (err) {
      setError(safeErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendStatus("sending");
    try {
      await resendVerification();
      setResendStatus("sent");
    } catch {
      setResendStatus("error");
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setFieldErrors({});
    setForgotSent(false);
    // Never let a stale confirm value block a later login/reset submit.
    setConfirmPassword("");
  }

  // Live confirm-password feedback (sign-up only): once they've started typing a
  // confirmation, warn calmly the moment it diverges and clear it as they fix it.
  // The submit-time check writes fieldErrors.confirmPassword (empty / mismatch).
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const confirmErr = fieldErrors.confirmPassword || (confirmMismatch ? "Passwords don't match." : null);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bgGradient,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: t.layout.maxForm }}>

        {/* Back to landing page */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            {...fBack}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              marginBottom: 8,
              padding: "6px 10px",
              background: "none",
              border: "none",
              color: t.accentStrong,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              borderRadius: 8,
              ...fBack.style,
            }}
          >
            ← Back
          </button>
        )}

        {/* Brand lockup — same mark + wordmark as the landing page, so the
            trust-critical signup moment is unmistakably the same product. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <SpectrumMark height={24} />
          <span
            style={{
              fontFamily: t.serif,
              fontSize: 28,
              fontWeight: 700,
              color: t.text,
              letterSpacing: "-0.01em",
            }}
          >
            Spectrum
          </span>
        </div>
        <p
          style={{
            textAlign: "center",
            color: t.textSoft,
            fontSize: 16,
            marginBottom: 32,
          }}
        >
          Dating at your own pace.
        </p>

        {/* Card */}
        <div
          style={{
            background: t.surface,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 20,
            padding: "28px 24px",
            boxShadow: t.shadow.md,
          }}
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 20,
              fontWeight: 700,
              color: t.text,
              margin: "0 0 20px",
              outline: "none",
            }}
          >
            {mode === "login" ? "Welcome back"
              : mode === "forgot" ? "Reset your password"
              : mode === "check-email" ? "Check your inbox"
              : "Create your account"}
          </h1>

          {mode === "check-email" ? (
            <div>
              <p style={{ margin: "0 0 6px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
                We sent a verification link to{" "}
                <strong style={{ color: t.text }}>{email}</strong>.
                Click the link to confirm your account.
              </p>
              <p style={{ margin: "0 0 20px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
                Can't find it? Check your spam folder.
              </p>

              {/* Resend */}
              <div style={{ marginBottom: 16 }}>
                {resendStatus === "sent" ? (
                  <p role="status" style={{ fontSize: 14, color: t.positive, margin: 0 }}>
                    Sent — check your inbox again.
                  </p>
                ) : resendStatus === "error" ? (
                  <p role="alert" style={{ fontSize: 14, color: t.danger, margin: 0 }}>
                    Couldn't resend right now. Please try again.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendStatus === "sending"}
                    style={{
                      background: "none",
                      border: `1px solid ${t.border}`,
                      color: t.accentStrong,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: resendStatus === "sending" ? "wait" : "pointer",
                      padding: "8px 16px",
                      borderRadius: 8,
                      minHeight: 44,
                      opacity: resendStatus === "sending" ? 0.6 : 1,
                    }}
                  >
                    {resendStatus === "sending" ? "Sending…" : "Resend verification email"}
                  </button>
                )}
              </div>

              {/* Continue to app */}
              <button
                type="button"
                onClick={() => onAuth(pendingAuth)}
                style={{
                  width: "100%",
                  minHeight: 48,
                  borderRadius: 12,
                  background: t.accentFill,
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Continue to app →
              </button>
              <p style={{ marginTop: 12, fontSize: 14, color: t.textMuted, textAlign: "center", lineHeight: 1.5 }}>
                You can verify later — a reminder will appear at the top of the app.
              </p>
            </div>
          ) : mode === "forgot" && forgotSent ? (
            <div>
              <p role="status" style={{ margin: "0 0 20px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
                If an account exists for that email, we've sent a link to reset your
                password. Check your inbox — the link expires in 1 hour.
              </p>
              <button
                type="button"
                onClick={() => switchMode("login")}
                style={{ background: "none", border: "none", color: t.accentStrong, fontSize: 16, fontWeight: 600, cursor: "pointer", padding: "4px 2px", minHeight: 44, textDecoration: "underline" }}
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} noValidate>
            {mode === "forgot" && (
              <p style={{ margin: "0 0 16px", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
                Enter your email and we'll send you a link to set a new password.
              </p>
            )}
            {/* Form-level error (server failures not tied to one field). Kept
                calm — a soft left rule, not a full alarming red banner. D13. */}
            {error && (
              <div
                role="alert"
                ref={errorRef}
                tabIndex={-1}
                style={{
                  background: t.surfaceAlt,
                  borderLeft: `3px solid ${t.danger}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 14,
                  color: t.text,
                  marginBottom: 16,
                  outline: "none",
                }}
              >
                {error}
              </div>
            )}

            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="auth-email"
                style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}
              >
                Email
              </label>
              <input
                id="auth-email"
                ref={emailRef}
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }}
                style={{ ...inputStyle(!!fieldErrors.email), ...fEmail.style }}
                onFocus={fEmail.onFocus}
                onBlur={fEmail.onBlur}
                aria-required="true"
                aria-invalid={fieldErrors.email ? "true" : undefined}
                aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
              />
              {fieldErrors.email && (
                <span
                  id="auth-email-error"
                  role="alert"
                  style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 6 }}
                >
                  {fieldErrors.email}
                </span>
              )}
            </div>

            {/* Password */}
            {mode !== "forgot" && (
            <div style={{ marginBottom: 24 }}>
              <label
                htmlFor="auth-password"
                style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}
              >
                Password
              </label>
              <input
                id="auth-password"
                ref={passwordRef}
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={e => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined })); }}
                style={{ ...inputStyle(!!fieldErrors.password), ...fPassword.style }}
                onFocus={fPassword.onFocus}
                onBlur={fPassword.onBlur}
                aria-required="true"
                aria-invalid={fieldErrors.password ? "true" : undefined}
                aria-describedby={[
                  mode === "register" ? "pw-hint" : null,
                  fieldErrors.password ? "auth-password-error" : null,
                ].filter(Boolean).join(" ") || undefined}
              />
              {fieldErrors.password && (
                <span
                  id="auth-password-error"
                  role="alert"
                  style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 6 }}
                >
                  {fieldErrors.password}
                </span>
              )}
              {mode === "register" && (
                <span
                  id="pw-hint"
                  style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 5 }}
                >
                  At least 8 characters.
                </span>
              )}
            </div>
            )}

            {/* Confirm password (sign-up only) — a typo'd password would otherwise
                lock someone out of the account they just made. */}
            {mode === "register" && (
            <div style={{ marginBottom: 24 }}>
              <label
                htmlFor="auth-confirm-password"
                style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}
              >
                Confirm password
              </label>
              <input
                id="auth-confirm-password"
                ref={confirmPasswordRef}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: undefined })); }}
                style={{ ...inputStyle(!!confirmErr), ...fConfirm.style }}
                onFocus={fConfirm.onFocus}
                onBlur={fConfirm.onBlur}
                aria-required="true"
                aria-invalid={confirmErr ? "true" : undefined}
                aria-describedby={confirmErr ? "auth-confirm-password-error" : undefined}
              />
              {confirmErr && (
                <span
                  id="auth-confirm-password-error"
                  role="alert"
                  style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 6 }}
                >
                  {confirmErr}
                </span>
              )}
            </div>
            )}

            {/* Forgot password link (login only) */}
            {mode === "login" && (
              <div style={{ marginTop: -8, marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  style={{ background: "none", border: "none", color: t.accentStrong, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "4px 2px", minHeight: 44, textDecoration: "underline" }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              {...fSubmit}
              style={{
                width: "100%",
                padding: "14px",
                minHeight: 52,
                background: loading ? "#4E5F58" : t.accentFill,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                ...fSubmit.style,
              }}
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : mode === "forgot" ? "Send reset link" : "Create account"}
            </button>
          </form>
          )}
        </div>

        {/* Toggle mode — hidden in forgot mode (its own back link is in the card) */}
        {mode !== "forgot" && (
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 16, color: t.textSoft }}>
          {mode === "login" ? "New to Spectrum? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => switchMode(mode === "login" ? "register" : "login")}
            {...fToggle}
            style={{
              background: "none",
              border: "none",
              color: t.accentStrong,  // was t.accent — #5B8A82 fails 4.5:1 AA
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              padding: "4px 2px",
              minHeight: 44,
              textDecoration: "underline",
              ...fToggle.style,
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
        )}

        {/* Quiet trust line — factual, no urgency. */}
        <p style={{ textAlign: "center", marginTop: 14, fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
          We'll never share your email or show it to other members.{" "}
          <a
            href="/privacy.html"
            style={{ color: t.accentStrong, fontWeight: 600, textUnderlineOffset: 3 }}
          >
            Privacy Policy
          </a>
        </p>

      </div>
    </div>
  );
}
