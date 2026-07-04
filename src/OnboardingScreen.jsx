import { useState, useEffect, useRef } from "react";
import { updateProfile, safeErrorMessage } from "./api.js";
import { t } from "./tokens.js";
import Spectrum from "./Spectrum.jsx";
import { useFocusable, focusRing } from "./useFocusable.js";
import { useViewport } from "./useViewport.js";
import { GenderField, OrientationField, RelationshipStructureField } from "./IdentityFields.jsx";
import SpecialInterestsInput from "./SpecialInterestsInput.jsx";
import { normalizeSpecialInterests } from "./specialInterests.js";


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
          style={{ ...thumbStyle("low"), ...(focusedThumb === "low" ? focusRing : {}) }}
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
          style={{ ...thumbStyle("high"), ...(focusedThumb === "high" ? focusRing : {}) }}
        />
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

function Step1({ displayName, setDisplayName, tagline, setTagline, dateOfBirth, setDateOfBirth, errors, attempted }) {
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
        <HelperText id="ob-display-name-hint">Up to 30 characters. Shown as your name to matches.</HelperText>
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
        <HelperText id="ob-tagline-hint">One line that tells people what you&apos;re about</HelperText>
      </div>

      <div>
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
        <HelperText id="ob-dob-hint">You must be 18 or older to use Spectrum Dating.</HelperText>
        <InlineError id="ob-dob-error">{attempted ? errors.dateOfBirth : ""}</InlineError>
      </div>
    </>
  );
}

// ─── Step 2: Bio + Interests ───────────────────────────────────────────────────

