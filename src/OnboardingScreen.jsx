import { useState, useEffect, useRef } from "react";
import { updateProfile, safeErrorMessage, uploadProfilePhoto, validateProfilePhotoFile, PROFILE_PHOTO_MIME_ALLOWLIST } from "./api.js";
import { t } from "./tokens.js";
import Spectrum from "./Spectrum.jsx";
import { useFocusable, focusRing } from "./useFocusable.js";
import { useViewport } from "./useViewport.js";
import { GenderField, OrientationField, RelationshipStructureField, GENDER_SELF_DESCRIBE } from "./IdentityFields.jsx";
import SpecialInterestsInput from "./SpecialInterestsInput.jsx";
import { normalizeSpecialInterests } from "./specialInterests.js";
import { ShieldIcon } from "./icons.jsx";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// ─── Save & resume (draft persistence) ──────────────────────────────────────────
// The 6-step flow keeps every answer in component state, so closing the tab or
// navigating away used to LOSE everything — a real bounce trigger for an anxious
// user. We persist the TEXT/choice fields + the current step to a single JSON
// snapshot in localStorage and re-hydrate on mount so returning resumes where
// they left off. Photos are NOT persisted here — they're uploaded to the backend
// (pending_review) during the photo step, so they survive server-side. The draft
// is CLEARED on successful completion so a completed/cleared draft never
// re-hydrates stale answers onto a fresh signup on the same device.
const ONBOARDING_DRAFT_KEY = "spectrum_onboarding_draft";

function readOnboardingDraft() {
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // localStorage unavailable (private mode) or corrupt JSON — start fresh.
    return {};
  }
}

function clearOnboardingDraft() {
  try {
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // non-fatal
  }
}

// Photos are never restored from the draft (they live server-side, not in this
// snapshot), so never resume PAST the required photo step into a state where the
// user appears to have no photo. Clamp a saved step beyond photos (step 3) back
// to the photo step; all text fields are still restored, so they only re-confirm
// a photo. Anything out of the 1..6 range falls back to step 1.
function resumeStep(saved) {
  const s = Number(saved);
  if (!Number.isFinite(s) || s < 1) return 1;
  return s > 3 ? 3 : s;
}


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

// ─── Date-of-birth helpers (run client-side, in the browser) ────────────────────

// The latest DOB that still makes someone 18 today, as 'YYYY-MM-DD'.
function maxDobToday() {
  const now = new Date();
  const y = now.getFullYear() - 18;
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Whole years between a 'YYYY-MM-DD' string and today. Returns null if unparseable.
function ageFromDob(dob) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const birth = new Date(y, m - 1, d);
  if (
    birth.getFullYear() !== y ||
    birth.getMonth() !== m - 1 ||
    birth.getDate() !== d
  ) {
    return null; // e.g. 2020-02-31
  }
  const now = new Date();
  let age = now.getFullYear() - y;
  const hadBirthday =
    now.getMonth() > m - 1 ||
    (now.getMonth() === m - 1 && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

const SUGGESTED_INTERESTS = [
  "board games", "hiking", "baking", "reading", "cycling", "music",
  "cooking", "films", "photography", "gaming", "gardening", "crafts",
  "nature", "writing", "volunteering", "cats", "dogs", "travel",
  "history", "science", "art", "spreadsheets", "libraries",
  "birdwatching", "bookbinding", "quiet evenings",
];

// ─── Shared input style ─────────────────────────────────────────────────────────
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

// ─── Field sub-components ──────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children, required }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontWeight: 600,
        fontSize: 16,
        color: t.text,
        marginBottom: 4,
      }}
    >
      {children}
      {required && (
        <span aria-hidden="true" style={{ color: t.danger, marginLeft: 3 }}>*</span>
      )}
    </label>
  );
}

function HelperText({ id, children }) {
  return (
    <span
      id={id}
      style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}
    >
      {children}
    </span>
  );
}

function InlineError({ id, children }) {
  if (!children) return null;
  return (
    <span
      id={id}
      role="alert"
      style={{
        display: "block",
        fontSize: 14,
        color: t.danger,
        marginTop: 4,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

// ─── Calm labelled dropdown (mirrors ProfileScreen's LifestyleSelect) ──────────
function LabelledSelect({ id, label, helper, value, options, onChange }) {
  const f = useFocusable();
  return (
    <div style={{ marginBottom: 20 }}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        value={value}
        aria-describedby={helper ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        {...f}
        style={{
          ...inputStyle(false),
          minHeight: 44,
          appearance: "auto",
          cursor: "pointer",
          ...f.style,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {helper && <HelperText id={`${id}-hint`}>{helper}</HelperText>}
    </div>
  );
}

// ─── Dual-handle age-range slider (mirrors ProfileScreen's AgeRangeSlider) ──────
const AGE_SLIDER_MIN = 18;
const AGE_SLIDER_MAX = 99;

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
    if (e.key === "ArrowLeft"  || e.key === "ArrowDown") delta = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp")   delta =  1;
    if (!delta) return;
    e.preventDefault();
    if (which === "low") {
      onChange(Math.max(AGE_SLIDER_MIN, Math.min(low + delta, high - 1)), high);
    } else {
      onChange(low, Math.min(AGE_SLIDER_MAX, Math.max(high + delta, low + 1)));
    }
  }

  const THUMB = 26; // visible knob — kept small for a calm look
  const HIT = 44;   // WCAG 2.5.5 — actionable area is a ≥44×44 transparent wrapper
  function thumbStyle(which) {
    return {
      position: "absolute",
      top: "50%",
      left: `${pct(which === "low" ? low : high)}%`,
      transform: "translate(-50%, -50%)",
      width: HIT,
      height: HIT,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "50%",
      background: "transparent",
      cursor: dragging === which ? "grabbing" : "grab",
      touchAction: "none",
      zIndex: which === dragging ? 3 : 2,
    };
  }
  // The visible knob sits inside the 44px hit area; the focus ring hugs it (not
  // the larger transparent target) so the indicator stays tight and calm.
  function knobStyle(focused) {
    return {
      width: THUMB,
      height: THUMB,
      borderRadius: "50%",
      background: t.accentFill,
      border: "3px solid #fff",
      boxShadow: t.shadow.sm,
      pointerEvents: "none",
      ...(focused ? focusRing : {}),
    };
  }

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
          style={thumbStyle("low")}
        >
          <span aria-hidden="true" style={knobStyle(focusedThumb === "low")} />
        </div>

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
          style={thumbStyle("high")}
        >
          <span aria-hidden="true" style={knobStyle(focusedThumb === "high")} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMuted, marginTop: 2 }}>
        <span>{AGE_SLIDER_MIN}</span>
        <span>{AGE_SLIDER_MAX}+</span>
      </div>
    </div>
  );
}

// ─── Interest chip components ──────────────────────────────────────────────────

function SuggestionChip({ tag, selected, onToggle, prefersReduced }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={selected ? `${tag} — selected` : tag}
      onClick={() => onToggle(tag)}
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: "8px 14px",
        borderRadius: 24,
        border: `1.5px solid ${selected ? t.accentFill : t.formBorder}`,
        background: selected ? t.accentFill : t.surfaceAlt,
        color: selected ? "#fff" : t.textSoft,
        fontSize: 14,
        fontWeight: selected ? 600 : 400,
        cursor: "pointer",
        transition: prefersReduced ? "none" : "background 120ms ease, color 120ms ease",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {tag}
    </button>
  );
}

function RemoveChipButton({ tag, onRemove }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-label={`Remove ${tag}`}
      onClick={() => onRemove(tag)}
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: "10px 12px",
        background: "transparent",
        border: "none",
        color: "#fff",
        fontSize: 14,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 20,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      ✕
    </button>
  );
}

