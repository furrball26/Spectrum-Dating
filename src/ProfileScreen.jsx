import { useState, useRef, useEffect, useCallback } from "react";
import { getProfile, updateProfile, clearAuth, getProfileUploadUrl, addProfilePhoto, setPrimaryPhoto, deleteProfilePhoto, deleteAccount, getPromptCatalog, savePrompts } from "./api.js";
import { t } from "./tokens.js";
import VerifiedBadge from "./VerifiedBadge.jsx";

// ProfileScreen — Spectrum Dating
// Built to docs/specs/profile-screen.md + docs/architecture/profile-a11y.md
// Every interaction rule maps to a checklist item (P-1 … P-30).

// ─── Hooks ────────────────────────────────────────────────────────────────────

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

// P-22: gates all transitions on prefers-reduced-motion
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

// ─── Default profile ─────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  displayName: "",
  tagline: "",
  bio: "",
  interests: [],
  commNote: "",
  relationshipGoal: "",        // "" | "long-term" | "friendship" | "open"
  distanceCity: "",
  notificationTier: "in_app", // "in_app" | "silent_push" | "name_only"
  // Lifestyle attributes (optional, shown on profile)
  wantsChildren: "",          // "" | "yes" | "no" | "open"
  smoking: "",                // "" | "no" | "sometimes" | "yes"
  drinking: "",               // "" | "no" | "sometimes" | "yes"
  // Deal-breaker flags
  dbWantsChildren: false,
  dbNonSmoker: false,
  dbMustBeLocal: false,
  paused: false,
  // Communication-style & sensory "moat" dimensions (optional)
  commDirectness: "",     // "" | "direct" | "softened"
  commLiteral: "",        // "" | "literal" | "playful"
  commCadence: "",        // "" | "instant" | "daily" | "whenever"
  sensoryEnvironment: "", // "" | "quiet" | "lively" | "either"
  sensoryLighting: "",    // "" | "dim" | "bright" | "either"
  socialDuration: "",     // "" | "short" | "medium" | "long"
  contextCard: "",        // free text (≤300)
};

const SUGGESTED_INTERESTS = [
  "board games", "hiking", "baking", "reading", "cycling", "music",
  "cooking", "films", "photography", "gaming", "gardening", "crafts",
  "nature", "writing", "volunteering", "cats", "dogs", "travel",
  "history", "science", "art", "spreadsheets", "libraries",
  "birdwatching", "bookbinding", "quiet evenings",
];

// localStorage cache helpers (keep for getViewerInterests in SuggestionScreen compatibility)
function cacheProfile(profile) {
  try {
    localStorage.setItem("spectrum_profile", JSON.stringify(profile));
  } catch {}
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Small label + hint pattern used throughout
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

function ErrorText({ id, children }) {
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
      {children || ""}
    </span>
  );
}

// Shared input style
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
    fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
    outline: "none",
  };
}