function Step2({ bio, setBio, interests, setInterests, errors, attempted, prefersReduced }) {
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
        <HelperText id="ob-bio-hint">Minimum 20 characters, up to 500.</HelperText>
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
          Pick at least one — these help us find people you'll connect with.
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
          <h3
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
          </h3>
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

// ─── Step 3: Communication ─────────────────────────────────────────────────────

function Step3({ commNote, setCommNote, relationshipGoal, setRelationshipGoal, errors, attempted }) {
  const GOALS = [
    { value: "long-term", label: "Long-term relationship" },
    { value: "friendship", label: "Friendship" },
    { value: "open", label: "Open to anything" },
    { value: "", label: "Still figuring it out" },
  ];

  return (
    <>
      {/* Communication note */}
      <div style={{ marginBottom: 28 }}>
        <FieldLabel htmlFor="ob-comm-note">How you prefer to connect</FieldLabel>
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
          Tell matches how you like to connect — for example: written messages, clear back-and-forth, or a slower pace. Whatever fits you.
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
          What are you looking for?
        </legend>
        <div style={{ clear: "both" }}>
          {GOALS.map(({ value, label }) => (
            <label
              key={label}
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
        You&apos;re in control of who can reach you. Only people you and they have both
        said yes to can message you — no one can message you out of the blue.
      </p>
    </>
  );
}

// ─── Step 4: Who you'd like to meet (optional) ─────────────────────────────────

function Step4({
  gender, setGender,
  genderCustom, setGenderCustom,
  orientation, setOrientation,
  relationshipStructure, setRelationshipStructure,
  pronouns, setPronouns,
  seeking, setSeeking,
  prefAgeMin, prefAgeMax, setPrefAgeMin, setPrefAgeMax,
}) {
  const seekingSet = seeking.split(",").map((s) => s.trim()).filter(Boolean);
  // D-16 — "open to everyone" is the empty-seeking state. Making it an explicit,
  // selectable affordance (vs. the unlabelled "leave all unchecked") clears it up.
  const openToEveryone = seekingSet.length === 0;

  return (
    <>
      <p style={{ margin: "0 0 22px", fontSize: 16, color: t.textSoft, lineHeight: 1.55 }}>
        This helps us shape your Discover deck. All of it is optional — you can
        skip and adjust anytime in your profile.
      </p>

      <GenderField
        gender={gender}
        setGender={setGender}
        genderCustom={genderCustom}
        setGenderCustom={setGenderCustom}
        idPrefix="ob-gender"
      />

      <OrientationField orientation={orientation} setOrientation={setOrientation} />

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
        <HelperText id="ob-pronouns-hint">Shown on your profile so people address you correctly.</HelperText>
      </div>

      <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 6, float: "left", width: "100%" }}>
          Who do you want to meet?
        </legend>
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 10, clear: "both" }}>
          Choose who you'd like to meet, or stay open to everyone.
        </span>
        {[
          { value: "woman", label: "Women" },
          { value: "man", label: "Men" },
          { value: "nonbinary", label: "Nonbinary people" },
        ].map(({ value, label }) => {
          const checked = seekingSet.includes(value);
          return (
            <label key={value} htmlFor={`ob-seek-${value}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer" }}>
              <input
                id={`ob-seek-${value}`}
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? seekingSet.filter((x) => x !== value) : [...seekingSet, value];
                  setSeeking(next.join(","));
                }}
                style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
              />
              <span style={{ fontSize: 16, color: t.text }}>{label}</span>
            </label>
          );
        })}
        {/* D-16 — explicit "open to everyone" affordance. Selecting it clears the
            seeking set (the existing empty-seeking = match-everyone semantics);
            it auto-reflects whenever nothing is checked. */}
        <label
          htmlFor="ob-seek-everyone"
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${t.borderLight}` }}
        >
          <input
            id="ob-seek-everyone"
            type="checkbox"
            checked={openToEveryone}
            onChange={() => { if (!openToEveryone) setSeeking(""); }}
            style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
          />
          <span style={{ fontSize: 16, color: t.text }}>Open to everyone</span>
        </label>
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
  return (
    <>
      <p style={{ margin: "0 0 8px", fontSize: 16, color: t.text, lineHeight: 1.55, fontWeight: 600 }}>
        This is how Spectrum matches you differently.
      </p>
      <p style={{ margin: "0 0 22px", fontSize: 16, color: t.textSoft, lineHeight: 1.55 }}>
        We match on how you communicate and what your senses need — not just
        photos. It's optional and you can change it anytime, but this is the part
        that helps us find people who genuinely fit how you connect.
      </p>

      <LabelledSelect
        id="ob-comm-directness"
        label="Directness"
        helper="Shown on your profile. Change it anytime."
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
        helper="Shown on your profile. Change it anytime."
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
        helper="Shown on your profile. Change it anytime."
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
          A few topics you love going deep on — we use these to suggest people who
          light up about the same things. Optional, and easy to change later.
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

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // D33 — brief "You're all set" arrival beat after a successful save, before
  // the Discover feed. Low-stimulation confirmation; the user taps to enter.
  const [celebrating, setCelebrating] = useState(false);

  // Step 1 fields
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  // Step 2 fields
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState([]);

  // Step 3 fields
  const [commNote, setCommNote] = useState("");
  const [relationshipGoal, setRelationshipGoal] = useState("");

  // Step 4 fields — who you'd like to meet (optional)
  const [gender, setGender] = useState("");
  const [genderCustom, setGenderCustom] = useState(""); // self-describe free text
  const [orientation, setOrientation] = useState(""); // comma-joined; display only
  const [relationshipStructure, setRelationshipStructure] = useState(""); // D-14; display only
  const [pronouns, setPronouns] = useState("");
  const [seeking, setSeeking] = useState(""); // comma-joined: "woman,man,nonbinary"
  const [prefAgeMin, setPrefAgeMin] = useState(18);
  const [prefAgeMax, setPrefAgeMax] = useState(99);

  // Step 5 fields — how you communicate, the "moat" (optional)
  const [commDirectness, setCommDirectness] = useState("");
  const [commCadence, setCommCadence] = useState("");
  const [sensoryEnvironment, setSensoryEnvironment] = useState("");
  // D-17 Phase 2 — matchable "Could talk for hours about" chips (optional, ≤3×40).
  const [specialInterests, setSpecialInterests] = useState([]);

  // Validation
  const [attempted, setAttempted] = useState(false);

  // Focus management
  const headingRef = useRef(null);
  const prefersReduced = usePrefersReduced();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";

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

  // ── Validation per step ──────────────────────────────────────────────────────

  function validateStep1() {
    const errs = {};
    if (!displayName.trim()) errs.displayName = "Enter a display name to continue.";
    if (!dateOfBirth) {
      errs.dateOfBirth = "Enter your date of birth to continue.";
    } else {
      const age = ageFromDob(dateOfBirth);
      if (age === null) {
        errs.dateOfBirth = "Enter a valid date of birth.";
      } else if (age < 18) {
        errs.dateOfBirth = "You must be 18 or older to use Spectrum Dating.";
      }
    }
    return errs;
  }

  function validateStep2() {
    const errs = {};
    if (bio.trim().length < 20) errs.bio = "Your bio needs to be at least 20 characters.";
    if (interests.length === 0) errs.interests = "Choose at least one interest so we can find people you might connect with.";
    return errs;
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function handleContinue() {
    const errs = step === 1 ? validateStep1() : step === 2 ? validateStep2() : {};
    if (Object.keys(errs).length > 0) {
      setAttempted(true);
      // Move focus to the first invalid field so keyboard/SR users are taken to
      // the problem instead of being left on the Continue button (M1).
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

  const stepHeadings = [
    "Let's start with the basics",
    "Tell people about you",
    "How you communicate",
    "Who you'd like to meet",
    "How you communicate best",
  ];
  const TOTAL_STEPS = stepHeadings.length;

  // ── Continue / Save button ────────────────────────────────────────────────────
  const fContinue = useFocusable();
  const fBack = useFocusable();
  const fSkip = useFocusable();

  // Skip an optional step (4 & 5). On the last step this saves with whatever
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
  const isOptionalStep = step >= 4; // steps 4 & 5 are optional / skippable

  // D33 — "You're all set" arrival beat. Calm, low-stimulation: a soft spectrum
  // mark, a warm line, and a single clear button to enter. No confetti / sound /
  // motion / countdown — the user decides when to continue.
  if (celebrating) {
    const firstName = (displayName.trim().split(/\s+/)[0]) || "";
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
            You're all set{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p style={{ fontSize: 16, color: t.textSoft, margin: "0 0 20px", lineHeight: 1.6 }}>
            Your profile is ready. Take your time — there's no rush here.
          </p>
          {/* D-5 — a quiet "made for you" beat: name the promise, tying the
              forms they just filled to why Spectrum is different. Calm, framed. */}
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
            You told us how you communicate and what your senses need. From here,
            that's what we match on — not just photos.
          </p>
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
            Enter Spectrum
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

        {/* Step content */}
        {step === 1 && (
          <Step1
            displayName={displayName}
            setDisplayName={setDisplayName}
            tagline={tagline}
            setTagline={setTagline}
            dateOfBirth={dateOfBirth}
            setDateOfBirth={setDateOfBirth}
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
          <Step3
            commNote={commNote}
            setCommNote={setCommNote}
            relationshipGoal={relationshipGoal}
            setRelationshipGoal={setRelationshipGoal}
            errors={{}}
            attempted={attempted}
          />
        )}
        {step === 4 && (
          <Step4
            gender={gender}
            setGender={setGender}
            genderCustom={genderCustom}
            setGenderCustom={setGenderCustom}
            orientation={orientation}
            setOrientation={setOrientation}
            relationshipStructure={relationshipStructure}
            setRelationshipStructure={setRelationshipStructure}
            pronouns={pronouns}
            setPronouns={setPronouns}
            seeking={seeking}
            setSeeking={setSeeking}
            prefAgeMin={prefAgeMin}
            prefAgeMax={prefAgeMax}
            setPrefAgeMin={setPrefAgeMin}
            setPrefAgeMax={setPrefAgeMax}
          />
        )}
        {step === 5 && (
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
            {isLastStep ? (saving ? "Saving…" : "Save & start exploring") : "Continue"}
          </button>

          {/* Skip — only on the optional steps (4 & 5). Calm-by-design: these
              steps are never forced. On the last step, Skip saves with the
              fields left at their defaults. */}
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
              {isLastStep ? "I'll add this later" : "Skip this step"}
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