// ─── Step 1: Basics ────────────────────────────────────────────────────────────

function Step1({ displayName, setDisplayName, tagline, setTagline, dateOfBirth, setDateOfBirth, distCity, setDistCity, errors, attempted }) {
  const plain = usePlainLanguage();
  const [nameTouched, setNameTouched] = useState(false);
  const maxDob = maxDobToday();

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <FieldLabel htmlFor="ob-display-name" required>Display name</FieldLabel>
        <input
          id="ob-display-name"
          type="text"
          maxLength={30}
          aria-required="true"
          aria-describedby="ob-display-name-hint ob-display-name-error"
          aria-invalid={attempted && errors.displayName ? "true" : undefined}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setNameTouched(true);
          }}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={inputStyle(attempted && !!errors.displayName)}
          autoComplete="name"
          autoFocus
        />
        <HelperText id="ob-display-name-hint">{plain ? "Up to 30 letters. This is the name others see." : "Up to 30 characters. Shown as your name to matches."}</HelperText>
        <div
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
        >
          {nameTouched ? `${30 - displayName.length} remaining` : ""}
        </div>
        <InlineError id="ob-display-name-error">{attempted ? errors.displayName : ""}</InlineError>
      </div>

      <div style={{ marginBottom: 20 }}>
        <FieldLabel htmlFor="ob-tagline">Tagline</FieldLabel>
        <input
          id="ob-tagline"
          type="text"
          maxLength={80}
          aria-describedby="ob-tagline-hint"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={inputStyle(false)}
          placeholder=""
        />
        <HelperText id="ob-tagline-hint">{plain ? "One short line about you." : "One line that tells people what you’re about"}</HelperText>
      </div>

      <div style={{ marginBottom: 20 }}>
        <FieldLabel htmlFor="ob-dob" required>Date of birth</FieldLabel>
        <input
          id="ob-dob"
          type="date"
          max={maxDob}
          aria-required="true"
          aria-describedby="ob-dob-hint ob-dob-error"
          aria-invalid={attempted && errors.dateOfBirth ? "true" : undefined}
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={{ ...inputStyle(attempted && !!errors.dateOfBirth), minHeight: 44 }}
        />
        <HelperText id="ob-dob-hint">{plain ? "You must be 18 or older." : "You must be 18 or older to use Spectrum Dating."}</HelperText>
        <InlineError id="ob-dob-error">{attempted ? errors.dateOfBirth : ""}</InlineError>
      </div>

      <div>
        <FieldLabel htmlFor="ob-dist-city" required>City / area</FieldLabel>
        <input
          id="ob-dist-city"
          type="text"
          maxLength={100}
          aria-required="true"
          aria-describedby="ob-dist-city-hint ob-dist-city-error"
          aria-invalid={attempted && errors.distCity ? "true" : undefined}
          value={distCity}
          onChange={(e) => setDistCity(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={inputStyle(attempted && !!errors.distCity)}
          autoComplete="address-level2"
          placeholder="e.g. Portland, OR"
        />
        <HelperText id="ob-dist-city-hint">
          {plain
            ? "Your city or area only. We never show your exact address."
            : "Your general city or area — we only ever show a coarse location to others, never a precise address."}
        </HelperText>
        <InlineError id="ob-dist-city-error">{attempted ? errors.distCity : ""}</InlineError>
      </div>
    </>
  );
}

// ─── Step 2: Bio + Interests ───────────────────────────────────────────────────

function Step2({ bio, setBio, interests, setInterests, errors, attempted, prefersReduced }) {
  const plain = usePlainLanguage();
  const [bioTouched, setBioTouched] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const addInputRef = useRef(null);

  function announce(msg) {
    setAnnouncement(msg);
    setTimeout(() => setAnnouncement(""), 300);
  }

  function toggleInterest(tag) {
    setInterests((prev) => {
      if (prev.includes(tag)) {
        announce(`Removed: ${tag}`);
        return prev.filter((i) => i !== tag);
      }
      announce(`Added: ${tag}`);
      return [...prev, tag];
    });
  }

  function removeInterest(tag) {
    announce(`Removed: ${tag}`);
    setInterests((prev) => prev.filter((i) => i !== tag));
  }

  function handleAddCustom() {
    const val = customInput.trim().toLowerCase();
    if (!val) return;
    if (interests.includes(val)) return;
    announce(`Added: ${val}`);
    setInterests((prev) => [...prev, val]);
    setCustomInput("");
  }

  const f = useFocusable();

  return (
    <>
      {/* SR announcement */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
      >
        {announcement}
      </div>

      {/* Bio */}
      <div style={{ marginBottom: 24 }}>
        <FieldLabel htmlFor="ob-bio" required>Bio</FieldLabel>
        <textarea
          id="ob-bio"
          maxLength={500}
          rows={5}
          aria-required="true"
          aria-describedby="ob-bio-hint ob-bio-counter ob-bio-error"
          aria-invalid={attempted && errors.bio ? "true" : undefined}
          value={bio}
          onChange={(e) => { setBio(e.target.value); setBioTouched(true); }}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={{
            ...inputStyle(attempted && !!errors.bio),
            resize: "vertical",
            minHeight: 100,
            lineHeight: 1.55,
          }}
          placeholder=""
        />
        <HelperText id="ob-bio-hint">{plain ? "At least 20 letters, up to 500." : "Minimum 20 characters, up to 500."}</HelperText>
        <div
          role="status"
          aria-live="polite"
          id="ob-bio-counter"
          style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
        >
          {bioTouched ? `${500 - bio.length} remaining` : ""}
        </div>
        <InlineError id="ob-bio-error">{attempted ? errors.bio : ""}</InlineError>
      </div>

      {/* Interests */}
      <div>
        <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 16, color: t.text }}>
          Interests <span aria-hidden="true" style={{ color: t.danger, marginLeft: 3 }}>*</span>
        </p>
        <p id="ob-interests-hint" style={{ margin: "0 0 12px", fontSize: 14, color: t.textSoft }}>
          {plain
            ? "Pick at least one."
            : "Pick at least one — these help us find people you'll connect with."}
        </p>

        {/* Selected chips */}
        {interests.length > 0 && (
          <ul
            role="list"
            aria-label="Your selected interests"
            style={{
              listStyle: "none",
              margin: "0 0 16px",
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {interests.map((tag) => (
              <li key={tag} role="listitem">
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: t.accentFill,
                    color: "#fff",
                    borderRadius: 24,
                    padding: "4px 4px 4px 12px",
                    fontSize: 14,
                    fontWeight: 500,
                    transition: prefersReduced ? "none" : "opacity 150ms ease",
                  }}
                >
                  <span aria-hidden="true">{tag}</span>
                  <RemoveChipButton tag={tag} onRemove={removeInterest} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Suggestion chips */}
        <div
          role="group"
          aria-labelledby="ob-suggestions-heading"
          style={{ marginBottom: 16 }}
        >
          {/* h2 (not h3): the step title is the page's h1, so the interests
              subsection heading must be h2 — an h3 here skips a level (WCAG
              1.3.1 / heading order). Visual size unchanged via inline styling. */}
          <h2
            id="ob-suggestions-heading"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: t.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 10px",
            }}
          >
            Suggested
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUGGESTED_INTERESTS.map((tag) => (
              <SuggestionChip
                key={tag}
                tag={tag}
                selected={interests.includes(tag)}
                onToggle={toggleInterest}
                prefersReduced={prefersReduced}
              />
            ))}
          </div>
        </div>

        {/* Custom tag entry */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <label
              htmlFor="ob-custom-tag"
              style={{ display: "block", fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}
            >
              Add your own
            </label>
            <input
              ref={addInputRef}
              id="ob-custom-tag"
              type="text"
              maxLength={30}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCustom(); } }}
              onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
              onBlur={(e) => { e.target.style.outline = "none"; }}
              style={inputStyle(false)}
              placeholder="Type an interest, then press Add"
            />
          </div>
          <button
            type="button"
            aria-label="Add interest"
            onClick={handleAddCustom}
            {...f}
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: "10px 16px",
              borderRadius: 10,
              border: `1.5px solid ${t.accentStrong}`,
              background: t.surface,
              color: t.accentStrong,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              alignSelf: "flex-end",
              flexShrink: 0,
              ...f.style,
            }}
          >
            Add
          </button>
        </div>

        <InlineError id="ob-interests-error">{attempted ? errors.interests : ""}</InlineError>
      </div>
    </>
  );
}

