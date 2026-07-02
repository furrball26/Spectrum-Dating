import { useState, useRef, useEffect } from "react";
import { resetPassword, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";

// Shown when the app is opened with ?reset=TOKEN (from the password-reset email).
// Lets the user set a new password, then hands them back to sign-in.
export default function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const headingRef = useRef(null);
  const errorRef = useRef(null);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(safeErrorMessage(err, "This reset link is invalid or has expired."));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    fontSize: 16,
    border: `1px solid ${t.formBorder}`,
    borderRadius: 10,
    background: t.surface,
    color: t.text,
    boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: t.bgGradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
      <div style={{ width: "100%", maxWidth: t.layout.maxForm }}>
        <div style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, color: t.text, letterSpacing: "-0.01em", textAlign: "center", marginBottom: 32 }}>
          Spectrum
        </div>
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: "28px 24px" }}>
          <h1 ref={headingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text, margin: "0 0 20px", outline: "none" }}>
            {done ? "Password updated" : "Choose a new password"}
          </h1>

          {done ? (
            <div>
              <p role="status" style={{ margin: "0 0 20px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
                Your password has been reset. You can sign in with it now.
              </p>
              <button
                type="button"
                onClick={onDone}
                style={{ width: "100%", padding: "14px", minHeight: 52, background: t.accentFill, color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer" }}
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {error && (
                <div role="alert" ref={errorRef} tabIndex={-1} style={{ background: t.surfaceAlt, border: `1px solid ${t.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: t.text, marginBottom: 16 }}>
                  {error}
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="reset-pw" style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>New password</label>
                <input id="reset-pw" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} aria-required="true" aria-invalid={error ? "true" : undefined} aria-describedby="reset-pw-hint" />
                <span id="reset-pw-hint" style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 5 }}>At least 8 characters.</span>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label htmlFor="reset-confirm" style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>Confirm new password</label>
                <input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} aria-required="true" aria-invalid={error ? "true" : undefined} />
              </div>
              <button type="submit" disabled={loading} aria-busy={loading} style={{ width: "100%", padding: "14px", minHeight: 52, background: loading ? t.textMuted : t.accentFill, color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? "Please wait…" : "Reset password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