// ─── Unsaved-changes dialog (P-23, P-24, P-25) ───────────────────────────────
function UnsavedDialog({ onSave, onDiscard, onCancel }) {
  const saveRef = useRef(null);
  const discardRef = useRef(null);
  const prefersReduced = usePrefersReduced();

  // Focus first button on open (P-23)
  useEffect(() => {
    saveRef.current?.focus();
  }, []);

  // Focus trap (P-24)
  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel(); // Escape = neither; return to profile (P-25)
      return;
    }
    if (e.key === "Tab") {
      const els = [saveRef.current, discardRef.current].filter(Boolean);
      const idx = els.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); els[els.length - 1]?.focus(); }
      } else {
        if (idx === els.length - 1 || idx === -1) { e.preventDefault(); els[0]?.focus(); }
      }
    }
  }

  const fSave = useFocusable();
  const fDiscard = useFocusable();

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
    boxShadow: "0 8px 32px rgba(36,51,45,0.18)",
    transition: prefersReduced ? "none" : "opacity 150ms ease",
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-heading"
        aria-describedby="unsaved-body"
        style={dialog}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="unsaved-heading"
          style={{ fontFamily: t.serif, fontSize: 22, margin: "0 0 10px", fontWeight: 700 }}
        >
          You have unsaved changes.
        </h2>
        <p id="unsaved-body" style={{ color: t.textSoft, margin: "0 0 24px" }}>
          Save your changes, or discard them and leave.
        </p>
        {/* DOM order: Discard first, Save and leave second — per spec */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            ref={saveRef}
            type="button"
            onClick={onSave}
            style={{
              minHeight: 48,
              padding: "12px 20px",
              borderRadius: 12,
              border: `1px solid ${t.positive}`,
              background: t.positive,
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              ...fSave.style,
            }}
            onFocus={fSave.onFocus}
            onBlur={fSave.onBlur}
          >
            Save and leave
          </button>
          <button
            ref={discardRef}
            type="button"
            onClick={onDiscard}
            style={{
              minHeight: 48,
              padding: "12px 20px",
              borderRadius: 12,
              border: `1px solid ${t.border}`,
              background: t.surface,
              color: t.text,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              ...fDiscard.style,
            }}
            onFocus={fDiscard.onFocus}
            onBlur={fDiscard.onBlur}
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Photo gallery ────────────────────────────────────────────────────────────
const MAX_PHOTOS = 6;

// Single existing-photo cell
function PhotoCell({ photo, onSetPrimary, onRemove }) {
  const fPrimary = useFocusable();
  const fRemove = useFocusable();
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${t.border}`,
          background: "#EEF1ED",
        }}
      >
        <img
          src={photo.url}
          alt={photo.isPrimary ? "Your main profile photo" : "Profile photo"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {photo.isPrimary && (
          <span
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              background: t.accentStrong,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              letterSpacing: "0.02em",
            }}
          >
            Main
          </span>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {!photo.isPrimary && (
          <button
            type="button"
            onClick={() => onSetPrimary(photo.id)}
            aria-label="Set as main photo"
            {...fPrimary}
            style={{
              minHeight: 44,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${t.formBorder}`,
              background: t.surface,
              color: t.accentStrong,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              ...fPrimary.style,
            }}
          >
            Set as main
          </button>
        )}

        {confirming ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={() => { onRemove(photo.id); setConfirming(false); }}
              aria-label="Confirm remove photo"
              {...fRemove}
              style={{
                flex: 1,
                minHeight: 44,
                padding: "8px 6px",
                borderRadius: 8,
                border: `1px solid ${t.danger}`,
                background: t.danger,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                ...fRemove.style,
              }}
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              aria-label="Cancel removing photo"
              style={{
                flex: 1,
                minHeight: 44,
                padding: "8px 6px",
                borderRadius: 8,
                border: `1px solid ${t.border}`,
                background: t.surface,
                color: t.text,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Remove photo"
            style={{
              minHeight: 44,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${t.danger}`,
              background: "transparent",
              color: t.danger,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// Add-photo tile (button that opens hidden file input)
function AddPhotoTile({ onAdd, uploading, disabled }) {
  const fileRef = useRef(null);
  const f = useFocusable();

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading || disabled}
        aria-label="Add photo"
        aria-busy={uploading}
        {...f}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          border: `2px dashed ${t.formBorder}`,
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
        accept="image/jpeg,image/png,image/webp,image/gif"
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAdd(file);
          e.target.value = ""; // reset so same file can be re-selected
        }}
      />
    </div>
  );
}

function PhotoGallery({ photos, uploading, error, onAdd, onSetPrimary, onRemove }) {
  const atMax = photos.length >= MAX_PHOTOS;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        role="list"
        aria-label="Your profile photos"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {photos.map((photo) => (
          <div role="listitem" key={photo.id}>
            <PhotoCell
              photo={photo}
              onSetPrimary={onSetPrimary}
              onRemove={onRemove}
            />
          </div>
        ))}
        {!atMax && (
          <div role="listitem">
            <AddPhotoTile onAdd={onAdd} uploading={uploading} disabled={atMax} />
          </div>
        )}
      </div>

      <p style={{ fontSize: 13, color: t.textSoft, margin: "10px 0 0" }}>
        Add up to {MAX_PHOTOS} photos. Your main photo is what people see first.
      </p>

      {error && (
        <span role="alert" style={{ display: "block", fontSize: 13, color: t.danger, marginTop: 8 }}>
          {error}
        </span>
      )}
    </div>
  );
}

// ─── Push notification toggle ─────────────────────────────────────────────────
function NotificationToggle({ enabled, supported, onEnable, onDisable }) {
  const f = useFocusable();
  if (!supported) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: t.text }}>
          Push notifications
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: t.textSoft }}>
          Get notified about new matches and messages
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={enabled ? onDisable : onEnable}
        {...f}
        style={{
          position: "relative",
          width: 48,
          height: 28,
          borderRadius: 14,
          background: enabled ? t.accentStrong : t.border,
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.2s",
          ...f.style,
        }}
        aria-label={enabled ? "Disable push notifications" : "Enable push notifications"}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            left: enabled ? 23 : 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

// ─── Lifestyle select (calm labelled dropdown) ───────────────────────────────
function LifestyleSelect({ id, label, helper, value, options, onChange }) {
  const f = useFocusable();
  return (
    <div style={{ marginBottom: 20 }}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        value={value}
        aria-describedby={`${id}-hint`}
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
      <HelperText id={`${id}-hint`}>{helper}</HelperText>
    </div>
  );
}

// ─── Deal-breaker toggle (reuses the notification switch pattern) ─────────────
function DealBreakerToggle({ id, label, checked, onChange }) {
  const f = useFocusable();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <p id={`${id}-label`} style={{ margin: 0, fontSize: 15, fontWeight: 500, color: t.text }}>
        {label}
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={() => onChange(!checked)}
        {...f}
        style={{
          position: "relative",
          width: 48,
          height: 28,
          borderRadius: 14,
          background: checked ? t.accentStrong : t.border,
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.2s",
          ...f.style,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 23 : 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

// ─── Pause toggle (backlog #8 — reuses the switch pattern) ────────────────────
function PauseToggle({ checked, onChange }) {
  const f = useFocusable();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <p id="pause-profile-label" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: t.text }}>
        Pause my profile
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby="pause-profile-label"
        onClick={() => onChange(!checked)}
        {...f}
        style={{
          position: "relative",
          width: 48,
          height: 28,
          borderRadius: 14,
          background: checked ? t.accentStrong : t.border,
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.2s",
          ...f.style,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 23 : 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

// ─── Prompts (Hinge-style) ────────────────────────────────────────────────────
const MAX_PROMPTS = 3;
const PROMPT_ANSWER_MAX = 200;

// Editor for a single filled prompt slot: shows the prompt text, an editable
// answer textarea (≤200, live counter), and a Remove control.
function PromptSlot({ index, promptText, answer, onChangeAnswer, onRemove }) {
  const taId = `prompt-answer-${index}`;
  const counterId = `prompt-answer-${index}-counter`;
  const [touched, setTouched] = useState(false);
  return (
    <div
      style={{
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        marginBottom: 12,
        background: t.surfaceAlt,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <p style={{ margin: 0, fontFamily: t.serif, fontSize: 16, fontWeight: 700, color: t.text, lineHeight: 1.4 }}>
          {promptText}
        </p>
        <RemovePromptButton onRemove={onRemove} promptText={promptText} />
      </div>
      <label htmlFor={taId} style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        Your answer to: {promptText}
      </label>
      <textarea
        id={taId}
        maxLength={PROMPT_ANSWER_MAX}
        rows={3}
        aria-describedby={counterId}
        value={answer}
        onChange={(e) => { onChangeAnswer(e.target.value); setTouched(true); }}
        onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
        onBlur={(e) => { e.target.style.outline = "none"; }}
        style={{ ...inputStyle(false), resize: "vertical", minHeight: 72, lineHeight: 1.55 }}
        placeholder="Your answer"
      />
      <div
        role="status"
        aria-live="polite"
        id={counterId}
        style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
      >
        {touched ? `${PROMPT_ANSWER_MAX - answer.length} remaining` : ""}
      </div>
    </div>
  );
}

function RemovePromptButton({ onRemove, promptText }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove prompt: ${promptText}`}
      {...f}
      style={{
        flexShrink: 0,
        minHeight: 44,
        minWidth: 44,
        padding: "8px 12px",
        borderRadius: 8,
        border: `1px solid ${t.formBorder}`,
        background: t.surface,
        color: t.textSoft,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        ...f.style,
      }}
    >
      Remove
    </button>
  );
}

// Chooser shown when adding a prompt: a select of catalog prompts not already
// chosen, then a textarea for the answer.
function PromptChooser({ available, onAdd, onCancel }) {
  const [key, setKey] = useState("");
  const [answer, setAnswer] = useState("");
  const [touched, setTouched] = useState(false);
  const fSelect = useFocusable();
  const fAdd = useFocusable();
  const fCancel = useFocusable();
  const selected = available.find((p) => p.key === key);
  const canAdd = !!key && answer.trim() !== "";

  return (
    <div
      style={{
        border: `1px dashed ${t.formBorder}`,
        borderRadius: 12,
        padding: "16px 14px",
        marginBottom: 12,
        background: t.surface,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <FieldLabel htmlFor="prompt-chooser-select">Choose a prompt</FieldLabel>
        <select
          id="prompt-chooser-select"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          {...fSelect}
          style={{ ...inputStyle(false), minHeight: 44, appearance: "auto", cursor: "pointer", ...fSelect.style }}
        >
          <option value="">Select a prompt…</option>
          {available.map((p) => (
            <option key={p.key} value={p.key}>{p.text}</option>
          ))}
        </select>
      </div>

      {selected && (
        <div style={{ marginBottom: 14 }}>
          <FieldLabel htmlFor="prompt-chooser-answer">Your answer</FieldLabel>
          <textarea
            id="prompt-chooser-answer"
            maxLength={PROMPT_ANSWER_MAX}
            rows={3}
            aria-describedby="prompt-chooser-answer-counter"
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); setTouched(true); }}
            onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
            onBlur={(e) => { e.target.style.outline = "none"; }}
            style={{ ...inputStyle(false), resize: "vertical", minHeight: 72, lineHeight: 1.55 }}
            placeholder="Your answer"
          />
          <div
            role="status"
            aria-live="polite"
            id="prompt-chooser-answer-counter"
            style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
          >
            {touched ? `${PROMPT_ANSWER_MAX - answer.length} remaining` : ""}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => { if (canAdd) onAdd(key, answer.trim()); }}
          disabled={!canAdd}
          {...fAdd}
          style={{
            minHeight: 44,
            padding: "10px 18px",
            borderRadius: 10,
            border: `1px solid ${canAdd ? t.accentStrong : t.border}`,
            background: canAdd ? t.accentStrong : t.surfaceAlt,
            color: canAdd ? "#fff" : t.textMuted,
            fontSize: 15,
            fontWeight: 600,
            cursor: canAdd ? "pointer" : "not-allowed",
            ...fAdd.style,
          }}
        >
          Add prompt
        </button>
        <button
          type="button"
          onClick={onCancel}
          {...fCancel}
          style={{
            minHeight: 44,
            padding: "10px 18px",
            borderRadius: 10,
            border: `1px solid ${t.border}`,
            background: t.surface,
            color: t.text,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            ...fCancel.style,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProfileScreen({ onDone, onSignOut, onAccountDeleted, pushEnabled, pushSupported, onEnablePush, onDisablePush }) {
  // Photo gallery (up to 6, one primary)
  const [photos, setPhotos] = useState([]); // [{ id, url, isPrimary, position }]
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  // Identity verification status (read-only from /profile/me). Declared here with
  // the other hooks — before the loading/error early returns — so the hook count
  // stays constant across renders (React #310 / a hook-after-return crashed prod).
  const [verified, setVerified] = useState(false);

  // All form fields (initialised to defaults; overwritten by API load in useEffect)
  const [displayName, setDisplayName] = useState(DEFAULT_PROFILE.displayName);
  const [tagline, setTagline]         = useState(DEFAULT_PROFILE.tagline);
  const [bio, setBio]                 = useState(DEFAULT_PROFILE.bio);
  const [interests, setInterests]     = useState(DEFAULT_PROFILE.interests);
  const [commNote, setCommNote]       = useState(DEFAULT_PROFILE.commNote);
  const [relGoal, setRelGoal]         = useState(DEFAULT_PROFILE.relationshipGoal);
  const [distCity, setDistCity]       = useState(DEFAULT_PROFILE.distanceCity);
  const [notifTier, setNotifTier]     = useState(DEFAULT_PROFILE.notificationTier);

  // Lifestyle attributes (optional)
  const [wantsChildren, setWantsChildren] = useState(DEFAULT_PROFILE.wantsChildren);
  const [smoking, setSmoking]             = useState(DEFAULT_PROFILE.smoking);
  const [drinking, setDrinking]           = useState(DEFAULT_PROFILE.drinking);
  // Deal-breaker toggles
  const [dbWantsChildren, setDbWantsChildren] = useState(DEFAULT_PROFILE.dbWantsChildren);
  const [dbNonSmoker, setDbNonSmoker]         = useState(DEFAULT_PROFILE.dbNonSmoker);
  const [dbMustBeLocal, setDbMustBeLocal]     = useState(DEFAULT_PROFILE.dbMustBeLocal);
  // Pause / snooze (backlog #8) — declared with the other hooks, before early returns.
  const [paused, setPaused]                   = useState(DEFAULT_PROFILE.paused);

  // Communication-style & sensory "moat" dimensions (optional) — declared here
  // with the other hooks, BEFORE the loading/error early returns, so the hook
  // count stays constant across renders (React #310 / a hook-after-return crashed prod).
  const [commDirectness, setCommDirectness]       = useState(DEFAULT_PROFILE.commDirectness);
  const [commLiteral, setCommLiteral]             = useState(DEFAULT_PROFILE.commLiteral);
  const [commCadence, setCommCadence]             = useState(DEFAULT_PROFILE.commCadence);
  const [sensoryEnvironment, setSensoryEnvironment] = useState(DEFAULT_PROFILE.sensoryEnvironment);
  const [sensoryLighting, setSensoryLighting]     = useState(DEFAULT_PROFILE.sensoryLighting);
  const [socialDuration, setSocialDuration]       = useState(DEFAULT_PROFILE.socialDuration);
  const [contextCard, setContextCard]             = useState(DEFAULT_PROFILE.contextCard);
  const [contextCardTouched, setContextCardTouched] = useState(false);

  // Hinge-style prompts (max 3). `prompts` is [{ promptKey, answer }];
  // `promptCatalog` is [{ key, text }]. Both declared with the other hooks,
  // BEFORE the loading/error early returns (no hook-after-return).
  const [prompts, setPrompts]               = useState([]);
  const [promptCatalog, setPromptCatalog]   = useState([]);
  const [showPromptChooser, setShowPromptChooser] = useState(false);

  // savedProfile mirrors the last-known server state, used for isDirty comparison
  const [savedProfile, setSavedProfile] = useState(null);
  const [hasEverSaved, setHasEverSaved] = useState(false); // P-27: framing copy gate
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(null);

  // Character counter visibility (P-4: show only after first keystroke)
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [bioTouched, setBioTouched]                 = useState(false);

  // Validation
  const [hasSaveAttempted, setHasSaveAttempted] = useState(false); // P-2: gate aria-invalid
  const [displayNameError, setDisplayNameError] = useState("");
  const [interestsError, setInterestsError]     = useState("");
  const [saveErrorSummary, setSaveErrorSummary] = useState("");

  // Save confirmation
  const [saveStatus, setSaveStatus] = useState(""); // P-6: "Saved." via role="status"

  // Unsaved changes guard
  const [isDirty, setIsDirty] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const preFocusRef = useRef(null); // P-25: store pre-dialog focus

  // Custom interest input
  const [customTagInput, setCustomTagInput] = useState("");

  // SR announcement for tag add/remove (P-13, P-14)
  const [tagAnnouncement, setTagAnnouncement] = useState("");

  // Refs for focus management
  const headingRef       = useRef(null);
  const displayNameRef   = useRef(null);
  const interestsErrorRef = useRef(null);
  const addInputRef       = useRef(null);
  const saveButtonRef     = useRef(null);
  const removeRefs        = useRef([]); // array of refs to remove buttons

  const prefersReduced = usePrefersReduced();
  // Must be declared with the other hooks — BEFORE the loading/error early
  // returns below — or the hook count changes between renders (React #310).
  const fDone = useFocusable();

  // P-1: focus heading on mount
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Fetch the prompt catalog on mount (own effect, declared before returns).
  useEffect(() => {
    getPromptCatalog()
      .then((cat) => setPromptCatalog(Array.isArray(cat) ? cat : []))
      .catch(() => { /* best-effort — chooser simply shows no options */ });
  }, []);

  // Load profile from API on mount
  useEffect(() => {
    getProfile()
      .then(data => {
        const merged = {
          displayName: data.displayName || '',
          tagline: data.tagline || '',
          bio: data.bio || '',
          interests: Array.isArray(data.interests) ? data.interests : [],
          commNote: data.commNote || '',
          relationshipGoal: data.relationshipGoal || '',
          distanceCity: data.distCity || '',
          notificationTier: data.notificationTier || 'in_app',
          wantsChildren: data.wantsChildren || '',
          smoking: data.smoking || '',
          drinking: data.drinking || '',
          dbWantsChildren: !!data.dbWantsChildren,
          dbNonSmoker: !!data.dbNonSmoker,
          dbMustBeLocal: !!data.dbMustBeLocal,
          paused: !!data.paused,
          commDirectness: data.commDirectness || '',
          commLiteral: data.commLiteral || '',
          commCadence: data.commCadence || '',
          sensoryEnvironment: data.sensoryEnvironment || '',
          sensoryLighting: data.sensoryLighting || '',
          socialDuration: data.socialDuration || '',
          contextCard: data.contextCard || '',
        };
        setDisplayName(merged.displayName);
        setTagline(merged.tagline);
        setBio(merged.bio);
        setInterests(merged.interests);
        setCommNote(merged.commNote);
        setRelGoal(merged.relationshipGoal);
        setDistCity(merged.distanceCity);
        setNotifTier(merged.notificationTier);
        setWantsChildren(merged.wantsChildren);
        setSmoking(merged.smoking);
        setDrinking(merged.drinking);
        setDbWantsChildren(merged.dbWantsChildren);
        setDbNonSmoker(merged.dbNonSmoker);
        setDbMustBeLocal(merged.dbMustBeLocal);
        setPaused(merged.paused);
        setCommDirectness(merged.commDirectness);
        setCommLiteral(merged.commLiteral);
        setCommCadence(merged.commCadence);
        setSensoryEnvironment(merged.sensoryEnvironment);
        setSensoryLighting(merged.sensoryLighting);
        setSocialDuration(merged.socialDuration);
        setContextCard(merged.contextCard);
        setSavedProfile(merged);
        setHasEverSaved(!!merged.displayName);
        setVerified(!!data.verified);
        // Prompts — map server shape ({ promptKey, promptText, answer }) to the
        // editable shape ({ promptKey, answer }); cap at MAX_PROMPTS defensively.
        if (Array.isArray(data.prompts)) {
          setPrompts(
            data.prompts
              .filter((p) => p && p.promptKey)
              .slice(0, MAX_PROMPTS)
              .map((p) => ({ promptKey: p.promptKey, answer: p.answer || "" }))
          );
        }
        cacheProfile(merged);
        if (Array.isArray(data.photos)) setPhotos(data.photos);
      })
      .catch(() => setLoadError('Could not load your profile. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  // Track dirty state
  useEffect(() => {
    if (!savedProfile) {
      // Never saved before — dirty if any field has content
      const hasContent =
        displayName || tagline || bio || interests.length > 0 ||
        commNote || relGoal || distCity || notifTier !== "in_app" ||
        wantsChildren || smoking || drinking ||
        dbWantsChildren || dbNonSmoker || dbMustBeLocal || paused ||
        commDirectness || commLiteral || commCadence ||
        sensoryEnvironment || sensoryLighting || socialDuration || contextCard;
      setIsDirty(hasContent);
    } else {
      const dirty =
        displayName      !== savedProfile.displayName ||
        tagline          !== savedProfile.tagline ||
        bio              !== savedProfile.bio ||
        commNote         !== savedProfile.commNote ||
        relGoal          !== savedProfile.relationshipGoal ||
        distCity         !== savedProfile.distanceCity ||
        notifTier        !== savedProfile.notificationTier ||
        wantsChildren    !== savedProfile.wantsChildren ||
        smoking          !== savedProfile.smoking ||
        drinking         !== savedProfile.drinking ||
        dbWantsChildren  !== savedProfile.dbWantsChildren ||
        dbNonSmoker      !== savedProfile.dbNonSmoker ||
        dbMustBeLocal    !== savedProfile.dbMustBeLocal ||
        paused           !== savedProfile.paused ||
        commDirectness   !== savedProfile.commDirectness ||
        commLiteral      !== savedProfile.commLiteral ||
        commCadence      !== savedProfile.commCadence ||
        sensoryEnvironment !== savedProfile.sensoryEnvironment ||
        sensoryLighting  !== savedProfile.sensoryLighting ||
        socialDuration   !== savedProfile.socialDuration ||
        contextCard      !== savedProfile.contextCard ||
        JSON.stringify([...interests].sort()) !==
          JSON.stringify([...(savedProfile.interests || [])].sort());
      setIsDirty(dirty);
    }
  }, [displayName, tagline, bio, interests, commNote, relGoal, distCity, notifTier, wantsChildren, smoking, drinking, dbWantsChildren, dbNonSmoker, dbMustBeLocal, paused, commDirectness, commLiteral, commCadence, sensoryEnvironment, sensoryLighting, socialDuration, contextCard, savedProfile]);

  // ── Announce tag add/remove and clear after 300ms (P-13, P-14)
  function announce(msg) {
    setTagAnnouncement(msg);
    setTimeout(() => setTagAnnouncement(""), 300);
  }

  // ── Friendly message for storage-unavailable (503) / generic errors
  function photoErrorMessage(e) {
    if (e && e.status === 503) {
      return "Photo uploads aren't available right now. Please try again later.";
    }
    return (e && e.message) || "Photo upload failed. Please try again.";
  }

  // ── Add a photo to the gallery
  const handleAddPhoto = useCallback(async (file) => {
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      setPhotoError(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const MAX = 10 * 1024 * 1024;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(file.type)) {
      setPhotoError("Please choose a JPEG, PNG, WebP, or GIF.");
      return;
    }
    if (file.size > MAX) {
      setPhotoError("Photo must be under 10 MB.");
      return;
    }
    setPhotoError("");
    setPhotoUploading(true);
    try {
      // 1. Get presigned URL
      const { uploadUrl, key } = await getProfileUploadUrl(file.type);
      // 2. Upload directly to R2
      const upload = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed");
      // 3. Register the photo with the backend; returns the full ordered list
      const result = await addProfilePhoto(key);
      setPhotos(result);
    } catch (e) {
      setPhotoError(photoErrorMessage(e));
    } finally {
      setPhotoUploading(false);
    }
  }, [photos.length]);

  // ── Choose a new main photo
  const handleSetPrimary = useCallback((id) => {
    setPhotoError("");
    setPrimaryPhoto(id)
      .then(setPhotos)
      .catch((e) => setPhotoError(photoErrorMessage(e)));
  }, []);

  // ── Remove a photo
  const handleRemovePhoto = useCallback((id) => {
    setPhotoError("");
    deleteProfilePhoto(id)
      .then(setPhotos)
      .catch((e) => setPhotoError(photoErrorMessage(e)));
  }, []);

  // ── Interest toggle (suggestion chip)
  function toggleInterest(tag) {
    setInterests((prev) => {
      if (prev.includes(tag)) {
        announce(`Removed: ${tag}`);
        return prev.filter((t) => t !== tag);
      } else {
        announce(`Added: ${tag}`);
        return [...prev, tag];
      }
    });
    if (interestsError) setInterestsError("");
  }

  // ── Add custom tag
  function handleAddTag() {
    const val = customTagInput.trim().toLowerCase();
    if (!val) return;
    if (interests.includes(val)) {
      // silent duplicate — do not clear input (P-17 / a11y spec §4.3)
      return;
    }
    announce(`Added: ${val}`);
    setInterests((prev) => [...prev, val]);
    setCustomTagInput("");
    if (interestsError) setInterestsError("");
    // Focus stays in input (P-13 per a11y spec §1)
    // No programmatic focus move needed — input was already focused
  }

  // ── Remove tag with focus cascade (P-12)
  function removeTag(tag) {
    const idx = interests.indexOf(tag);
    announce(`Removed: ${tag}`);
    const next = interests.filter((t) => t !== tag);
    setInterests(next);

    requestAnimationFrame(() => {
      if (next.length === 0) {
        addInputRef.current?.focus();
      } else if (idx < next.length) {
        removeRefs.current[idx]?.focus();
      } else {
        removeRefs.current[next.length - 1]?.focus();
      }
    });
  }

  // ── Validate + save
  async function handleSave() {
    setHasSaveAttempted(true);
    const nameErr = displayName.trim() === "" ? "Enter a display name to continue." : "";
    const intErr  = interests.length === 0
      ? "Choose at least one interest so we can find people you might connect with."
      : "";

    setDisplayNameError(nameErr);
    setInterestsError(intErr);

    if (nameErr || intErr) {
      setSaveErrorSummary("Please fix the errors below before saving.");
      // P-7: focus first invalid field
      if (nameErr) {
        displayNameRef.current?.focus();
      } else {
        interestsErrorRef.current?.focus();
      }
      return;
    }

    setSaveErrorSummary("");
    const currentProfile = {
      displayName: displayName.trim(),
      tagline,
      bio,
      interests,
      commNote,
      relationshipGoal: relGoal,
      distanceCity: distCity,
      notificationTier: notifTier,
      wantsChildren,
      smoking,
      drinking,
      dbWantsChildren,
      dbNonSmoker,
      dbMustBeLocal,
      paused,
      commDirectness,
      commLiteral,
      commCadence,
      sensoryEnvironment,
      sensoryLighting,
      socialDuration,
      contextCard,
    };

    try {
      await updateProfile({
        displayName: currentProfile.displayName,
        tagline: currentProfile.tagline,
        bio: currentProfile.bio,
        interests: currentProfile.interests,
        commNote: currentProfile.commNote,
        relationshipGoal: currentProfile.relationshipGoal,
        distCity: currentProfile.distanceCity,
        notificationTier: currentProfile.notificationTier,
        wantsChildren: currentProfile.wantsChildren,
        smoking: currentProfile.smoking,
        drinking: currentProfile.drinking,
        dbWantsChildren: currentProfile.dbWantsChildren,
        dbNonSmoker: currentProfile.dbNonSmoker,
        dbMustBeLocal: currentProfile.dbMustBeLocal,
        paused: currentProfile.paused,
        commDirectness: currentProfile.commDirectness,
        commLiteral: currentProfile.commLiteral,
        commCadence: currentProfile.commCadence,
        sensoryEnvironment: currentProfile.sensoryEnvironment,
        sensoryLighting: currentProfile.sensoryLighting,
        socialDuration: currentProfile.socialDuration,
        contextCard: currentProfile.contextCard,
      });
      // Save prompts alongside the main profile (best-effort). Only send valid,
      // non-empty entries. Errors surface but don't block the profile save.
      try {
        await savePrompts(
          prompts
            .filter((p) => p.promptKey && p.answer.trim())
            .map((p) => ({ promptKey: p.promptKey, answer: p.answer.trim() }))
        );
      } catch {
        setSaveErrorSummary("Your profile saved, but your prompts couldn't be saved. Please try again.");
      }
      cacheProfile(currentProfile);  // keep localStorage in sync for SuggestionScreen
      setSavedProfile(currentProfile);
      setHasEverSaved(true);
      setIsDirty(false);
      setSaveStatus("Saved.");
      // P-6: focus stays on Save button — no programmatic move
      setTimeout(() => setSaveStatus(""), 3000);
    } catch {
      setSaveErrorSummary('Could not save. Please check your connection and try again.');
    }
  }

  // ── Prompt editing
  function handleAddPrompt(promptKey, answer) {
    setPrompts((prev) => {
      if (prev.length >= MAX_PROMPTS || prev.some((p) => p.promptKey === promptKey)) return prev;
      return [...prev, { promptKey, answer }];
    });
    setShowPromptChooser(false);
  }

  function handleChangePromptAnswer(index, answer) {
    setPrompts((prev) => prev.map((p, i) => (i === index ? { ...p, answer } : p)));
  }

  function handleRemovePrompt(index) {
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  }

  // Catalog prompts not already chosen — used by the chooser select.
  const availablePrompts = promptCatalog.filter(
    (c) => !prompts.some((p) => p.promptKey === c.key)
  );
  function promptTextFor(promptKey) {
    return promptCatalog.find((c) => c.key === promptKey)?.text || promptKey;
  }

  // ── Unsaved-changes guard
  function handleDone() {
    if (isDirty) {
      preFocusRef.current = document.activeElement; // P-25: store pre-dialog focus
      setShowDialog(true);
    } else {
      onDone?.();
    }
  }

  async function handleDialogSave() {
    await handleSave();
    setShowDialog(false);
    onDone?.();
  }

  function handleDialogDiscard() {
    setShowDialog(false);
    onDone?.();
  }

  function handleDialogCancel() {
    // Escape — neither option; remain on profile screen (P-25)
    setShowDialog(false);
    requestAnimationFrame(() => {
      preFocusRef.current?.focus();
    });
  }

  // ── Derived
  const saveDisabled = displayName.trim() === "" || interests.length === 0;

  // ── Styles
  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
    fontSize: 16,
    lineHeight: 1.65,
    padding: "20px 16px 60px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: 540, margin: "0 auto" };
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: "0 2px 8px rgba(36,51,45,0.07), 0 8px 24px rgba(36,51,45,0.04)",
  };
  const fieldGroup = { marginBottom: 20 };
  const h2Style = {
    fontFamily: t.serif,
    fontSize: 20,
    fontWeight: 700,
    margin: "0 0 18px",
    color: t.text,
  };

  // ── Loading / error states
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: t.bgGradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: t.textSoft, fontSize: 16 }}>Loading your profile…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', background: t.bgGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p role="alert" style={{ color: t.danger, fontSize: 16, textAlign: 'center' }}>{loadError}</p>
      </div>
    );
  }

  // ── Header
  return (
    <>
      {showDialog && (
        <UnsavedDialog
          onSave={handleDialogSave}
          onDiscard={handleDialogDiscard}
          onCancel={handleDialogCancel}
        />
      )}

      {/* Off-screen SR announcement region (P-13, P-14) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          left: -9999,
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        {tagAnnouncement}
      </div>

      {/* Save error summary — assertive (P-7) */}
      {saveErrorSummary && (
        <div
          role="alert"
          aria-live="assertive"
          id="save-error-summary"
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: t.danger,
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            zIndex: 50,
            maxWidth: 380,
            textAlign: "center",
          }}
        >
          {saveErrorSummary}
        </div>
      )}

      <div style={page}>

        {/* ── Header ── */}
        <div style={{ ...shell, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontFamily: t.serif, fontWeight: 700, fontSize: 19, letterSpacing: "-0.01em" }}>
            Spectrum
          </span>
          <button
            type="button"
            onClick={handleDone}
            style={{
              background: "transparent",
              border: "none",
              color: t.accentStrong,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px 0",
              minHeight: 44,
              minWidth: 44,
              ...fDone.style,
            }}
            onFocus={fDone.onFocus}
            onBlur={fDone.onBlur}
          >
            Done
          </button>
        </div>

        <div style={shell}>

          {/* P-1: heading receives focus on mount */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 6px" }}>
            <h1
              ref={headingRef}
              tabIndex={-1}
              style={{
                fontFamily: t.serif,
                fontSize: 28,
                fontWeight: 700,
                margin: 0,
                color: t.text,
                outline: "none",
              }}
            >
              Your profile
            </h1>
            {verified && <VerifiedBadge />}
          </div>

          {/* P-27: framing copy — first-time only */}
          {!hasEverSaved && (
            <p style={{ color: t.textSoft, fontSize: 15, margin: "0 0 20px", lineHeight: 1.6 }}>
              Tell us a bit about yourself. You control what people see — none of this
              is required except your display name and at least one interest.
            </p>
          )}

          {/* ══════════════════════════════════════════════════════
              CARD 1 — About you
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>About you</h2>

            <PhotoGallery
              photos={photos}
              uploading={photoUploading}
              error={photoError}
              onAdd={handleAddPhoto}
              onSetPrimary={handleSetPrimary}
              onRemove={handleRemovePhoto}
            />

            {/* Display name */}
            <div style={fieldGroup}>
              <FieldLabel htmlFor="display-name" required>Display name</FieldLabel>
              <input
                ref={displayNameRef}
                id="display-name"
                type="text"
                maxLength={30}
                aria-required="true"
                aria-describedby="display-name-hint display-name-error"
                aria-invalid={hasSaveAttempted && displayName.trim() === "" ? "true" : undefined}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDisplayNameTouched(true);
                  if (displayNameError) setDisplayNameError("");
                }}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(hasSaveAttempted && displayName.trim() === "")}
                placeholder=""
              />
              <HelperText id="display-name-hint">
                30 characters maximum. Shown as your name on match cards.
              </HelperText>
              {/* P-4, P-5: counter visible only after first keystroke */}
              <div
                role="status"
                aria-live="polite"
                id="display-name-counter"
                style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
              >
                {displayNameTouched ? `${30 - displayName.length} remaining` : ""}
              </div>
              {/* P-2: aria-invalid and error only after save attempt */}
              <ErrorText id="display-name-error">
                {hasSaveAttempted ? displayNameError : ""}
              </ErrorText>
            </div>

            {/* Tagline */}
            <div style={fieldGroup}>
              <FieldLabel htmlFor="tagline">Tagline</FieldLabel>
              <input
                id="tagline"
                type="text"
                maxLength={80}
                aria-describedby="tagline-hint"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="One sentence about you (optional)"
              />
              <HelperText id="tagline-hint">
                80 characters maximum. Optional — shown under your name on match cards.
              </HelperText>
            </div>

            {/* Bio */}
            <div style={fieldGroup}>
              <FieldLabel htmlFor="bio">Bio</FieldLabel>
              <textarea
                id="bio"
                maxLength={500}
                rows={4}
                aria-describedby="bio-hint bio-counter"
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  setBioTouched(true);
                }}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={{
                  ...inputStyle(false),
                  resize: "vertical",
                  minHeight: 88,
                  lineHeight: 1.55,
                }}
                placeholder="Anything you'd like people to know (optional)"
              />
              <HelperText id="bio-hint">
                500 characters maximum. Optional — shown on your profile card.
              </HelperText>
              {/* P-4, P-5 */}
              <div
                role="status"
                aria-live="polite"
                id="bio-counter"
                style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
              >
                {bioTouched ? `${500 - bio.length} remaining` : ""}
              </div>
            </div>

            {/* Communication style note */}
            <div style={{ ...fieldGroup, marginBottom: 0 }}>
              <FieldLabel htmlFor="communication-style">Communication style</FieldLabel>
              <input
                id="communication-style"
                type="text"
                maxLength={120}
                aria-describedby="communication-style-hint"
                value={commNote}
                onChange={(e) => setCommNote(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="e.g. Prefers to text first · Slow replies are fine · No surprise calls please"
              />
              <HelperText id="communication-style-hint">
                120 characters maximum. Optional — shown on match cards as "About talking: [your text]".
              </HelperText>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — Prompts (Hinge-style)
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>Prompts</h2>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px", lineHeight: 1.6 }}>
              Answer up to 3 prompts — an easy way to share who you are without a blank page.
            </p>

            {prompts.map((p, idx) => (
              <PromptSlot
                key={p.promptKey}
                index={idx}
                promptText={promptTextFor(p.promptKey)}
                answer={p.answer}
                onChangeAnswer={(val) => handleChangePromptAnswer(idx, val)}
                onRemove={() => handleRemovePrompt(idx)}
              />
            ))}

            {prompts.length < MAX_PROMPTS && (
              showPromptChooser ? (
                <PromptChooser
                  available={availablePrompts}
                  onAdd={handleAddPrompt}
                  onCancel={() => setShowPromptChooser(false)}
                />
              ) : (
                <AddPromptButton
                  onClick={() => setShowPromptChooser(true)}
                  disabled={availablePrompts.length === 0}
                />
              )
            )}
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD 2 — Interests
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>Your interests</h2>

            <p
              id="interests-helper"
              style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px" }}
            >
              Select at least one. These help us find people you'll connect with.
            </p>

            {/* Selected tags list (P-10, P-11) */}
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
                {interests.map((tag, idx) => {
                  return (
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
                        <RemoveButton
                          tag={tag}
                          idx={idx}
                          removeRefs={removeRefs}
                          onRemove={removeTag}
                          prefersReduced={prefersReduced}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Suggestion chips (P-15, P-16) */}
            <div
              role="group"
              aria-labelledby="suggestions-heading"
              style={{ marginBottom: 20 }}
            >
              <h3
                id="suggestions-heading"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: t.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 10px",
                }}
              >
                Suggested interests
              </h3>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
              >
                {SUGGESTED_INTERESTS.map((tag) => {
                  const selected = interests.includes(tag);
                  return (
                    <SuggestionChip
                      key={tag}
                      tag={tag}
                      selected={selected}
                      onToggle={toggleInterest}
                      prefersReduced={prefersReduced}
                    />
                  );
                })}
              </div>
            </div>

            {/* Free-entry (P-17) */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="add-custom-tag"
                  style={{ display: "block", fontWeight: 600, fontSize: 15, color: t.text, marginBottom: 4 }}
                >
                  Add your own
                </label>
                <input
                  ref={addInputRef}
                  id="add-custom-tag"
                  type="text"
                  maxLength={30}
                  aria-describedby="custom-tag-hint"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleAddTag(); }
                  }}
                  onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                  onBlur={(e) => { e.target.style.outline = "none"; }}
                  style={inputStyle(false)}
                  placeholder="Type and press Add"
                />
                <HelperText id="custom-tag-hint">
                  Up to 30 characters. Press Enter to add. Interests appear on your match card.
                </HelperText>
              </div>
              <AddButton onAdd={handleAddTag} />
            </div>

            {/* Interests error (P-9) */}
            <span
              ref={interestsErrorRef}
              id="interests-error"
              role="alert"
              tabIndex={-1}
              style={{
                display: "block",
                marginTop: 12,
                fontSize: 13,
                color: t.danger,
                fontWeight: 500,
                outline: "none",
                minHeight: 18,
              }}
            >
              {hasSaveAttempted ? interestsError : ""}
            </span>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD 3 — About your search
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>About your search</h2>

            {/* Relationship goal */}
            <fieldset
              style={{
                border: "none",
                margin: "0 0 24px",
                padding: 0,
              }}
            >
              <legend
                style={{ fontWeight: 600, fontSize: 15, color: t.text, marginBottom: 12, float: "left", width: "100%" }}
              >
                What are you looking for?
              </legend>
              <div style={{ clear: "both" }}>
                {[
                  { value: "long-term", label: "Long-term relationship", desc: "This will be listed in the reasons why someone sees you." },
                  { value: "friendship", label: "Friendship first", desc: "This will be listed in the reasons why someone sees you." },
                  { value: "open", label: "Open to either", desc: "This will be listed in the reasons why someone sees you." },
                ].map(({ value, label, desc }) => (
                  <div key={value}>
                    <label
                      htmlFor={`rel-${value}`}
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
                        id={`rel-${value}`}
                        name="relationship-goal"
                        value={value}
                        checked={relGoal === value}
                        aria-describedby={`rel-${value}-desc`}
                        onChange={() => setRelGoal(value)}
                        style={{ accentColor: t.accentStrong, width: 18, height: 18, flexShrink: 0 }}
                      />
                      <span>{label}</span>
                    </label>
                    <span
                      id={`rel-${value}-desc`}
                      style={{ display: "block", fontSize: 13, color: t.textSoft, marginLeft: 30, marginBottom: 4 }}
                    >
                      {desc}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Distance city */}
            <div style={{ ...fieldGroup, marginBottom: 0 }}>
              <FieldLabel htmlFor="distance-city">Where are you based?</FieldLabel>
              <input
                id="distance-city"
                type="text"
                maxLength={100}
                aria-describedby="distance-help"
                value={distCity}
                onChange={(e) => setDistCity(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="e.g. Phoenix, AZ"
              />
              <span
                id="distance-help"
                style={{ display: "block", fontSize: 13, color: t.textSoft, marginTop: 4 }}
              >
                Used to show people near you. Approximate is fine.
              </span>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — Lifestyle
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>Lifestyle</h2>

            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px" }}>
              All optional. Anything you share here is shown on your profile.
            </p>

            <LifestyleSelect
              id="wants-children"
              label="Do you want children?"
              helper="Optional — shown on your profile."
              value={wantsChildren}
              onChange={setWantsChildren}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "open", label: "Open to it" },
              ]}
            />

            <LifestyleSelect
              id="smoking"
              label="Smoking"
              helper="Optional — shown on your profile."
              value={smoking}
              onChange={setSmoking}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "no", label: "No" },
                { value: "sometimes", label: "Sometimes" },
                { value: "yes", label: "Yes" },
              ]}
            />

            <LifestyleSelect
              id="drinking"
              label="Drinking"
              helper="Optional — shown on your profile."
              value={drinking}
              onChange={setDrinking}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "no", label: "No" },
                { value: "sometimes", label: "Sometimes" },
                { value: "yes", label: "Yes" },
              ]}
            />

            {/* Deal-breakers subsection */}
            <div style={{ marginTop: 8, paddingTop: 20, borderTop: `1px solid ${t.borderLight}` }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: t.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 6px",
                }}
              >
                Deal-breakers
              </h3>
              <p style={{ fontSize: 13, color: t.textSoft, margin: "0 0 16px", lineHeight: 1.6 }}>
                Deal-breakers hide people who clearly don't match. People who haven't said yet still show up.
              </p>

              <DealBreakerToggle
                id="db-wants-children"
                label="Only show me people who feel the same about children"
                checked={dbWantsChildren}
                onChange={setDbWantsChildren}
              />
              <DealBreakerToggle
                id="db-non-smoker"
                label="Only show me non-smokers"
                checked={dbNonSmoker}
                onChange={setDbNonSmoker}
              />
              <DealBreakerToggle
                id="db-must-be-local"
                label="Only show me people in my city"
                checked={dbMustBeLocal}
                onChange={setDbMustBeLocal}
              />
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — How you communicate (moat: comms-style + context card)
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>How you communicate</h2>

            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px" }}>
              This helps matches know how to talk with you. Optional.
            </p>

            <LifestyleSelect
              id="comm-directness"
              label="Directness"
              helper="Optional — shown on your profile."
              value={commDirectness}
              onChange={setCommDirectness}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "direct", label: "I prefer direct" },
                { value: "softened", label: "I prefer softened" },
              ]}
            />

            <LifestyleSelect
              id="comm-literal"
              label="Style"
              helper="Optional — shown on your profile."
              value={commLiteral}
              onChange={setCommLiteral}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "literal", label: "Literal" },
                { value: "playful", label: "Playful" },
              ]}
            />

            <LifestyleSelect
              id="comm-cadence"
              label="Reply pace"
              helper="Optional — shown on your profile."
              value={commCadence}
              onChange={setCommCadence}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "instant", label: "I like quick replies" },
                { value: "daily", label: "Once a day is great" },
                { value: "whenever", label: "Whenever works" },
              ]}
            />

            {/* "How to talk to me" context card */}
            <div style={{ marginTop: 8, paddingTop: 20, borderTop: `1px solid ${t.borderLight}` }}>
              <FieldLabel htmlFor="context-card">How to talk to me</FieldLabel>
              <textarea
                id="context-card"
                maxLength={300}
                rows={3}
                aria-describedby="context-card-hint context-card-counter"
                value={contextCard}
                onChange={(e) => {
                  setContextCard(e.target.value);
                  setContextCardTouched(true);
                }}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={{
                  ...inputStyle(false),
                  resize: "vertical",
                  minHeight: 80,
                  lineHeight: 1.55,
                }}
                placeholder="e.g. I info-dump when excited, it means I like you."
              />
              <HelperText id="context-card-hint">
                Optional. Share anything that helps people connect with you — e.g. "I info-dump when excited, it means I like you."
              </HelperText>
              <div
                role="status"
                aria-live="polite"
                id="context-card-counter"
                style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}
              >
                {contextCardTouched ? `${300 - contextCard.length} remaining` : ""}
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — Sensory & environment (moat: sensory prefs)
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>Sensory &amp; environment</h2>

            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px" }}>
              This helps matches know how to talk with you. Optional.
            </p>

            <LifestyleSelect
              id="sensory-environment"
              label="Preferred setting"
              helper="Optional — shown on your profile."
              value={sensoryEnvironment}
              onChange={setSensoryEnvironment}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "quiet", label: "Quiet" },
                { value: "lively", label: "Lively" },
                { value: "either", label: "Either is fine" },
              ]}
            />

            <LifestyleSelect
              id="sensory-lighting"
              label="Lighting"
              helper="Optional — shown on your profile."
              value={sensoryLighting}
              onChange={setSensoryLighting}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "dim", label: "Dim" },
                { value: "bright", label: "Bright" },
                { value: "either", label: "Either" },
              ]}
            />

            <LifestyleSelect
              id="social-duration"
              label="Social energy"
              helper="Optional — shown on your profile."
              value={socialDuration}
              onChange={setSocialDuration}
              options={[
                { value: "", label: "Prefer not to say" },
                { value: "short", label: "Short meetups" },
                { value: "medium", label: "Medium" },
                { value: "long", label: "Longer is fine" },
              ]}
            />
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD 4 — Notifications
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={h2Style}>Notifications</h2>

            <NotificationToggle
              enabled={pushEnabled}
              supported={pushSupported}
              onEnable={onEnablePush}
              onDisable={onDisablePush}
            />

            {pushSupported && <div style={{ height: 20 }} />}

            {/* P-18, P-19: fieldset + legend + per-radio describedby */}
            <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
              <legend
                style={{ fontWeight: 600, fontSize: 15, color: t.text, marginBottom: 12, float: "left", width: "100%" }}
              >
                Notification style
              </legend>
              <div style={{ clear: "both" }}>
                {[
                  {
                    value: "in_app",
                    id: "notif-off",
                    label: "Off",
                    desc: "You'll see a dot when you have new messages. Nothing will appear on your lock screen.",
                  },
                  {
                    value: "silent_push",
                    id: "notif-silent",
                    label: "Silent push",
                    desc: "Your phone will nudge you, but without showing any text.",
                  },
                  {
                    value: "name_only",
                    id: "notif-name",
                    label: "Name only",
                    desc: "Your phone shows who messaged you, but not what they said.",
                  },
                ].map(({ value, id, label, desc }) => (
                  <div key={value} style={{ marginBottom: 8 }}>
                    {/* P-20: entire row is touch target */}
                    <label
                      htmlFor={id}
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
                        id={id}
                        name="notification-tier"
                        value={value}
                        checked={notifTier === value}
                        aria-describedby={`${id}-desc`}
                        onChange={() => setNotifTier(value)}
                        style={{ accentColor: t.accentStrong, width: 18, height: 18, flexShrink: 0 }}
                      />
                      <span>{label}</span>
                    </label>
                    {/* P-19: always in DOM */}
                    <span
                      id={`${id}-desc`}
                      style={{ display: "block", fontSize: 13, color: t.textSoft, marginLeft: 30, marginBottom: 4 }}
                    >
                      {desc}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — Pause my profile (backlog #8)
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={{ ...h2Style, marginBottom: 12 }}>Pause my profile</h2>
            <PauseToggle checked={paused} onChange={setPaused} />
            {paused && (
              <p
                style={{
                  margin: "16px 0 0",
                  fontSize: 15,
                  color: t.textSoft,
                  lineHeight: 1.7,
                }}
              >
                Your profile is paused. You won't appear in Discover, and you can
                turn this back on anytime. Your matches and messages stay.
              </p>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════
              CARD — Identity verification
          ══════════════════════════════════════════════════════ */}
          <div style={card}>
            <h2 style={{ ...h2Style, marginBottom: 12 }}>Identity verification</h2>
            {verified ? (
              <p style={{ margin: 0, fontSize: 15, color: t.positive, fontWeight: 600, lineHeight: 1.6 }}>
                <span aria-hidden="true">✓</span> Your identity is verified.
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: 15, color: t.textSoft, lineHeight: 1.7 }}>
                  Identity verification is coming soon. It helps everyone trust they're
                  talking to a real person. We'll let you know when it's ready.
                </p>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    color: t.textMuted,
                    background: t.surfaceAlt,
                    border: `1px solid ${t.border}`,
                    letterSpacing: "0.01em",
                  }}
                >
                  Coming soon
                </span>
              </>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════
              Save button + status
          ══════════════════════════════════════════════════════ */}
          <SaveButton
            disabled={saveDisabled}
            onClick={handleSave}
            saveButtonRef={saveButtonRef}
          />

          {/* P-6: save status — polite live region, visible near button */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              textAlign: "center",
              minHeight: 24,
              fontSize: 14,
              fontWeight: 600,
              color: t.positive,
              marginTop: 8,
              transition: prefersReduced ? "none" : "opacity 200ms ease",
              opacity: saveStatus ? 1 : 0,
            }}
          >
            {saveStatus}
          </div>

          {/* ── Sign out ── */}
          {onSignOut && (
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: `1px solid ${t.borderLight}`, textAlign: "center" }}>
              <SignOutButton onSignOut={onSignOut} />
            </div>
          )}

          {/* ── Danger zone ── */}
          {onAccountDeleted && (
            <DeleteAccountSection onAccountDeleted={onAccountDeleted} />
          )}

        </div>
      </div>
    </>
  );
}

