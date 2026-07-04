import { useState, useRef, useEffect, useCallback } from "react";
import { t } from "./tokens.js";

// DiscoverFilters — F18. A calm, in-context filter sheet for the Discover
// screen. Lets people refine who they see (preferred age range, search radius,
// who they want to meet) without digging into the profile-edit form behind a
// global Save. These are real profile fields, so Apply persists them via
// updateProfile AND re-fetches the deck so results update immediately.
//
// Field keys/options/labels are copied verbatim from ProfileScreen.jsx so the
// two surfaces stay in lock-step:
//   seeking             — comma-joined string ("woman,man,nonbinary")
//   searchRadiusMiles   — number (0 | 25 | 50 | 100 | 250)
//   prefAgeMin/Max      — dual-handle AgeRangeSlider (18..99)

const AGE_SLIDER_MIN = 18;
const AGE_SLIDER_MAX = 99;

// ─── Dual-handle age-range slider (copied from ProfileScreen so Discover and
// the profile form share the exact same control without a cross-screen import) ─
function AgeRangeSlider({ low, high, onChange }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // "low" | "high" | null
  const [focusedThumb, setFocusedThumb] = useState(null);

  function pct(v) {
    return ((v - AGE_SLIDER_MIN) / (AGE_SLIDER_MAX - AGE_SLIDER_MIN)) * 100;
  }

  function valueFromClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return AGE_SLIDER_MIN;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(AGE_SLIDER_MIN + ratio * (AGE_SLIDER_MAX - AGE_SLIDER_MIN));
  }

  function handlePointerDown(e, which) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(which);
  }

  function handlePointerMove(e) {
    if (!dragging) return;
    const v = valueFromClientX(e.clientX);
    if (dragging === "low") {
      onChange(Math.max(AGE_SLIDER_MIN, Math.min(v, high - 1)), high);
    } else {
      onChange(low, Math.min(AGE_SLIDER_MAX, Math.max(v, low + 1)));
    }
  }

  function handlePointerUp() { setDragging(null); }

  function handleKeyDown(e, which) {
    let delta = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 1;
    if (!delta) return;
    e.preventDefault();
    if (which === "low") {
      onChange(Math.max(AGE_SLIDER_MIN, Math.min(low + delta, high - 1)), high);
    } else {
      onChange(low, Math.min(AGE_SLIDER_MAX, Math.max(high + delta, low + 1)));
    }
  }

  const THUMB = 26;
  function thumbStyle(which) {
    return {
      position: "absolute",
      top: "50%",
      left: `${pct(which === "low" ? low : high)}%`,
      transform: "translate(-50%, -50%)",
      width: THUMB,
      height: THUMB,
      borderRadius: "50%",
      background: t.accentFill,
      border: "3px solid #fff",
      boxShadow: t.shadow.sm,
      cursor: dragging === which ? "grabbing" : "grab",
      touchAction: "none",
      zIndex: which === dragging ? 3 : 2,
    };
  }
  const focusRingStyle = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

  return (
    <div style={{ padding: "4px 0 2px" }}>
      <div style={{
        textAlign: "center",
        fontFamily: t.serif,
        fontSize: 22,
        fontWeight: 700,
        color: t.text,
        marginBottom: 14,
        letterSpacing: "-0.3px",
      }}>
        {low}
        <span style={{ color: t.textSoft, fontWeight: 400, margin: "0 6px" }}>–</span>
        {high === AGE_SLIDER_MAX ? `${AGE_SLIDER_MAX}+` : high}
      </div>

      <div
        ref={trackRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ position: "relative", height: THUMB + 16, userSelect: "none", padding: "0 2px" }}
      >
        <div style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 6,
          borderRadius: 3,
          background: t.surfaceAlt,
          border: `1px solid ${t.border}`,
          transform: "translateY(-50%)",
        }} />
        <div style={{
          position: "absolute",
          top: "50%",
          left: `${pct(low)}%`,
          width: `${pct(high) - pct(low)}%`,
          height: 6,
          borderRadius: 3,
          background: t.accentFill,
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }} />
        <div
          role="slider"
          aria-label="Minimum age"
          aria-valuemin={AGE_SLIDER_MIN}
          aria-valuemax={high - 1}
          aria-valuenow={low}
          aria-valuetext={`${low} years`}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, "low")}
          onKeyDown={(e) => handleKeyDown(e, "low")}
          onFocus={() => setFocusedThumb("low")}
          onBlur={() => setFocusedThumb(null)}
          style={{ ...thumbStyle("low"), ...(focusedThumb === "low" ? focusRingStyle : {}) }}
        />
        <div
          role="slider"
          aria-label="Maximum age"
          aria-valuemin={low + 1}
          aria-valuemax={AGE_SLIDER_MAX}
          aria-valuenow={high}
          aria-valuetext={high === AGE_SLIDER_MAX ? `${AGE_SLIDER_MAX} and over` : `${high} years`}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, "high")}
          onKeyDown={(e) => handleKeyDown(e, "high")}
          onFocus={() => setFocusedThumb("high")}
          onBlur={() => setFocusedThumb(null)}
          style={{ ...thumbStyle("high"), ...(focusedThumb === "high" ? focusRingStyle : {}) }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMuted, marginTop: 2 }}>
        <span>{AGE_SLIDER_MIN}</span>
        <span>{AGE_SLIDER_MAX}+</span>
      </div>
    </div>
  );
}

