import { useState, useRef, useEffect } from "react";
import { updateProfile, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";
import { useViewport } from "./useViewport.js";

// ── Required-city gate ───────────────────────────────────────────────────────
// A parallel gate to onboarding for LEGACY members: someone who finished
// onboarding before the city field was required (so onboardingComplete is true
// but dist_city is blank). We can't do nearby matching without a coarse city,
// so this asks for it once before letting them back into the app. Onboarding
// itself already collects the city, so this only ever shows to those pre-city
// accounts — never during onboarding, never once a city is set.
//
// Deliberately ONE calm field (not a re-onboarding): the same "City / area"
// label, coarse-location hint, and validation copy as OnboardingScreen's Step 1,
// kept self-contained here so the gate is a small dedicated component. Required
// (no skip into the app) but never a trap — a quiet Sign out is always offered.

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

export default function RequireCityScreen({ onComplete, onSignOut }) {
  const [distCity, setDistCity] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef(null);
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const fSave = useFocusable();
  const fSignOut = useFocusable();

  // Focus the heading on mount so screen-reader users land on the gate's purpose.
  useEffect(() => { headingRef.current?.focus(); }, []);

  const cityError = !distCity.trim() ? "Please enter your city or area." : "";

  async function handleSave() {
    setAttempted(true);
    if (cityError) return;
    setSaving(true);
    setError("");
    try {
      // Backend coarsens + validates via coarseCity/isGeocodable, same PUT key
      // the onboarding step and profile editor use.
      await updateProfile({ distCity: distCity.trim() });
      onComplete();
    } catch (e) {
      setError(safeErrorMessage(e, "Couldn't save your city. Please try again."));
      setSaving(false);
    }
  }

  const page = {
    minHeight: "100vh",
    background: t.bg,
    display: "flex",
    alignItems: isMobile ? "flex-start" : "center",
    justifyContent: "center",
    padding: "32px 16px 60px",
    boxSizing: "border-box",
    fontFamily: t.sans,
    color: t.text,
  };

  const card = {
    width: "100%",
    maxWidth: 480,
    background: t.surface,
    borderRadius: 24,
    padding: "36px 28px",
    boxShadow: t.shadow.md,
  };

  return (
    <div style={page}>
      <div style={card}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 12px",
            color: t.text,
            lineHeight: 1.25,
            outline: "none",
          }}
        >
          Add your city
        </h1>
        <p style={{ fontSize: 16, color: t.textSoft, margin: "0 0 24px", lineHeight: 1.6 }}>
          Please add your city so we can show you people nearby. We only ever
          show a coarse location.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          noValidate
        >
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="require-dist-city"
              style={{ display: "block", fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}
            >
              City / area
              <span aria-hidden="true" style={{ color: t.danger, marginLeft: 3 }}>*</span>
            </label>
            <input
              id="require-dist-city"
              type="text"
              maxLength={100}
              aria-required="true"
              aria-describedby="require-dist-city-hint require-dist-city-error"
              aria-invalid={attempted && cityError ? "true" : undefined}
              value={distCity}
              onChange={(e) => setDistCity(e.target.value)}
              onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
              onBlur={(e) => { e.target.style.outline = "none"; }}
              style={inputStyle(attempted && !!cityError)}
              autoComplete="address-level2"
              placeholder="e.g. Portland, OR"
              autoFocus
            />
            <span
              id="require-dist-city-hint"
              style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}
            >
              Your general city or area — we only ever show a coarse location to
              others, never a precise address.
            </span>
            {attempted && cityError && (
              <span
                id="require-dist-city-error"
                role="alert"
                style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 4, fontWeight: 500 }}
              >
                {cityError}
              </span>
            )}
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 14, color: t.danger, margin: "0 0 16px", fontWeight: 500 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            {...fSave}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: t.accentFill,
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              ...fSave.style,
            }}
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </form>

        {/* Never a trap: a quiet exit is always available even though the city
            is required to enter the app. */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button
            type="button"
            onClick={onSignOut}
            {...fSignOut}
            style={{
              background: "none",
              border: "none",
              color: t.textSoft,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "underline",
              cursor: "pointer",
              padding: "8px 12px",
              borderRadius: 8,
              ...fSignOut.style,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