// ── Sign out button ───────────────────────────────────────────────────────────
function SignOutButton({ onSignOut }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onSignOut}
      {...f}
      style={{
        background: "transparent",
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        color: t.textSoft,
        fontSize: 15,
        fontWeight: 500,
        cursor: "pointer",
        padding: "10px 24px",
        minHeight: 44,
        ...f.style,
      }}
    >
      Sign out
    </button>
  );
}

// ── Danger zone: account deletion (backlog #18) ──────────────────────────────
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
      <p style={{ fontSize: 13, color: t.textSoft, margin: "0 0 14px" }}>
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
          fontSize: 15,
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
    boxShadow: "0 8px 32px rgba(36,51,45,0.18)",
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
          <span role="alert" style={{ display: "block", fontSize: 13, color: t.danger, marginTop: 8, fontWeight: 500 }}>
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

// ── Remove button (P-21: minHeight 44, minWidth 44) ──────────────────────────
function RemoveButton({ tag, idx, removeRefs, onRemove, prefersReduced }) {
  const f = useFocusable();

  // Register ref
  function setRef(el) {
    removeRefs.current[idx] = el;
  }

  return (
    <button
      ref={setRef}
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

// ── Suggestion chip (P-15, P-16) ─────────────────────────────────────────────
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

// ── Add button ────────────────────────────────────────────────────────────────
function AddButton({ onAdd }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-label="Add interest"
      onClick={onAdd}
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
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      Add
    </button>
  );
}

// ── Add-a-prompt button ───────────────────────────────────────────────────────
function AddPromptButton({ onClick, disabled }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        width: "100%",
        minHeight: 48,
        padding: "12px 18px",
        borderRadius: 12,
        border: `1.5px dashed ${disabled ? t.border : t.accentStrong}`,
        background: t.surface,
        color: disabled ? t.textMuted : t.accentStrong,
        fontSize: 15,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        ...f.style,
      }}
    >
      <span aria-hidden="true" style={{ marginRight: 6 }}>+</span>
      Add a prompt
    </button>
  );
}

// ── Save button (P-26: disabled not hidden) ───────────────────────────────────
function SaveButton({ disabled, onClick, saveButtonRef }) {
  const f = useFocusable();
  return (
    <button
      ref={saveButtonRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%",
        minHeight: 52,
        padding: "14px 24px",
        borderRadius: 14,
        border: `1px solid ${disabled ? t.border : t.positive}`,
        background: disabled ? t.surfaceAlt : t.positive,
        color: disabled ? t.textMuted : "#fff",
        fontSize: 17,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.01em",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      Save changes
    </button>
  );
}
