import { useState, useEffect, useRef } from "react";
import { updateProfile } from "./api.js";
import { t } from "./tokens.js";
import Spectrum from "./Spectrum.jsx";

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
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
    fontSize: 15,
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
        fontSize: 15,
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
      style={{ display: "block", fontSize: 13, color: t.textSoft, marginTop: 4 }}
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
        fontSize: 13,
        color: t.danger,
        marginTop: 4,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
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
        border: `1.5px solid ${selected ? t.accentStrong : t.formBorder}`,
        background: selected ? t.accentStrong : t.surfaceAlt,
        color: selected ? "#fff" : t.textSoft,
        fontSize: 13,
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
          style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
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
          style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
        >
          {bioTouched ? `${500 - bio.length} remaining` : ""}
        </div>
        <InlineError id="ob-bio-error">{attempted ? errors.bio : ""}</InlineError>
      </div>

      {/* Interests */}
      <div>
        <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 15, color: t.text }}>
          Interests <span aria-hidden="true" style={{ color: t.danger, marginLeft: 3 }}>*</span>
        </p>
        <p id="ob-interests-hint" style={{ margin: "0 0 12px", fontSize: 13, color: t.textSoft }}>
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
                    background: t.accentStrong,
                    color: "#fff",
                    borderRadius: 24,
                    padding: "4px 4px 4px 12px",
                    fontSize: 13,
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
              fontSize: 13,
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
              style={{ display: "block", fontWeight: 600, fontSize: 15, color: t.text, marginBottom: 4 }}
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
              placeholder="Type and press Add"
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
              fontSize: 15,
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
          Tell matches how you prefer to connect — async messages, structured chat, low-pressure pacing, whatever fits you
        </HelperText>
      </div>

      {/* Relationship goal */}
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend
          style={{
            fontWeight: 600,
            fontSize: 15,
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
                fontSize: 15,
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

// ─── Main component ────────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  // Validation
  const [attempted, setAttempted] = useState(false);

  // Focus management
  const headingRef = useRef(null);
  const prefersReduced = usePrefersReduced();

  // Focus heading on step change
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

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
      await updateProfile({
        displayName: displayName.trim(),
        tagline,
        dateOfBirth,
        bio,
        interests,
        commNote,
        relationshipGoal,
      });
      onComplete();
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
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
    alignItems: "flex-start",
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
    boxShadow: "0 2px 12px rgba(36,51,45,0.08), 0 8px 32px rgba(36,51,45,0.05)",
  };

  const stepHeadings = [
    "Let's start with the basics",
    "Tell people about you",
    "How you communicate",
  ];

  // ── Continue / Save button ────────────────────────────────────────────────────
  const fContinue = useFocusable();
  const fBack = useFocusable();

  const isLastStep = step === 3;

  return (
    <div style={page}>
      {/* SR live region for step changes */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
      >
        {`Step ${step} of 3: ${stepHeadings[step - 1]}`}
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
          <Spectrum variant="progress" value={step} count={3} size={9} gap={5} />
          <span style={{ fontSize: 13, color: t.textMuted, letterSpacing: "0.02em" }}>
            Step {step} of 3
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
              border: `1px solid ${t.accentStrong}`,
              background: t.accentStrong,
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

          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              style={{
                background: "transparent",
                border: "none",
                color: t.accentStrong,
                fontSize: 15,
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