// ─── Photo step: at least one photo required to finish onboarding ──────────────

const ONBOARDING_MAX_PHOTOS = 6;
const PHOTO_ACCEPT = PROFILE_PHOTO_MIME_ALLOWLIST.join(",");

// Keyboard-accessible add-photo control. Mirrors ProfileScreen's AddPhotoTile
// (hidden file input driven by a real <button>, focus ring via useFocusable).
function OnboardAddPhotoTile({ onAdd, uploading, disabled, invalid, tileRef }) {
  const fileRef = useRef(null);
  const f = useFocusable();
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        type="button"
        id="ob-add-photo-tile"
        ref={tileRef}
        onClick={() => fileRef.current?.click()}
        disabled={uploading || disabled}
        aria-label="Add photo"
        aria-busy={uploading}
        aria-invalid={invalid ? "true" : undefined}
        {...f}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          border: `2px dashed ${invalid ? t.danger : t.accentStrong}`,
          background: t.surfaceAlt,
          color: t.accentStrong,
          fontSize: 14,
          fontWeight: 600,
          cursor: uploading || disabled ? "wait" : "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          opacity: uploading || disabled ? 0.7 : 1,
          ...f.style,
        }}
      >
        {uploading ? (
          "Uploading…"
        ) : (
          <>
            <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1 }}>+</span>
            <span>Add photo</span>
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAdd(file);
          e.target.value = ""; // reset so the same file can be re-selected
        }}
      />
    </div>
  );
}

