import { useState, useRef, useEffect } from "react";
import { register, login } from "./api.js";
import { t } from "./tokens.js";

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

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
  const [mode, setMode] = useState(initialMode === "register" ? "register" : "login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  // Move focus to the error when one appears so it's announced and reachable (M2).
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);
  const fEmail = useFocusable();
  const fPassword = useFocusable();
  const fSubmit = useFocusable();
  const fToggle = useFocusable();
  const fBack = useFocusable();

  useEffect(() => {
    headingRef.current?.focus();
  }, [mode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Email is required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      let data;
      if (mode === "register") {
        data = await register(email.trim().toLowerCase(), password);
      } else {
        data = await login(email.trim().toLowerCase(), password);
      }
      onAuth(data);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              borderRadius: 8,
              ...fBack.style,
            }}
          >
            ← Back
          </button>
        )}

        {/* Wordmark */}
        <div
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            color: t.text,
            letterSpacing: "-0.01em",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Spectrum
        </div>
        <p
          style={{
            textAlign: "center",
            color: t.textSoft,
            fontSize: 15,
            marginBottom: 32,
          }}
        >
          Dating at your own pace.
        </p>

        {/* Card */}
        <div
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 20,
            padding: "28px 24px",
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
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>

          <form onSubmit={handleSubmit} noValidate>
            {/* Error */}
            {error && (
              <div
                role="alert"
                ref={errorRef}
                tabIndex={-1}
                style={{
                  background: t.surfaceAlt,
                  border: `1px solid ${t.danger}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 14,
                  color: t.text,
                  marginBottom: 16,
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
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ ...inputStyle(false), ...fEmail.style }}
                onFocus={fEmail.onFocus}
                onBlur={fEmail.onBlur}
                aria-required="true"
                aria-invalid={error ? "true" : undefined}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label
                htmlFor="auth-password"
                style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ ...inputStyle(false), ...fPassword.style }}
                onFocus={fPassword.onFocus}
                onBlur={fPassword.onBlur}
                aria-required="true"
                aria-invalid={error ? "true" : undefined}
                aria-describedby={mode === "register" ? "pw-hint" : undefined}
              />
              {mode === "register" && (
                <span
                  id="pw-hint"
                  style={{ display: "block", fontSize: 13, color: t.textSoft, marginTop: 5 }}
                >
                  At least 8 characters.
                </span>
              )}
            </div>

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
                background: loading ? "#4E5F58" : t.accentStrong,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                ...fSubmit.style,
              }}
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        {/* Toggle mode */}
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 15, color: t.textSoft }}>
          {mode === "login" ? "New to Spectrum? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            {...fToggle}
            style={{
              background: "none",
              border: "none",
              color: t.accentStrong,  // was t.accent — #5B8A82 fails 4.5:1 AA
              fontSize: 15,
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

      </div>
    </div>
  );
}