const SEEKING_OPTIONS = [
  { value: "woman", label: "Women" },
  { value: "man", label: "Men" },
  { value: "nonbinary", label: "Nonbinary people" },
];

const RADIUS_OPTIONS = [
  { value: 0, label: "Anywhere" },
  { value: 25, label: "Within 25 miles" },
  { value: 50, label: "Within 50 miles" },
  { value: 100, label: "Within 100 miles" },
  { value: 250, label: "Within 250 miles" },
];

// Filters sheet. Pre-fills from `initial` (the current profile's filter fields).
// On Apply: persists only the changed fields via onApply(changed) then closes;
// the parent handles the deck re-fetch and loading state.
export default function DiscoverFilters({ initial, onApply, onClose, applying = false, plainLanguage = false }) {
  const headingRef = useRef(null);
  const sheetRef = useRef(null);
  // Remember what had focus before the sheet opened so we can restore it on close.
  const restoreFocusRef = useRef(null);

  const [prefAgeMin, setPrefAgeMin] = useState(initial.prefAgeMin ?? 18);
  const [prefAgeMax, setPrefAgeMax] = useState(initial.prefAgeMax ?? 99);
  const [searchRadius, setSearchRadius] = useState(initial.searchRadiusMiles ?? 0);
  const [seeking, setSeeking] = useState(initial.seeking || "");

  const hasLocation = !!(initial.distanceCity && String(initial.distanceCity).trim());

  // Focus the heading on open; restore focus to the opener on unmount.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    headingRef.current?.focus();
    return () => {
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, []);

  // Escape closes; Tab is trapped inside the sheet.
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const focusable = sheetRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const list = Array.from(focusable).filter((el) => !el.disabled && el.offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  const seekingSet = seeking.split(",").map((s) => s.trim()).filter(Boolean);

  function toggleSeeking(value) {
    const next = seekingSet.includes(value)
      ? seekingSet.filter((x) => x !== value)
      : [...seekingSet, value];
    setSeeking(next.join(","));
  }

  function handleReset() {
    setPrefAgeMin(18);
    setPrefAgeMax(99);
    setSearchRadius(0);
    setSeeking("");
  }

  function handleApply() {
    if (applying) return;
    // Only send fields that actually changed from what's on the profile.
    const changed = {};
    if ((initial.prefAgeMin ?? 18) !== prefAgeMin) changed.prefAgeMin = prefAgeMin;
    if ((initial.prefAgeMax ?? 99) !== prefAgeMax) changed.prefAgeMax = prefAgeMax;
    if ((initial.searchRadiusMiles ?? 0) !== searchRadius) changed.searchRadiusMiles = searchRadius;
    if ((initial.seeking || "") !== seeking) changed.seeking = seeking;
    onApply(changed);
  }

  const fieldset = { border: "none", margin: "0 0 22px", padding: 0 };
  const legend = { fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 6 };
  const helper = { display: "block", fontSize: 14, color: t.textSoft, marginTop: 6, lineHeight: 1.5 };
  const selectStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: `1.5px solid ${t.formBorder}`,
    borderRadius: 10,
    // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
    fontSize: 16,
    color: t.text,
    background: t.surface,
    fontFamily: t.sans,
    outline: "none",
    minHeight: 44,
    cursor: "pointer",
  };

  return (
    <>
      {/* Dim backdrop — clicking it closes */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(var(--c-scrimRgb, 36, 51, 45),0.45)",
          zIndex: 1200,
        }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discover-filters-heading"
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: t.surface,
          borderRadius: 20,
          padding: "26px 24px 24px",
          width: "min(92vw, 440px)",
          maxHeight: "88vh",
          overflowY: "auto",
          zIndex: 1201,
          boxShadow: t.shadow.lg,
          boxSizing: "border-box",
          fontFamily: t.sans,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <h2
            id="discover-filters-heading"
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              color: t.text,
              outline: "none",
            }}
          >
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            style={{
              background: "none",
              border: "none",
              color: t.textSoft,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              padding: "6px 8px",
              minHeight: 44,
              minWidth: 44,
              fontFamily: t.sans,
            }}
          >
            Close
          </button>
        </div>
        <p style={{ margin: "0 0 20px", color: t.textSoft, fontSize: 14, lineHeight: 1.6 }}>
          {plainLanguage
            ? "Change who you see. Your choices are saved to your profile."
            : "Refine who shows up in Discover. Your choices are saved to your profile and applied right away."}
        </p>

        {/* Who you want to meet */}
        <fieldset style={fieldset}>
          <legend style={legend}>Who you want to meet</legend>
          <span style={{ ...helper, marginTop: 0, marginBottom: 10 }}>
            Choose who you'd like to meet, or stay open to everyone.
          </span>
          {SEEKING_OPTIONS.map(({ value, label }) => {
            const checked = seekingSet.includes(value);
            return (
              <label
                key={value}
                htmlFor={`filter-seek-${value}`}
                style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer" }}
              >
                <input
                  id={`filter-seek-${value}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSeeking(value)}
                  style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
                />
                <span style={{ fontSize: 16, color: t.text }}>{label}</span>
              </label>
            );
          })}
          {/* D-16 — explicit "open to everyone" (empty-seeking) affordance. */}
          <label
            htmlFor="filter-seek-everyone"
            style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${t.borderLight}` }}
          >
            <input
              id="filter-seek-everyone"
              type="checkbox"
              checked={seekingSet.length === 0}
              onChange={() => { if (seekingSet.length > 0) setSeeking(""); }}
              style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
            />
            <span style={{ fontSize: 16, color: t.text }}>Open to everyone</span>
          </label>
        </fieldset>

        {/* Preferred age range */}
        <fieldset style={fieldset}>
          <legend style={{ ...legend, marginBottom: 2 }}>Age range</legend>
          <AgeRangeSlider
            low={prefAgeMin}
            high={prefAgeMax}
            onChange={(newLow, newHigh) => { setPrefAgeMin(newLow); setPrefAgeMax(newHigh); }}
          />
          <span style={helper}>Only show people in this age range.</span>
        </fieldset>

        {/* Search radius */}
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="filter-search-radius" style={legend}>Search radius</label>
          <select
            id="filter-search-radius"
            aria-describedby="filter-radius-help"
            value={searchRadius}
            onChange={(e) => setSearchRadius(Number(e.target.value))}
            onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
            onBlur={(e) => { e.target.style.outline = "none"; }}
            style={selectStyle}
          >
            {RADIUS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span id="filter-radius-help" style={helper}>
            {hasLocation
              ? "Only show people within this distance."
              : "Only show people within this distance. Add your location in your profile for this to apply — until then, radius has no effect."}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            style={{
              minHeight: 52,
              padding: "14px 24px",
              borderRadius: 14,
              border: `1px solid ${t.accentFill}`,
              background: t.accentFill,
              color: "#fff",
              fontSize: 17,
              fontWeight: 600,
              cursor: applying ? "wait" : "pointer",
              opacity: applying ? 0.75 : 1,
            }}
          >
            {applying ? "Updating…" : "Apply filters"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={applying}
            style={{
              minHeight: 44,
              padding: "10px 24px",
              borderRadius: 14,
              border: `1px solid ${t.border}`,
              background: t.surface,
              color: t.text,
              fontSize: 16,
              fontWeight: 600,
              cursor: applying ? "not-allowed" : "pointer",
            }}
          >
            Reset to open (everyone, anywhere)
          </button>
        </div>
      </div>
    </>
  );
}