function StepPhotos({ photos, uploading, uploadError, onAdd, tileRef, errors, attempted }) {
  const plain = usePlainLanguage();
  const atMax = photos.length >= ONBOARDING_MAX_PHOTOS;
  const gateError = attempted ? errors.photos : "";
  return (
    <>
      <p style={{ margin: "0 0 8px", fontSize: 16, color: t.text, lineHeight: 1.55, fontWeight: 600 }}>
        {plain ? "Add a photo " : "Add at least one photo "}<span aria-hidden="true" style={{ color: t.danger }}>*</span>
      </p>
      <p style={{ margin: "0 0 16px", fontSize: 15, color: t.textSoft, lineHeight: 1.6 }}>
        {plain ? (
          <>A photo shows people you are a real person. You can add up to {ONBOARDING_MAX_PHOTOS}. You can change them later.</>
        ) : (
          <>A photo helps people feel they&apos;re connecting with a real person. You can
          add up to {ONBOARDING_MAX_PHOTOS}, and change them anytime in your profile.</>
        )}
      </p>

      {/* Calm review note — mirrors the SAFETY-2 pending-review copy so it reads
          reassuring, not alarming. */}
      <div
        role="note"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          background: t.surfaceAlt,
          border: `1px solid ${t.borderLight}`,
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 18,
          fontSize: 14,
          color: t.textSoft,
          lineHeight: 1.55,
        }}
      >
        {/* Soft shield (P6) — the old 🔒 padlock read as "locked / blocked /
            punished." A calm shield-with-check reads as "looked after / in
            review," matching the reassuring copy. */}
        <span aria-hidden="true" style={{ color: t.accentStrong, display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
          <ShieldIcon size={18} />
        </span>
        <span>
          {plain
            ? "Our team checks each photo before others can see it. You can add more later."
            : "A member of our team takes a look at each photo before others can see it. There’s no rush — you can add more later."}
        </span>
      </div>

      {/* Uploaded photos + add tile */}
      <div
        role="list"
        aria-label="Your photos"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 8 }}
      >
        {photos.map((p, i) => (
          <div
            key={p.id ?? p.url ?? i}
            role="listitem"
            style={{
              position: "relative",
              aspectRatio: "1 / 1",
              borderRadius: 12,
              overflow: "hidden",
              background: t.surfaceAlt,
              border: `1px solid ${t.border}`,
            }}
          >
            {p.url ? (
              <img
                src={p.url}
                alt={`Your photo ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <span style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 12, color: t.textMuted }}>
                Photo {i + 1}
              </span>
            )}
            {(p.pending || p.reviewStatus === "pending_review") && (
              <span
                style={{
                  position: "absolute",
                  left: 6,
                  bottom: 6,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  background: t.warningSurface,
                  color: t.warningSurfaceText,
                  border: `1px solid ${t.warningBorder}`,
                }}
              >
                In review
              </span>
            )}
          </div>
        ))}
        {!atMax && (
          <OnboardAddPhotoTile
            onAdd={onAdd}
            uploading={uploading}
            invalid={!!gateError}
            tileRef={tileRef}
          />
        )}
      </div>

      {/* Upload failure — calm, retry is simply tapping Add photo again. */}
      {uploadError && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: t.danger, fontWeight: 500, lineHeight: 1.5 }}>
          {uploadError}{plain ? " Try again." : " You can try adding it again."}
        </p>
      )}

      {/* Proactive requirement hint (P4). Before this step, Continue looked
          enabled with no photo, so tapping it produced a surprise rejection.
          Naming the requirement calmly, up front, means the gate never surprises
          — the hint shows while no photo is present and gives way to the inline
          error only once the user has actually tried to continue. */}
      {photos.length === 0 && !gateError && (
        <p style={{ margin: "8px 0 0", fontSize: 14, color: t.textSoft, fontWeight: 500, lineHeight: 1.5 }}>
          {plain ? "Add one photo." : "Add one photo to continue."}
        </p>
      )}

      <InlineError id="ob-photos-error">{gateError}</InlineError>
    </>
  );
}

// ─── Step 3: Communication ─────────────────────────────────────────────────────

function Step3({ commNote, setCommNote, relationshipGoal, setRelationshipGoal, errors, attempted }) {
  const plain = usePlainLanguage();
  const GOALS = [
    { value: "long-term", label: "Long-term relationship" },
    { value: "friendship", label: "Friendship" },
    { value: "open", label: "Open to anything" },
    { value: "", label: plain ? "Not sure yet" : "Still figuring it out" },
  ];

  return (
    <>
      {/* Communication note */}
      <div style={{ marginBottom: 28 }}>
        <FieldLabel htmlFor="ob-comm-note">{plain ? "How you like to talk" : "How you prefer to connect"}</FieldLabel>
        <textarea
          id="ob-comm-note"
          maxLength={120}
          rows={3}
          aria-describedby="ob-comm-note-hint"
          value={commNote}
          onChange={(e) => setCommNote(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={{
            ...inputStyle(false),
            resize: "vertical",
            minHeight: 72,
            lineHeight: 1.55,
          }}
          placeholder=""
        />
        <HelperText id="ob-comm-note-hint">
          {plain
            ? "Tell matches how you like to talk. For example: written messages, or a slower pace."
            : "Tell matches how you like to connect — for example: written messages, clear back-and-forth, or a slower pace. Whatever fits you."}
        </HelperText>
      </div>

      {/* Relationship goal */}
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend
          style={{
            fontWeight: 600,
            fontSize: 16,
            color: t.text,
            marginBottom: 12,
            float: "left",
            width: "100%",
          }}
        >
          {plain ? "What do you want to find?" : "What are you looking for?"}
        </legend>
        <div style={{ clear: "both" }}>
          {GOALS.map(({ value, label }) => (
            <label
              key={value || "figuring"}
              htmlFor={`ob-goal-${value || "figuring"}`}
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 44,
                cursor: "pointer",
                gap: 12,
                fontSize: 16,
                color: t.text,
              }}
            >
              <input
                type="radio"
                id={`ob-goal-${value || "figuring"}`}
                name="ob-relationship-goal"
                value={value}
                checked={relationshipGoal === value}
                onChange={() => setRelationshipGoal(value)}
                style={{ accentColor: t.accentStrong, width: 18, height: 18, flexShrink: 0 }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Contact-gating reassurance */}
      <p
        style={{
          marginTop: 28,
          padding: "14px 16px",
          background: t.surfaceAlt,
          borderRadius: 12,
          fontSize: 14,
          color: t.textSoft,
          lineHeight: 1.55,
        }}
      >
        {plain
          ? "You control who can reach you. Only people you both said yes to can message you. No one can message you first without a match."
          : "You’re in control of who can reach you. Only people you and they have both said yes to can message you — no one can message you out of the blue."}
      </p>
    </>
  );
}

// ─── Step 4: Who you'd like to meet (optional) ─────────────────────────────────

function Step4({
  gender, setGender, genderChosen, setGenderChosen,
  genderCustom, setGenderCustom,
  orientation, setOrientation, orientationChosen, setOrientationChosen,
  relationshipStructure, setRelationshipStructure,
  pronouns, setPronouns,
  seeking, setSeeking,
  seekingChosen, setSeekingChosen,
  prefAgeMin, prefAgeMax, setPrefAgeMin, setPrefAgeMax,
  errors, attempted, locationAtRisk = false,
}) {
  const plain = usePlainLanguage();
  const seekingSet = seeking.split(",").map((s) => s.trim()).filter(Boolean);
  // Gender / sexuality / seeking are REQUIRED at sign-up (owner). "Open to
  // everyone" is the empty-seeking state, so an EXPLICIT pick has to be
  // distinguishable from "hasn't chosen yet" — `seekingChosen` is that flag.
  // It's checked only when the user has actively picked it (not merely left
  // every box unchecked), which is what makes seeking a real required choice
  // while still letting people stay open to everyone.
  const openToEveryone = seekingChosen && seekingSet.length === 0;

  return (
    <>
      <p style={{ margin: "0 0 22px", fontSize: 16, color: t.textSoft, lineHeight: 1.55 }}>
        {plain ? (
          <>This helps us pick who to show you. Some fields are required (marked
          with <span aria-hidden="true" style={{ color: t.danger }}>*</span>). The
          rest are optional. You can change any of it later.</>
        ) : (
          <>This helps us shape your Discover deck. A few fields are required (marked
          with <span aria-hidden="true" style={{ color: t.danger }}>*</span>); the
          rest are optional, and you can adjust any of it anytime in your profile.</>
        )}
      </p>

      <GenderField
        gender={gender}
        // Any pick (a specific gender OR the "Prefer not to say" opt-out) marks
        // the required field as answered so validation passes and the opt-out
        // pill reads as selected only after an explicit tap (B4).
        setGender={(v) => { setGenderChosen(true); setGender(v); }}
        chosen={genderChosen}
        genderCustom={genderCustom}
        setGenderCustom={setGenderCustom}
        idPrefix="ob-gender"
        required
        error={attempted ? errors.gender : ""}
        locationAtRisk={locationAtRisk}
      />

      <OrientationField
        orientation={orientation}
        setOrientation={setOrientation}
        chosen={orientationChosen}
        onChoose={() => setOrientationChosen(true)}
        required
        error={attempted ? errors.orientation : ""}
      />

      <RelationshipStructureField
        relationshipStructure={relationshipStructure}
        setRelationshipStructure={setRelationshipStructure}
      />

      <div style={{ marginBottom: 20 }}>
        <FieldLabel htmlFor="ob-pronouns">Pronouns</FieldLabel>
        <input
          id="ob-pronouns"
          type="text"
          maxLength={40}
          aria-describedby="ob-pronouns-hint"
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value)}
          onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
          onBlur={(e) => { e.target.style.outline = "none"; }}
          style={inputStyle(false)}
          placeholder="e.g. she/her, they/them"
        />
        <HelperText id="ob-pronouns-hint">{plain ? "Shown on your profile so people use the right words for you." : "Shown on your profile so people address you correctly."}</HelperText>
      </div>

      <fieldset aria-required="true" style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 6, float: "left", width: "100%" }}>
          Who do you want to meet?
          {/* Visual asterisk stays aria-hidden; the "(required)" text is real,
              non-aria-hidden, so it's part of the group's accessible name and
              assistive tech is actually told the field is required (WCAG 3.3.2).
              aria-required on the fieldset reinforces it. */}
          <span aria-hidden="true" style={{ color: t.danger, marginLeft: 3 }}>*</span>
          <span style={{ fontWeight: 400, fontSize: 14, color: t.textSoft, marginLeft: 6 }}>(required)</span>
        </legend>
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 10, clear: "both" }}>
          {plain ? "Choose who you want to meet, or stay open to everyone." : "Choose who you'd like to meet, or stay open to everyone."}
        </span>
        {[
          { value: "woman", label: "Women" },
          { value: "man", label: "Men" },
          { value: "nonbinary", label: "Nonbinary people" },
        ].map(({ value, label }) => {
          const checked = seekingSet.includes(value);
          return (
            <label key={value} htmlFor={`ob-seek-${value}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
              <input
                id={`ob-seek-${value}`}
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? seekingSet.filter((x) => x !== value) : [...seekingSet, value];
                  setSeeking(next.join(","));
                  // Picking (or clearing) a specific option is an explicit choice.
                  setSeekingChosen(true);
                }}
                style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
              />
              <span style={{ fontSize: 16, color: t.text }}>{label}</span>
            </label>
          );
        })}
        {/* Explicit "open to everyone" affordance. Selecting it clears the seeking
            set (the existing empty-seeking = match-everyone semantics) AND marks
            seeking as an actively-made choice, so "open to everyone" is a real
            required selection rather than the untouched default. */}
        <label
          htmlFor="ob-seek-everyone"
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${t.borderLight}` }}
        >
          <input
            id="ob-seek-everyone"
            type="checkbox"
            checked={openToEveryone}
            onChange={() => { setSeeking(""); setSeekingChosen(true); }}
            style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
          />
          <span style={{ fontSize: 16, color: t.text }}>Open to everyone</span>
        </label>
        <InlineError id="ob-seeking-error">{attempted ? errors.seeking : ""}</InlineError>
      </fieldset>

      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 2 }}>
          Age range
        </legend>
        <AgeRangeSlider
          low={prefAgeMin}
          high={prefAgeMax}
          onChange={(newLow, newHigh) => { setPrefAgeMin(newLow); setPrefAgeMax(newHigh); }}
        />
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}>
          Only show people in this age range.
        </span>
      </fieldset>
    </>
  );
}

// ─── Step 5: How you communicate — the "moat" (optional) ───────────────────────

function Step5({
  commDirectness, setCommDirectness,
  commCadence, setCommCadence,
  sensoryEnvironment, setSensoryEnvironment,
  specialInterests, setSpecialInterests,
  prefersReduced,
}) {
  const plain = usePlainLanguage();
  const selectHelper = plain
    ? "Shown on your profile. You can change it later."
    : "Shown on your profile. Change it anytime.";
  // "Softened" is undefined jargon for a literal reader — spell out both terms.
  const directnessHelper = plain
    ? "Direct = plain and to the point. Softened = gentler, more cushioned wording."
    : "Direct means plain and to the point. Softened means gentler, more cushioned wording.";
  return (
    <>
      <p style={{ margin: "0 0 8px", fontSize: 16, color: t.text, lineHeight: 1.55, fontWeight: 600 }}>
        {plain ? "This is how Spectrum matches you." : "This is how Spectrum matches you differently."}
      </p>
      <p style={{ margin: "0 0 22px", fontSize: 16, color: t.textSoft, lineHeight: 1.55 }}>
        {plain
          ? "We match on how you talk and what your senses need, not just photos. This is optional. You can change it anytime."
          : "We match on how you communicate and what your senses need — not just photos. It's optional and you can change it anytime, but this is the part that helps us find people who genuinely fit how you connect."}
      </p>

      <LabelledSelect
        id="ob-comm-directness"
        label="Directness"
        helper={directnessHelper}
        value={commDirectness}
        onChange={setCommDirectness}
        options={[
          { value: "", label: "I'll add this later" },
          { value: "direct", label: "I prefer direct" },
          { value: "softened", label: "I prefer softened" },
        ]}
      />

      <LabelledSelect
        id="ob-comm-cadence"
        label="Reply pace"
        helper={selectHelper}
        value={commCadence}
        onChange={setCommCadence}
        options={[
          { value: "", label: "Open to any pace" },
          { value: "instant", label: "I like quick replies" },
          { value: "daily", label: "Once a day is great" },
          { value: "whenever", label: "Whenever works" },
        ]}
      />

      <LabelledSelect
        id="ob-sensory-environment"
        label="Preferred setting"
        helper={selectHelper}
        value={sensoryEnvironment}
        onChange={setSensoryEnvironment}
        options={[
          { value: "", label: "Open to any setting" },
          { value: "quiet", label: "Quiet" },
          { value: "lively", label: "Lively" },
          { value: "either", label: "Either is fine" },
        ]}
      />

      {/* D-17 Phase 2 — the matchable "Could talk for hours about" chips. Optional
          and calm; these help us suggest people who light up about the same
          things. Same 3×40 cap + chip input used in the profile editor. */}
      <div style={{ marginTop: 26 }}>
        <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 16, color: t.text }}>
          Could talk for hours about
        </p>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          {plain
            ? "A few topics you love. We use these to suggest people who like the same things. Optional."
            : "A few topics you love going deep on — we use these to suggest people who light up about the same things. Optional, and easy to change later."}
        </p>
        <SpecialInterestsInput
          items={specialInterests}
          onChange={setSpecialInterests}
          idPrefix="ob-special-interests"
          prefersReduced={prefersReduced}
        />
      </div>
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete, locationAtRisk = false }) {
  // Read the saved draft ONCE (useState initializer) and seed every text/choice
  // field from it, so a returning user resumes where they left off with no
  // restore-effect flash. Photos are intentionally absent (see the draft notes).
  const [draft] = useState(readOnboardingDraft);

  const [step, setStep] = useState(() => resumeStep(draft.step));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // D33 — brief "You're all set" arrival beat after a successful save, before
  // the Discover feed. Low-stimulation confirmation; the user taps to enter.
  const [celebrating, setCelebrating] = useState(false);

  // Step 1 fields
  const [displayName, setDisplayName] = useState(() => draft.displayName || "");
  const [tagline, setTagline] = useState(() => draft.tagline || "");
  const [dateOfBirth, setDateOfBirth] = useState(() => draft.dateOfBirth || "");
  const [distCity, setDistCity] = useState(() => draft.distCity || "");

  // Step 2 fields
  const [bio, setBio] = useState(() => draft.bio || "");
  const [interests, setInterests] = useState(() => Array.isArray(draft.interests) ? draft.interests : []);

  // Photo step — at least one uploaded photo is required to finish onboarding.
  // The onboarding user is already authenticated, so this reuses the exact same
  // presign → PUT → add pipeline the profile editor uses (api.js). Uploads land
  // in pending_review; the gate is photos.length >= 1 (pending counts).
  const [photos, setPhotos] = useState([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  // Step 3 fields
  const [commNote, setCommNote] = useState(() => draft.commNote || "");
  const [relationshipGoal, setRelationshipGoal] = useState(() => draft.relationshipGoal || "");

  // Step 4 fields — who you'd like to meet (optional)
  const [gender, setGender] = useState(() => draft.gender || "");
  const [genderCustom, setGenderCustom] = useState(() => draft.genderCustom || ""); // self-describe free text
  // Gender is required at sign-up, but "" is a REAL, inclusive value ("Prefer
  // not to say" → matchable-everyone gender_group server-side). So we track an
  // explicit-choice flag, mirroring `seekingChosen`, instead of failing on `!gender`
  // — otherwise the opt-out looks selected yet can never pass validation (B4).
  const [genderChosen, setGenderChosen] = useState(() => !!draft.genderChosen);
  const [orientation, setOrientation] = useState(() => draft.orientation || ""); // comma-joined; display only
  // M3 — orientation is required at sign-up, but "" (Prefer not to say) is a
  // REAL, valid value: display-only, never used in matching. So we track an
  // explicit-choice flag mirroring `genderChosen`, instead of failing on an
  // empty set — otherwise the opt-out looks selected yet can never pass.
  const [orientationChosen, setOrientationChosen] = useState(() => !!draft.orientationChosen);
  const [relationshipStructure, setRelationshipStructure] = useState(() => draft.relationshipStructure || ""); // D-14; display only
  const [pronouns, setPronouns] = useState(() => draft.pronouns || "");
  const [seeking, setSeeking] = useState(() => draft.seeking || ""); // comma-joined: "woman,man,nonbinary"
  // Tri-state helper for the required "who do you want to meet?" gate: seeking=""
  // means BOTH "open to everyone" and "untouched", so this flag records that the
  // user has actively made a choice (a specific option OR an explicit
  // "open to everyone"). Empty seeking still saves as match-everyone.
  const [seekingChosen, setSeekingChosen] = useState(() => !!draft.seekingChosen);
  const [prefAgeMin, setPrefAgeMin] = useState(() => Number.isFinite(draft.prefAgeMin) ? draft.prefAgeMin : 18);
  const [prefAgeMax, setPrefAgeMax] = useState(() => Number.isFinite(draft.prefAgeMax) ? draft.prefAgeMax : 99);

  // Step 5 fields — how you communicate, the "moat" (optional)
  const [commDirectness, setCommDirectness] = useState(() => draft.commDirectness || "");
  const [commCadence, setCommCadence] = useState(() => draft.commCadence || "");
  const [sensoryEnvironment, setSensoryEnvironment] = useState(() => draft.sensoryEnvironment || "");
  // D-17 Phase 2 — matchable "Could talk for hours about" chips (optional, ≤3×40).
  const [specialInterests, setSpecialInterests] = useState(() => Array.isArray(draft.specialInterests) ? draft.specialInterests : []);

  // Validation
  const [attempted, setAttempted] = useState(false);

  // Focus management
  const headingRef = useRef(null);
  const photoTileRef = useRef(null);
  const prefersReduced = usePrefersReduced();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const plain = usePlainLanguage();

  // Focus heading on step change
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // D33 — the "You're all set" beat is entered on the user's own terms via the
  // "Enter Spectrum" button — no auto-advance/timed transition (a countdown into
  // the app would read as urgency, against calm-by-design). We only move focus
  // to the welcome heading so keyboard/SR users land on the confirmation.
  const welcomeRef = useRef(null);
  useEffect(() => {
    if (!celebrating) return;
    welcomeRef.current?.focus();
  }, [celebrating]);

  // Save & resume — persist the text/choice answers + current step on every
  // change so closing the tab or navigating away doesn't lose progress. Photos
  // are excluded (they're uploaded to the backend, not stored here). Skipped once
  // we're on the success/celebration beat: the draft is cleared in handleSave, and
  // re-writing here would resurrect a completed draft for the next fresh signup.
  useEffect(() => {
    if (celebrating) return;
    try {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
        step,
        displayName, tagline, dateOfBirth, distCity,
        bio, interests,
        commNote, relationshipGoal,
        gender, genderCustom, genderChosen,
        orientation, orientationChosen, relationshipStructure,
        pronouns, seeking, seekingChosen, prefAgeMin, prefAgeMax,
        commDirectness, commCadence, sensoryEnvironment, specialInterests,
      }));
    } catch {
      // localStorage unavailable (private mode) / quota — non-fatal, state still applies.
    }
  }, [
    celebrating, step,
    displayName, tagline, dateOfBirth, distCity,
    bio, interests,
    commNote, relationshipGoal,
    gender, genderCustom, genderChosen,
    orientation, orientationChosen, relationshipStructure,
    pronouns, seeking, seekingChosen, prefAgeMin, prefAgeMax,
    commDirectness, commCadence, sensoryEnvironment, specialInterests,
  ]);

  // ── Validation per step ──────────────────────────────────────────────────────

  function validateStep1() {
    const errs = {};
    if (!displayName.trim()) errs.displayName = plain ? "Enter a display name." : "Enter a display name to continue.";
    if (!dateOfBirth) {
      errs.dateOfBirth = plain ? "Enter your date of birth." : "Enter your date of birth to continue.";
    } else {
      const age = ageFromDob(dateOfBirth);
      if (age === null) {
        errs.dateOfBirth = "Enter a valid date of birth.";
      } else if (age < 18) {
        errs.dateOfBirth = plain ? "You must be 18 or older." : "You must be 18 or older to use Spectrum Dating.";
      }
    }
    if (!distCity.trim()) errs.distCity = plain ? "Enter your city or area." : "Please enter your city or area.";
    return errs;
  }

  function validateStep2() {
    const errs = {};
    if (bio.trim().length < 20) errs.bio = plain ? "Your bio needs at least 20 letters." : "Your bio needs to be at least 20 characters.";
    if (interests.length === 0) errs.interests = plain ? "Choose at least one interest." : "Choose at least one interest so we can find people you might connect with.";
    return errs;
  }

  // Photo step gate — at least ONE uploaded photo (pending review counts).
  function validatePhotoStep() {
    const errs = {};
    if (photos.length === 0) errs.photos = plain ? "Add at least one photo." : "Add at least one photo to continue.";
    return errs;
  }

  // Upload a chosen image through the shared profile-photo pipeline. Reuses the
  // same validation + presign → PUT → add flow as the profile editor; a failed
  // upload surfaces a calm retry (never a dead-end).
  async function handleAddPhoto(file) {
    if (!file) return;
    if (photos.length >= ONBOARDING_MAX_PHOTOS) {
      setPhotoUploadError(`You can add up to ${ONBOARDING_MAX_PHOTOS} photos.`);
      return;
    }
    const invalid = validateProfilePhotoFile(file);
    if (invalid) {
      setPhotoUploadError(invalid);
      return;
    }
    setPhotoUploadError("");
    setPhotoUploading(true);
    try {
      const list = await uploadProfilePhoto(file);
      setPhotos(list);
    } catch (e) {
      setPhotoUploadError(safeErrorMessage(e, "Photo upload failed."));
    } finally {
      setPhotoUploading(false);
    }
  }

  // Gender, sexual orientation, and seeking are required at sign-up (owner).
  // Client-side gate only — like the required city field, the shared
  // PUT /profile/me can't globally require these without breaking partial edits.
  function validateMeetStep() {
    const errs = {};
    // Passes on an EXPLICIT choice — including the "Prefer not to say" opt-out
    // (gender === "" with genderChosen true), which persists as an inclusive,
    // match-everyone value. Fails only when the user has picked nothing at all.
    if (!gender && !genderChosen) {
      errs.gender = plain ? "Choose your gender." : "Choose your gender to continue.";
    } else if (gender === GENDER_SELF_DESCRIBE && !genderCustom.trim()) {
      errs.gender = plain ? "Describe your gender." : "Add a short description of your gender.";
    }
    // Passes when at least one orientation is chosen OR the "Prefer not to say"
    // opt-out was explicitly picked (M3); fails only when the user has touched
    // neither — mirroring the gender opt-out.
    const orientationSet = orientation.split(",").map((s) => s.trim()).filter(Boolean);
    if (orientationSet.length === 0 && !orientationChosen) {
      errs.orientation = plain ? "Choose your sexuality, or pick “Prefer not to say.”" : "Choose your sexuality, or select “Prefer not to say.”";
    }
    // Passes when a specific option is selected OR "open to everyone" was
    // explicitly picked; fails only when the user has touched neither.
    const seekingSet = seeking.split(",").map((s) => s.trim()).filter(Boolean);
    if (seekingSet.length === 0 && !seekingChosen) {
      errs.seeking = plain ? "Choose who you want to meet." : "Let us know who you're hoping to meet.";
    }
    return errs;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function handleContinue() {
    const errs =
      step === 1 ? validateStep1() :
      step === 2 ? validateStep2() :
      step === 3 ? validatePhotoStep() :
      step === 5 ? validateMeetStep() : {};
    if (Object.keys(errs).length > 0) {
      setAttempted(true);
      // Move focus to the first invalid field so keyboard/SR users are taken to
      // the problem instead of being left on the Continue button (M1). The
      // photo step's Add-photo tile carries aria-invalid when the gate fails.
      setTimeout(() => {
        const el = document.querySelector('[aria-invalid="true"]');
        if (el && typeof el.focus === "function") el.focus();
      }, 0);
      return;
    }
    setAttempted(false);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setAttempted(false);
    setError("");
    setStep((s) => s - 1);
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    // Belt-and-suspenders: onboarding cannot complete without at least one
    // uploaded photo. The photo step's gate already blocks progress, but guard
    // the finish handler too so the requirement can't be bypassed.
    if (photos.length === 0) {
      setAttempted(true);
      setError(plain ? "Add at least one photo first." : "Add at least one photo before finishing.");
      setStep(3);
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Canonicalise interest case at this one boundary — server-side
      // shared-interest matching is case-sensitive, so "Hiking" and "hiking"
      // must not drift. Lowercase + dedupe before persisting.
      const canonicalInterests = [...new Set(interests.map((i) => i.trim().toLowerCase()).filter(Boolean))];
      await updateProfile({
        displayName: displayName.trim(),
        tagline,
        dateOfBirth,
        // Coarse city/area collected in Step 1 (required). Backend coarsens +
        // caps at 100 chars; sent under the `distCity` PUT key like the editor.
        distCity: distCity.trim(),
        bio,
        interests: canonicalInterests,
        commNote,
        relationshipGoal,
        // Step 4 — who you'd like to meet (optional)
        gender,
        genderCustom,
        orientation,
        relationshipStructure,
        pronouns,
        seeking,
        prefAgeMin,
        prefAgeMax,
        // Step 5 — how you communicate, the "moat" (optional)
        commDirectness,
        commCadence,
        sensoryEnvironment,
        // D-17 Phase 2 — matchable deep interests (trimmed/deduped/capped 3×40).
        specialInterests: normalizeSpecialInterests(specialInterests),
      });
      // Profile saved — clear the resume draft so a completed onboarding never
      // re-hydrates stale answers onto the next fresh signup on this device.
      clearOnboardingDraft();
      // D33 — show the calm "You're all set" beat instead of jumping straight
      // into Discover. It auto-advances (and is skippable) below.
      setSaving(false);
      setCelebrating(true);
    } catch (e) {
      setError(safeErrorMessage(e, "Something went wrong. Please try again."));
      setSaving(false);
    }
  }

  // ── Step errors (memoised-ish via inline) ────────────────────────────────────
  const step1Errors = attempted && step === 1 ? validateStep1() : {};
  const step2Errors = attempted && step === 2 ? validateStep2() : {};
  const photoStepErrors = attempted && step === 3 ? validatePhotoStep() : {};
  const meetStepErrors = attempted && step === 5 ? validateMeetStep() : {};

  // ── Styles ───────────────────────────────────────────────────────────────────

  const page = {
    minHeight: "100vh",
    background: t.bg,
    display: "flex",
    // DT-5: center the step card on tablet/desktop where the tall viewport
    // otherwise top-anchors it above a large empty space. minHeight (not a fixed
    // height) means a card taller than the viewport still grows the page and
    // scrolls normally — centering only takes effect when there's spare room.
    // Mobile stays top-anchored (unchanged).
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

  // Step 4 (Step3 component) collects a free-text "how you like to talk" note +
  // relationship goal — it's about connecting and what you want. Step 6 (Step5)
  // collects the structured matching signals (directness, reply pace, sensory
  // setting, deep-interest topics). The old headings "How you communicate" /
  // "How you communicate best" scanned as the same question twice, so each now
  // names what it actually gathers.
  const stepHeadings = plain
    ? [
        "The basics",
        "About you",
        "Add a photo",
        "How you like to connect",
        "Who you want to meet",
        "How we match you",
      ]
    : [
        "Let's start with the basics",
        "Tell people about you",
        "Add a photo",
        "How you like to connect",
        "Who you'd like to meet",
        "Your matching preferences",
      ];
  const TOTAL_STEPS = stepHeadings.length;

  // ── Continue / Save button ────────────────────────────────────────────────────
  const fContinue = useFocusable();
  const fBack = useFocusable();
  const fSkip = useFocusable();

  // Skip the optional step (5). On the last step this saves with whatever
  // has (or hasn't) been filled in — the skipped fields simply stay at their
  // calm defaults. Never forced (calm-by-design).
  function handleSkip() {
    setAttempted(false);
    setError("");
    if (isLastStep) {
      handleSave();
    } else {
      setStep((s) => s + 1);
    }
  }

  const isLastStep = step === TOTAL_STEPS;
  // The "who you'd like to meet" step (5) carries required fields (gender /
  // sexual orientation / seeking) and the photo step (3) is required, so neither
  // is wholesale-skippable — only the final "moat" step (6) is optional.
  const isOptionalStep = step === TOTAL_STEPS;

  // D33 — "You're all set" arrival beat. Calm, low-stimulation: a soft spectrum
  // mark, a warm line, and a single clear button to enter. No confetti / sound /
  // motion / countdown — the user decides when to continue.
  if (celebrating) {
    // Greet with the WHOLE display name — the first time the app says the user's
    // name it must not mangle it (slicing at the first space turned "Sam Rivers"
    // into "Sam").
    const fullName = displayName.trim();
    // The "moat" step (6) is optional/skippable; only claim we captured comm /
    // sensory prefs when the user actually provided some (don't assert data we
    // never collected).
    const sharedCommSensory = !!(commDirectness || commCadence || sensoryEnvironment);
    return (
      <div style={page}>
        <div
          role="status"
          aria-live="polite"
          style={{ ...card, textAlign: "center", padding: "48px 28px" }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }} aria-hidden="true">
            <Spectrum variant="progress" value={TOTAL_STEPS} count={TOTAL_STEPS} size={11} gap={6} />
          </div>
          <h1
            ref={welcomeRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 28,
              fontWeight: 700,
              margin: "0 0 12px",
              color: t.text,
              lineHeight: 1.25,
              outline: "none",
            }}
          >
            {plain ? "You're done" : "You're all set"}{fullName ? `, ${fullName}` : ""}.
          </h1>
          {/* Softened from "Your profile is ready" — the Hub immediately offers
              "a few optional things you could add", so claiming the profile is
              complete here contradicts it. This says only that they can start. */}
          <p style={{ fontSize: 16, color: t.textSoft, margin: "0 0 20px", lineHeight: 1.6 }}>
            {plain
              ? "You're ready to explore. There is no rush."
              : "You're ready to start exploring. Take your time — there's no rush here."}
          </p>
          {/* D-5 — a quiet "made for you" beat: name the promise, tying the
              forms they just filled to why Spectrum is different. Only shown when
              the user actually gave comm/sensory prefs (Step 6 is optional) — we
              never claim to have collected what they skipped. */}
          {sharedCommSensory && (
            <p
              style={{
                margin: "0 0 28px",
                padding: "14px 16px",
                background: t.surfaceAlt,
                border: `1px solid ${t.borderLight}`,
                borderRadius: 14,
                fontSize: 15,
                color: t.textSoft,
                lineHeight: 1.6,
                textAlign: "left",
              }}
            >
              {plain
                ? "You told us how you like to talk and what your senses need. We match on that, not just photos."
                : "You told us how you communicate and what your senses need. From here, that's what we match on — not just photos."}
            </p>
          )}
          <button
            type="button"
            onClick={onComplete}
            {...fContinue}
            style={{
              minHeight: 44,
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: t.accentFill,
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              ...fContinue.style,
            }}
          >
            {plain ? "Go to the app" : "Enter Spectrum"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      {/* SR live region for step changes */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
      >
        {`Step ${step} of ${TOTAL_STEPS}: ${stepHeadings[step - 1]}`}
      </div>

      <div style={card}>
        {/* Step indicator — calm spectrum tiles, not test-like. 3 tiles, the
            first `step` filled. The SR live region above announces the step. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "0 0 20px",
          }}
          aria-hidden="true"
        >
          <Spectrum variant="progress" value={step} count={TOTAL_STEPS} size={9} gap={5} />
          <span style={{ fontSize: 14, color: t.textMuted, letterSpacing: "0.02em" }}>
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>

        {/* Step heading */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 24px",
            color: t.text,
            lineHeight: 1.25,
            outline: "none",
          }}
        >
          {stepHeadings[step - 1]}
        </h1>

        {/* Scope-setting — one calm, honest line on the intro step so an anxious
            user knows the length up front and that progress is recoverable. The
            resume promise is backed by the draft persistence above (fields + step
            are saved on change and restored on return). */}
        {step === 1 && (
          <p style={{ margin: "-8px 0 24px", fontSize: 15, color: t.textSoft, lineHeight: 1.6 }}>
            {plain
              ? "About 5 minutes — 6 short steps. You can stop anytime. We save your place on this device."
              : "This takes about 5 minutes — 6 short steps. You can stop anytime and pick up where you left off."}
          </p>
        )}

        {/* Step content */}
        {step === 1 && (
          <Step1
            displayName={displayName}
            setDisplayName={setDisplayName}
            tagline={tagline}
            setTagline={setTagline}
            dateOfBirth={dateOfBirth}
            setDateOfBirth={setDateOfBirth}
            distCity={distCity}
            setDistCity={setDistCity}
            errors={step1Errors}
            attempted={attempted}
          />
        )}
        {step === 2 && (
          <Step2
            bio={bio}
            setBio={setBio}
            interests={interests}
            setInterests={setInterests}
            errors={step2Errors}
            attempted={attempted}
            prefersReduced={prefersReduced}
          />
        )}
        {step === 3 && (
          <StepPhotos
            photos={photos}
            uploading={photoUploading}
            uploadError={photoUploadError}
            onAdd={handleAddPhoto}
            tileRef={photoTileRef}
            errors={photoStepErrors}
            attempted={attempted}
          />
        )}
        {step === 4 && (
          <Step3
            commNote={commNote}
            setCommNote={setCommNote}
            relationshipGoal={relationshipGoal}
            setRelationshipGoal={setRelationshipGoal}
            errors={{}}
            attempted={attempted}
          />
        )}
        {step === 5 && (
          <Step4
            gender={gender}
            setGender={setGender}
            genderChosen={genderChosen}
            setGenderChosen={setGenderChosen}
            genderCustom={genderCustom}
            setGenderCustom={setGenderCustom}
            orientation={orientation}
            setOrientation={setOrientation}
            orientationChosen={orientationChosen}
            setOrientationChosen={setOrientationChosen}
            relationshipStructure={relationshipStructure}
            setRelationshipStructure={setRelationshipStructure}
            pronouns={pronouns}
            setPronouns={setPronouns}
            seeking={seeking}
            setSeeking={setSeeking}
            seekingChosen={seekingChosen}
            setSeekingChosen={setSeekingChosen}
            prefAgeMin={prefAgeMin}
            prefAgeMax={prefAgeMax}
            setPrefAgeMin={setPrefAgeMin}
            setPrefAgeMax={setPrefAgeMax}
            errors={meetStepErrors}
            attempted={attempted}
            locationAtRisk={locationAtRisk}
          />
        )}
        {step === 6 && (
          <Step5
            commDirectness={commDirectness}
            setCommDirectness={setCommDirectness}
            commCadence={commCadence}
            setCommCadence={setCommCadence}
            sensoryEnvironment={sensoryEnvironment}
            setSensoryEnvironment={setSensoryEnvironment}
            specialInterests={specialInterests}
            setSpecialInterests={setSpecialInterests}
            prefersReduced={prefersReduced}
          />
        )}

        {/* Save error */}
        {error && (
          <p
            role="alert"
            style={{
              marginTop: 16,
              fontSize: 14,
              color: t.danger,
              fontWeight: 500,
            }}
          >
            {error}
          </p>
        )}

        {/* Navigation */}
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="button"
            onClick={isLastStep ? handleSave : handleContinue}
            disabled={saving}
            aria-busy={saving}
            style={{
              minHeight: 52,
              padding: "14px 24px",
              borderRadius: 14,
              border: `1px solid ${t.accentFill}`,
              background: t.accentFill,
              color: "#fff",
              fontSize: 17,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              letterSpacing: "0.01em",
              opacity: saving ? 0.75 : 1,
              transition: prefersReduced ? "none" : "opacity 150ms ease",
              ...fContinue.style,
            }}
            onFocus={fContinue.onFocus}
            onBlur={fContinue.onBlur}
          >
            {isLastStep
              ? (saving ? "Saving…" : (plain ? "Save and finish" : "Save & start exploring"))
              : (plain ? "Next" : "Continue")}
          </button>

          {/* Skip — only on the optional step (5). Calm-by-design: the moat step
              is never forced. On the last step, Skip saves with the fields left
              at their defaults. */}
          {isOptionalStep && (
            <button
              type="button"
              onClick={handleSkip}
              disabled={saving}
              style={{
                background: "transparent",
                border: "none",
                color: t.textSoft,
                fontSize: 16,
                fontWeight: 500,
                cursor: saving ? "wait" : "pointer",
                padding: "8px 0",
                minHeight: 44,
                textAlign: "center",
                ...fSkip.style,
              }}
              onFocus={fSkip.onFocus}
              onBlur={fSkip.onBlur}
            >
              {isLastStep ? (plain ? "Add this later" : "I'll add this later") : (plain ? "Skip" : "Skip this step")}
            </button>
          )}

          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              style={{
                background: "transparent",
                border: "none",
                color: t.accentStrong,
                fontSize: 16,
                fontWeight: 500,
                cursor: "pointer",
                padding: "8px 0",
                minHeight: 44,
                textAlign: "center",
                ...fBack.style,
              }}
              onFocus={fBack.onFocus}
              onBlur={fBack.onBlur}
            >
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
