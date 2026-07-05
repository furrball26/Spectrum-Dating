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

// ─── Advanced (Companion) filter options — MONETIZATION_STRATEGY §5 #3 ──────────
// Each facet's values mirror the backend allowlist (server/src/matching/
// advancedFilters.js) exactly, with a "No preference" ("") default. These are
// POST-SCORE re-rank preferences: they gently prioritize who you see, never hide
// anyone — so the copy stays honest and calm. Labels reuse the Discover card's
// wording ("Direct", "Quiet settings", …) so the two surfaces read consistently.
const ADV_COMM_OPTIONS = [
  {
    key: "commDirectness",
    label: "How direct",
    options: [
      { value: "", label: "No preference" },
      { value: "direct", label: "Direct" },
      { value: "softened", label: "Gentler, softened" },
    ],
  },
  {
    key: "commLiteral",
    label: "Literal or playful",
    options: [
      { value: "", label: "No preference" },
      { value: "literal", label: "Literal" },
      { value: "playful", label: "Playful, figurative" },
    ],
  },
  {
    key: "commCadence",
    label: "Reply rhythm",
    options: [
      { value: "", label: "No preference" },
      { value: "instant", label: "Quick back-and-forth" },
      { value: "daily", label: "About once a day" },
      { value: "whenever", label: "Whenever it suits" },
    ],
  },
];

const ADV_SENSORY_OPTIONS = [
  {
    key: "sensoryEnvironment",
    label: "Preferred setting",
    options: [
      { value: "", label: "No preference" },
      { value: "quiet", label: "Quiet settings" },
      { value: "lively", label: "Lively settings" },
    ],
  },
  {
    key: "sensoryLighting",
    label: "Preferred lighting",
    options: [
      { value: "", label: "No preference" },
      { value: "dim", label: "Dim lighting" },
      { value: "bright", label: "Bright lighting" },
    ],
  },
];

// Filters sheet. Pre-fills from `initial` (the current profile's filter fields).
// On Apply: persists only the changed fields via onApply(changed) then closes;
// the parent handles the deck re-fetch and loading state.
export default function DiscoverFilters({
  initial,
  onApply,
  onClose,
  applying = false,
  plainLanguage = false,
  // Advanced (Companion) deeper-compatibility filters — MONETIZATION_STRATEGY §5
  // #3. `tier` drives the lock state (UX only; the backend PUT is authoritative).
  // `advancedInitial` seeds the saved set; onSaveAdvanced/onClearAdvanced persist
  // + re-fetch the deck; onUpgrade routes a free member to the Membership screen.
  tier = "free",
  advancedInitial = {},
  onSaveAdvanced,
  onClearAdvanced,
  onUpgrade,
  advApplying = false,
}) {
  const headingRef = useRef(null);
  const sheetRef = useRef(null);
  // Remember what had focus before the sheet opened so we can restore it on close.
  const restoreFocusRef = useRef(null);

  const [prefAgeMin, setPrefAgeMin] = useState(initial.prefAgeMin ?? 18);
  const [prefAgeMax, setPrefAgeMax] = useState(initial.prefAgeMax ?? 99);
  const [searchRadius, setSearchRadius] = useState(initial.searchRadiusMiles ?? 0);
  const [seeking, setSeeking] = useState(initial.seeking || "");

  // Advanced facet state — one string per facet ("" = No preference) + the
  // shared-interests toggle. Seeded from the saved set. All hooks stay above any
  // early return (React #310) — this component never early-returns before them.
  const [adv, setAdv] = useState(() => ({
    commDirectness: advancedInitial.commDirectness || "",
    commLiteral: advancedInitial.commLiteral || "",
    commCadence: advancedInitial.commCadence || "",
    sensoryEnvironment: advancedInitial.sensoryEnvironment || "",
    sensoryLighting: advancedInitial.sensoryLighting || "",
    prioritizeSharedInterests: !!advancedInitial.prioritizeSharedInterests,
  }));

  const isCompanion = tier === "companion";
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

  // Build the advanced-filter object from state, keeping only set facets + a true
  // toggle (matches the backend's minimal shape). Then persist + re-fetch via the
  // parent; a free member is routed to Upgrade instead (the lock is UX only).
  function handleSaveAdvanced() {
    if (advApplying) return;
    if (!isCompanion) { onUpgrade?.(); return; }
    const obj = {};
    for (const key of ["commDirectness", "commLiteral", "commCadence", "sensoryEnvironment", "sensoryLighting"]) {
      if (adv[key]) obj[key] = adv[key];
    }
    if (adv.prioritizeSharedInterests) obj.prioritizeSharedInterests = true;
    onSaveAdvanced?.(obj);
  }

  function handleClearAdvanced() {
    if (advApplying) return;
    setAdv({
      commDirectness: "",
      commLiteral: "",
      commCadence: "",
      sensoryEnvironment: "",
      sensoryLighting: "",
      prioritizeSharedInterests: false,
    });
    onClearAdvanced?.();
  }

  function setAdvFacet(key, value) {
    setAdv((prev) => ({ ...prev, [key]: value }));
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
          {/* D-16 — "open to everyone" is the empty-seeking STATE, not a 4th
              co-equal option. Pulled out of the checkbox column (it used to sit
              as a peer checkbox whose "checked" inverted the set, which read as a
              contradictory option) into a plain-language helper line plus a quiet
              text button that simply clears the picks. Behaviour is unchanged:
              leaving all unticked == open to everyone. */}
          <div style={{ marginTop: 6, paddingTop: 10, borderTop: `1px solid ${t.borderLight}` }}>
            <span style={{ ...helper, marginTop: 0 }}>
              Leaving all unticked means you're open to everyone.
            </span>
            {seekingSet.length > 0 && (
              <button
                type="button"
                onClick={() => setSeeking("")}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginTop: 6,
                  minHeight: 44,
                  padding: "6px 2px",
                  background: "none",
                  border: "none",
                  color: t.accentStrong,
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: t.sans,
                  cursor: "pointer",
                }}
              >
                Clear — open to everyone
              </button>
            )}
          </div>
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
              // t.cardBorder (not t.border): on white the hairline read ~1.3:1
              // and effectively vanished (WCAG 1.4.11 non-text contrast).
              border: `1px solid ${t.cardBorder}`,
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

        {/* ─── Advanced filters · Companion (MONETIZATION_STRATEGY §5 #3) ─────
            A post-score RE-RANK, never a wall: these gently prioritize who you
            see, and never hide anyone. Companion members get functional controls
            + Save/Clear; free members get the calm locked state + an Upgrade link
            (the lock is UX only — the backend PUT is the real gate). */}
        <div style={{ borderTop: `1px solid ${t.border}`, margin: "26px 0 0", paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontFamily: t.serif, fontSize: 18, fontWeight: 700, color: t.text }}>
              Advanced filters
            </h3>
            <span
              style={{
                display: "inline-block",
                padding: "2px 10px",
                borderRadius: 20,
                background: t.surfaceAlt,
                color: t.textSoft,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                border: `1px solid ${t.borderLight}`,
              }}
            >
              Companion
            </span>
          </div>

          {isCompanion ? (
            <>
              <p style={{ margin: "0 0 18px", color: t.textSoft, fontSize: 14, lineHeight: 1.6 }}>
                These gently prioritize who you see — they never hide people entirely.
              </p>

              <fieldset style={fieldset}>
                <legend style={legend}>Preferred communication style</legend>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
                  {ADV_COMM_OPTIONS.map(({ key, label, options }) => (
                    <div key={key}>
                      <label htmlFor={`adv-${key}`} style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 6 }}>
                        {label}
                      </label>
                      <select
                        id={`adv-${key}`}
                        value={adv[key]}
                        onChange={(e) => setAdvFacet(key, e.target.value)}
                        onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                        onBlur={(e) => { e.target.style.outline = "none"; }}
                        style={selectStyle}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset style={fieldset}>
                <legend style={legend}>Preferred sensory environment</legend>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
                  {ADV_SENSORY_OPTIONS.map(({ key, label, options }) => (
                    <div key={key}>
                      <label htmlFor={`adv-${key}`} style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 6 }}>
                        {label}
                      </label>
                      <select
                        id={`adv-${key}`}
                        value={adv[key]}
                        onChange={(e) => setAdvFacet(key, e.target.value)}
                        onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                        onBlur={(e) => { e.target.style.outline = "none"; }}
                        style={selectStyle}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset style={{ ...fieldset, marginBottom: 20 }}>
                <legend style={legend}>Special interests</legend>
                <label
                  htmlFor="adv-prioritize-interests"
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 40, cursor: "pointer", marginTop: 8 }}
                >
                  <input
                    id="adv-prioritize-interests"
                    type="checkbox"
                    checked={adv.prioritizeSharedInterests}
                    onChange={(e) => setAdvFacet("prioritizeSharedInterests", e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0, marginTop: 3 }}
                  />
                  <span style={{ fontSize: 16, color: t.text, lineHeight: 1.5 }}>
                    Prioritize people who share my special interests
                  </span>
                </label>
              </fieldset>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleSaveAdvanced}
                  disabled={advApplying}
                  style={{
                    minHeight: 52,
                    padding: "14px 24px",
                    borderRadius: 14,
                    border: `1px solid ${t.accentFill}`,
                    background: t.accentFill,
                    color: "#fff",
                    fontSize: 17,
                    fontWeight: 600,
                    cursor: advApplying ? "wait" : "pointer",
                    opacity: advApplying ? 0.75 : 1,
                  }}
                >
                  {advApplying ? "Updating…" : "Save advanced filters"}
                </button>
                <button
                  type="button"
                  onClick={handleClearAdvanced}
                  disabled={advApplying}
                  style={{
                    minHeight: 44,
                    padding: "10px 24px",
                    borderRadius: 14,
                    // t.cardBorder for the same WCAG 1.4.11 reason as Reset above.
                    border: `1px solid ${t.cardBorder}`,
                    background: t.surface,
                    color: t.text,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: advApplying ? "not-allowed" : "pointer",
                  }}
                >
                  Clear advanced filters
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                marginTop: 10,
                background: t.surfaceAlt,
                border: `1px solid ${t.borderLight}`,
                borderRadius: 14,
                padding: "16px 18px",
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 15, color: t.text, fontWeight: 600, lineHeight: 1.5 }}>
                Advanced filters are part of Spectrum Companion
              </p>
              <p style={{ margin: "0 0 6px", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
                Gently prioritize who you see by communication style, sensory
                environment, and shared special interests. They never hide anyone —
                your base filters (age, distance, who you want to meet) always stay free.
              </p>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>
                No rush, no pressure. Companion only ever adds comfort on top.
              </p>
              <button
                type="button"
                onClick={() => onUpgrade?.()}
                style={{
                  minHeight: 44,
                  padding: "11px 20px",
                  borderRadius: 11,
                  border: `1px solid ${t.accentStrong}`,
                  background: "transparent",
                  color: t.accentStrong,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                See what Companion adds
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
