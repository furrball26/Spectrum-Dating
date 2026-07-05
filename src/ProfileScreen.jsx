import { useState, useRef, useEffect, useCallback } from "react";
import { getProfile, updateProfile, clearAuth, getProfileUploadUrl, addProfilePhoto, setPrimaryPhoto, deleteProfilePhoto, getPromptCatalog, savePrompts, getExportUrl, requestVerification, updatePhotoDescription, safeErrorMessage } from "./api.js";
import AudioAnswerEditor from "./AudioAnswerEditor.jsx";
import AudioAnswerCard from "./AudioAnswer.jsx";
import { t } from "./tokens.js";
import { ShieldIcon, GearIcon, LockIcon } from "./icons.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import SectionRule from "./SectionRule.jsx";
import PhotoCarousel from "./PhotoCarousel.jsx";
import { useFocusable, focusRing } from "./useFocusable.js";
import { GenderField, OrientationField, RelationshipStructureField } from "./IdentityFields.jsx";
import { splitFeaturedPrompt } from "./featuredPrompt.js";
import FeaturedInterest from "./FeaturedInterest.jsx";
import SpecialInterestsInput from "./SpecialInterestsInput.jsx";
import { normalizeSpecialInterests } from "./specialInterests.js";

// ProfileScreen — Spectrum Dating
// Built to docs/specs/profile-screen.md + docs/architecture/profile-a11y.md
// Every interaction rule maps to a checklist item (P-1 … P-30).

// ─── Hooks ────────────────────────────────────────────────────────────────────


// Visually hidden but exposed to assistive tech (mirrors App.jsx / .sr-only).
const srOnly = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};


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

// ─── Collapsible sections (mobile-overwhelm reduction) ───────────────────────
// Independent disclosures — opening one NEVER closes another (no single-open
// accordion). The always-visible "About you" core (photos/name/tagline/bio/
// commNote) is NOT collapsible. Persisted open/closed choices live under this
// localStorage key.
// v2: the 9 legacy per-topic sections (prompts/about/interests/search/lifestyle/
// communicate/sensory/notifications/verification/membership) were regrouped into
// top-level groups. The key is bumped so returning users don't inherit a
// stale/half-open map keyed by the retired section ids.
// v2 (profile redesign, Phase 1): Membership was pulled OUT of Account into its
// own peer group (order: About me → Looking for → Membership → Account). It
// reuses the same storage map — a new key isn't needed since `membership` just
// adds a boolean and defaults collapsed like everything else.
const SECTIONS_STORAGE_KEY = "spectrum_profile_sections_v2";

// The top-level collapsible GROUPS, in render order. Inside each group the
// former sections render as plain <h3> sub-headed blocks in one calm scroll —
// there are no nested accordions (double-hiding is the anti-pattern for this
// audience). This array drives Expand-all / Collapse-all and the default map.
const COLLAPSIBLE_SECTIONS = [
  "aboutMe",
  "lookingFor",
  "membership",
  "account",
];

function loadPersistedSections() {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function persistSections(open) {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(open));
  } catch {}
}

// A single collapsible disclosure. Header button lives inside the <h2> and
// controls a MOUNTED panel toggled via the `hidden` attribute (never
// unmounted — keeps in-progress edits + lifted field state alive). Focus stays
// on the header on expand; open/close is instant (no slide). A chevron rotates
// unless reduced motion is preferred.
function CollapsibleSection({ id, title, summary, hasContent, open, onToggle, headerStyle, cardStyle, children }) {
  const f = useFocusable();
  const prefersReduced = usePrefersReduced();
  const buttonId = `section-${id}-button`;
  const panelId = `section-${id}-panel`;

  // Accessible name folds in the summary so SR users hear it while collapsed.
  const accessibleName = summary ? `${title}, ${summary}` : title;

  return (
    <div style={cardStyle}>
      <h2 style={{ ...headerStyle, margin: 0 }}>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={accessibleName}
          onClick={onToggle}
          {...f}
          style={{
            width: "100%",
            minHeight: 44,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            background: "transparent",
            border: "none",
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            ...f.style,
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <span>{title}</span>
            {summary && (
              <span
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                  fontFamily: t.sans,
                  fontSize: 14,
                  fontWeight: 400,
                  color: t.textSoft,
                  lineHeight: 1.4,
                }}
              >
                {hasContent && (
                  <span aria-hidden="true" style={{ color: t.positiveText, fontWeight: 700 }}>✓</span>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
              </span>
            )}
          </span>
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              fontSize: 16,
              color: t.textMuted,
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: prefersReduced ? "none" : "transform 180ms cubic-bezier(0.2,0,0,1)",
              lineHeight: 1,
            }}
          >
            ⌄
          </span>
        </button>
      </h2>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        style={{ marginTop: open ? 18 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

// A plain sub-section heading rendered INSIDE a collapsible group. Purely
// presentational (no hooks — safe anywhere, including near .map bodies). Groups
// open to reveal all their sub-sections as headed blocks in one calm scroll;
// there are no nested accordions (double-hiding is the anti-pattern for this
// audience). Optional `id` lets a heading anchor scroll/labels if ever needed.
function SubHeading({ id, children }) {
  return (
    <h3
      id={id}
      style={{
        fontFamily: t.serif,
        fontSize: 17,
        fontWeight: 700,
        color: t.text,
        margin: "0 0 6px",
        lineHeight: 1.3,
      }}
    >
      {children}
    </h3>
  );
}

// A smaller heading INSIDE a sub-section (below <h3> SubHeading) — used to label
// the internal groupings of the consolidated "How to connect with me" module
// without adding more top-level <h3> blocks. Presentational, no hooks.
function ModuleLabel({ children, style }) {
  return (
    <h4
      style={{
        fontFamily: t.sans,
        fontSize: 15,
        fontWeight: 700,
        color: t.textSoft,
        letterSpacing: "0.01em",
        margin: "0 0 12px",
        ...style,
      }}
    >
      {children}
    </h4>
  );
}

// Divider between sub-sections within a group. Design-review finding: reserve the
// spectrum-ramp SectionRule for the ONE confident moment per screen (under the
// h1); sub-section dividers use a calm, neutral full-width hairline instead.
function SubDivider() {
  return (
    <div
      aria-hidden="true"
      style={{ height: 1, background: t.borderLight, margin: "28px 0 24px" }}
    />
  );
}

// The subtle "Companion" badge — a small presentational copy of the one on the
// Membership screen, inlined here so the code-split Profile chunk doesn't pull in
// the whole MembershipScreen module. No hooks. Shown only for Companion members.
function CompanionBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 11px",
        borderRadius: t.radius.pill,
        background: t.green100,
        border: `1px solid ${t.green300}`,
        color: t.accentStrong,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">✦</span>
      Companion
    </span>
  );
}

// ─── Default profile ─────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  displayName: "",
  tagline: "",
  bio: "",
  interests: [],
  // D-17 Phase 2 — matchable "Could talk for hours about" chips (≤3, ≤40 each).
  specialInterests: [],
  commNote: "",
  relationshipGoal: "",        // "" | "long-term" | "friendship" | "open"
  relationshipStructure: "",   // D-14; display only, never filters Discover
  distanceCity: "",
  searchRadiusMiles: 0,
  gender: "",
  genderCustom: "",
  orientation: "",
  pronouns: "",
  seeking: "",
  prefAgeMin: 18,
  prefAgeMax: 99,
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
  // F28 — structured "about me" facets (all optional)
  occupation: "",         // short free text (≤80)
  languages: "",          // short free text (≤120)
  helpsMe: [],            // string[] (≤5 items, each ≤60)
  hardForMe: [],          // string[] (≤5 items, each ≤60)
};

// Suggested-interest library — lightly categorized so a large set stays
// scannable and lowers the blank-box burden (feature-gap #4). Kept concrete and
// literal (autism-friendly) and inclusive of niche / special-interest options.
// All lowercase to match how interests are stored (toggleInterest / handleAddTag
// both lowercase). Groups render as calm labeled chip clusters; a lightweight
// client-side filter narrows the list without any counters or urgency.
const SUGGESTED_INTEREST_GROUPS = [
  {
    label: "Creative & making",
    items: [
      "drawing", "painting", "knitting", "crochet", "sewing", "pottery",
      "bookbinding", "calligraphy", "crafts", "photography", "jewelry making",
      "origami",
    ],
  },
  {
    label: "Games & tabletop",
    items: [
      "board games", "tabletop rpgs", "dungeons & dragons", "card games",
      "chess", "puzzles", "video games", "jigsaw puzzles", "strategy games",
      "retro gaming",
    ],
  },
  {
    label: "Outdoors & movement",
    items: [
      "hiking", "cycling", "walking", "running", "swimming", "camping",
      "rock climbing", "yoga", "gardening", "kayaking", "birdwatching",
    ],
  },
  {
    label: "Media & fandom",
    items: [
      "films", "tv series", "anime", "comics", "manga", "science fiction",
      "fantasy", "documentaries", "podcasts", "cosplay", "collecting",
    ],
  },
  {
    label: "Food & cooking",
    items: [
      "cooking", "baking", "bread making", "tea", "coffee", "vegetarian food",
      "meal prep", "fermenting", "cake decorating",
    ],
  },
  {
    label: "Learning & ideas",
    items: [
      "reading", "writing", "history", "science", "astronomy", "languages",
      "philosophy", "mathematics", "geography", "museums", "libraries",
    ],
  },
  {
    label: "Animals & nature",
    items: [
      "cats", "dogs", "birds", "aquariums", "horses", "reptiles", "wildlife",
      "insects", "marine life", "plants",
    ],
  },
  {
    label: "Calm & sensory-friendly",
    items: [
      "quiet evenings", "stargazing", "journaling", "meditation", "tidying",
      "candle making", "aromatherapy", "slow mornings", "people-watching",
      "cloud watching",
    ],
  },
  {
    label: "Tech & building",
    items: [
      "coding", "electronics", "robotics", "3d printing", "model building",
      "lego", "woodworking", "model trains", "home automation", "spreadsheets",
      "retro computing",
    ],
  },
  {
    label: "Music",
    items: [
      "playing guitar", "playing piano", "singing", "music production",
      "vinyl records", "concerts", "drumming", "songwriting",
      "listening to music", "choir",
    ],
  },
];

// Flat view of every suggestion (kept for any consumer that wants the full set).
const SUGGESTED_INTERESTS = SUGGESTED_INTEREST_GROUPS.flatMap((g) => g.items);

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

function ErrorText({ id, children }) {
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
    // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
    fontSize: 16,
    color: t.text,
    background: t.surface,
    fontFamily: t.sans,
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
    background: "rgba(var(--c-scrimRgb, 36, 51, 45),0.45)",
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
    boxShadow: t.shadow.lg,
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
              border: `1px solid ${t.positiveFill}`,
              background: t.positiveFill,
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
const DESC_MAX = 200;

// The alt text shown to assistive tech on the tile image itself. Reflects the
// saved description and the photo's position/primary status.
function photoImgAlt(photo, index) {
  const suffix = photo.isPrimary ? ", your main photo" : "";
  if (photo.description && photo.description.trim()) {
    return `Photo ${index}: ${photo.description.trim()}${suffix}`;
  }
  return `Photo ${index}, no description yet${suffix}`;
}

// A single selectable photo tile — image + "Main" badge only. Tapping it
// selects the photo and reveals the shared editor panel below the grid. All
// editing controls live in that panel, never overlaid on the image.
function PhotoCell({ photo, index, selected, onSelect, tileStyle, cellRef }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      ref={cellRef}
      onClick={() => onSelect(photo.id)}
      aria-pressed={selected}
      aria-label={`${photoImgAlt(photo, index)}. ${selected ? "Selected — editing below." : "Edit."}`}
      {...f}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        padding: 0,
        border: selected ? `2px solid ${t.accentStrong}` : `1px solid ${t.border}`,
        borderRadius: tileStyle.borderRadius,
        overflow: "hidden",
        background: t.surfaceAlt,
        cursor: "pointer",
        aspectRatio: tileStyle.aspectRatio,
        ...f.style,
      }}
    >
      <img
        src={photo.url}
        alt={photoImgAlt(photo, index)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {photo.isPrimary && (
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: t.accentFill,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            letterSpacing: "0.02em",
          }}
        >
          Main
        </span>
      )}
    </button>
  );
}

// The single per-photo editor panel — full-width, below the grid. Shows a
// thumbnail + heading, the alt-text field, and a horizontal action row.
// Re-mounted (via key) whenever the selected photo changes, so `desc` state
// resets cleanly to the newly selected photo's description.
function PhotoEditorPanel({
  photo, index, isOnlyPhoto, uploading, onReplace, onSetPrimary, onRemove, onDescriptionSaved, replaceBtnRef,
}) {
  const fDesc = useFocusable();
  const fPrimary = useFocusable();
  const fReplace = useFocusable();
  const fRemove = useFocusable();
  const fCancel = useFocusable();
  const replaceRef = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [desc, setDesc] = useState(photo.description || "");
  const [descSaving, setDescSaving] = useState(false);
  const [descError, setDescError] = useState("");

  const descId = `photo-desc-${photo.id}`;
  const hintId = `photo-desc-hint-${photo.id}`;
  const heading = photo.isPrimary ? "Editing: your main photo" : `Editing: photo ${index}`;

  async function saveDescription(value) {
    const trimmed = value.trim();
    if (trimmed === (photo.description || "")) return; // unchanged
    setDescSaving(true);
    setDescError("");
    try {
      await updatePhotoDescription(photo.id, trimmed);
      onDescriptionSaved(photo.id, trimmed);
    } catch {
      setDescError("Couldn't save description. Please try again.");
    } finally {
      setDescSaving(false);
    }
  }

  const outlineBtn = {
    minHeight: 44,
    padding: "10px 14px",
    borderRadius: 10,
    border: `1.5px solid ${t.formBorder}`,
    background: t.surface,
    color: t.accentStrong,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        background: t.surfaceAlt,
        borderRadius: 12,
        padding: 16,
        marginTop: 14,
      }}
    >
      {/* Thumbnail + heading */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <img
          src={photo.url}
          alt=""
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            objectFit: "cover",
            display: "block",
            flexShrink: 0,
            border: `1px solid ${t.border}`,
          }}
        />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.text }}>{heading}</h3>
      </div>

      {/* Pending human review — so a new photo that isn't visible to others yet
          doesn't just look broken. Existing (approved) photos are unaffected. */}
      {photo.pending && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            background: t.warningSurface,
            color: t.warningSurfaceText,
            border: `1px solid ${t.warningBorder}`,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true">⏳</span>
          <span>
            Pending review — a member of our team will take a look before others can
            see this photo. There's no rush, and your other photos stay visible.
          </span>
        </div>
      )}

      {/* Alt-text description */}
      <div>
        <label htmlFor={descId} style={{ display: "block", fontWeight: 600, fontSize: 14, color: t.textSoft, marginBottom: 4 }}>
          Describe this photo
          <span className="sr-only"> — photo {index}{photo.isPrimary ? ", your main photo" : ""}</span>
        </label>
        <textarea
          id={descId}
          value={desc}
          maxLength={DESC_MAX}
          rows={2}
          placeholder="e.g. Me hiking with my dog"
          aria-describedby={hintId}
          onChange={(e) => setDesc(e.target.value)}
          {...fDesc}
          onFocus={(e) => { fDesc.onFocus?.(e); }}
          onBlur={(e) => { fDesc.onBlur?.(e); saveDescription(e.target.value); }}
          style={{
            ...inputStyle(false),
            border: `1.5px solid ${t.textSoft}`,
            resize: "vertical",
            minHeight: 72,
            lineHeight: 1.55,
            opacity: descSaving ? 0.6 : 1,
            ...fDesc.style,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 4 }}>
          <span id={hintId} style={{ fontSize: 14, color: t.textSoft }}>
            Helps people who use screen readers. Optional.
          </span>
          <span aria-live="polite" style={{ fontSize: 14, color: desc.length >= DESC_MAX ? t.danger : t.textSoft, flexShrink: 0 }}>
            {desc.length}/{DESC_MAX}
          </span>
        </div>
        {descError && (
          <p role="alert" style={{ margin: "6px 0 0", fontSize: 14, color: t.danger }}>{descError}</p>
        )}
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {!photo.isPrimary && !confirming && (
          <button
            type="button"
            onClick={() => onSetPrimary(photo.id)}
            aria-label={`Set photo ${index} as main`}
            {...fPrimary}
            style={{ ...outlineBtn, ...fPrimary.style }}
          >
            Set as main
          </button>
        )}

        {!confirming && (
          <>
            <button
              type="button"
              ref={replaceBtnRef}
              onClick={() => replaceRef.current?.click()}
              disabled={uploading}
              aria-label={`Replace photo ${index}`}
              aria-busy={uploading}
              {...fReplace}
              style={{
                ...outlineBtn,
                cursor: uploading ? "wait" : "pointer",
                opacity: uploading ? 0.7 : 1,
                ...fReplace.style,
              }}
            >
              {uploading ? "Uploading…" : "Replace"}
            </button>
            <input
              ref={replaceRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-hidden="true"
              tabIndex={-1}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onReplace(photo.id, file);
                e.target.value = ""; // reset so same file can be re-selected
              }}
            />
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Remove photo ${index}`}
              {...fRemove}
              style={{
                ...outlineBtn,
                border: `1.5px solid ${t.danger}`,
                background: "transparent",
                color: t.danger,
                ...fRemove.style,
              }}
            >
              Remove
            </button>
          </>
        )}

        {confirming && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            {isOnlyPhoto && (
              <p role="alert" style={{ margin: 0, fontSize: 14, color: t.text, lineHeight: 1.5 }}>
                You'll have no photo, and you won't appear in Discover until you add
                one. Remove anyway?
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { onRemove(photo.id); setConfirming(false); }}
                aria-label={isOnlyPhoto ? "Remove anyway" : `Confirm removing photo ${index}`}
                {...fPrimary}
                style={{
                  ...outlineBtn,
                  // dangerFill (not danger) so white text passes AA in dim/navy,
                  // where `danger` is a light tint (white-on-it ~2.6:1).
                  border: `1.5px solid ${t.dangerFill}`,
                  background: t.dangerFill,
                  color: "#fff",
                  ...fPrimary.style,
                }}
              >
                {isOnlyPhoto ? "Remove anyway" : "Remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                aria-label={`Cancel removing photo ${index}`}
                {...fCancel}
                style={{
                  ...outlineBtn,
                  border: `1.5px solid ${t.border}`,
                  color: t.text,
                  ...fCancel.style,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Add-photo tile (button that opens hidden file input)
function AddPhotoTile({ onAdd, uploading, disabled, addBtnRef }) {
  const fileRef = useRef(null);
  const f = useFocusable();

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        type="button"
        id="add-photo-tile"
        ref={addBtnRef}
        onClick={() => fileRef.current?.click()}
        disabled={uploading || disabled}
        aria-label="Add photo"
        aria-busy={uploading}
        {...f}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          border: `2px dashed ${t.accentStrong}`,
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

function PhotoGallery({ photos, uploading, error, onAdd, onReplace, onSetPrimary, onRemove, onDescriptionSaved, name }) {
  const atMax = photos.length >= MAX_PHOTOS;
  const isEmpty = photos.length === 0;
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("");

  // Focus-restoration refs, keyed by photo id, for the tile buttons + Add tile.
  const tileRefs = useRef(new Map());
  const addBtnRef = useRef(null);
  const replaceBtnRef = useRef(null);
  const prevUploading = useRef(uploading);
  // Tracks an in-flight Replace so we can re-select the new photo + restore
  // focus once the upload completes (Replace assigns a new photo id).
  const replacingRef = useRef(null); // { wasPrimary, prevIds:Set }

  // Assign every photo a stable 1-based index by position order. The array is
  // already ordered by position; the primary photo is not necessarily first.
  const indexed = photos.map((p, i) => ({ photo: p, index: i + 1 }));
  const primaryEntry = indexed.find((e) => e.photo.isPrimary);
  const secondary = indexed.filter((e) => !e.photo.isPrimary);

  // Drop selection if the selected photo no longer exists (e.g. removed).
  // Skip while a Replace is in flight — the completion effect re-selects the
  // new photo, since Replace deletes the old id and adds a new one.
  useEffect(() => {
    if (replacingRef.current || uploading) return;
    if (selectedId && !photos.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [photos, selectedId, uploading]);

  // Announce upload start / finish via the live region, and — when the finished
  // upload was a Replace — re-select the new photo occupying that slot and
  // restore focus to its Replace button.
  useEffect(() => {
    if (uploading && !prevUploading.current) {
      setStatus(replacingRef.current ? "Replacing photo…" : "Uploading photo…");
    }
    if (!uploading && prevUploading.current) {
      setStatus(replacingRef.current ? "Photo replaced." : "Photo added.");
      const info = replacingRef.current;
      replacingRef.current = null;
      if (info) {
        const added = photos.find((p) => !info.prevIds.has(p.id));
        if (added) {
          setSelectedId(added.id);
          requestAnimationFrame(() => replaceBtnRef.current?.focus());
        }
      }
    }
    prevUploading.current = uploading;
  }, [uploading, photos]);

  const setTileRef = (id) => (el) => {
    if (el) tileRefs.current.set(id, el);
    else tileRefs.current.delete(id);
  };

  // Remove with focus restoration: move focus to another tile or the Add tile,
  // and announce the removal, before the selected photo unmounts.
  const handleRemoveWithFocus = (id) => {
    const removedIdx = indexed.find((e) => e.photo.id === id)?.index;
    const remaining = photos.filter((p) => p.id !== id);
    onRemove(id);
    setSelectedId(null);
    setStatus(removedIdx ? `Photo ${removedIdx} removed.` : "Photo removed.");
    // Move focus off the unmounting panel to the first remaining tile / Add tile.
    requestAnimationFrame(() => {
      const nextId = remaining[0]?.id;
      const target = (nextId && tileRefs.current.get(nextId)) || addBtnRef.current;
      target?.focus();
    });
  };

  // Kick off a Replace: snapshot the current photo ids so the completion
  // effect can identify the newly added photo and restore focus/selection.
  const handleReplaceWithFocus = (id, file) => {
    replacingRef.current = { prevIds: new Set(photos.map((p) => p.id)) };
    onReplace(id, file);
  };

  const selectedEntry = indexed.find((e) => e.photo.id === selectedId) || null;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Live region announcing photo actions to assistive tech. */}
      <div role="status" aria-live="polite" style={srOnly}>{status}</div>

      {/* Empty state — show the member's own default gradient avatar so the
          gallery never reads as "broken/missing photo" before they upload. */}
      {isEmpty && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <Avatar name={name} size={72} />
          <p style={{ margin: 0, fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
            This is your default avatar. Add a photo below whenever you're ready —
            there's no rush.
          </p>
        </div>
      )}

      <div role="list" aria-label="Your profile photos">
        {/* Tier A — main photo, full-width portrait */}
        {primaryEntry && (
          <div role="listitem" style={{ marginBottom: 10 }}>
            <PhotoCell
              photo={primaryEntry.photo}
              index={primaryEntry.index}
              selected={selectedId === primaryEntry.photo.id}
              onSelect={setSelectedId}
              cellRef={setTileRef(primaryEntry.photo.id)}
              tileStyle={{ aspectRatio: "4 / 5", borderRadius: 16 }}
            />
          </div>
        )}

        {/* Tier B — secondary photos + Add tile */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
          }}
        >
          {secondary.map((e) => (
            <div role="listitem" key={e.photo.id}>
              <PhotoCell
                photo={e.photo}
                index={e.index}
                selected={selectedId === e.photo.id}
                onSelect={setSelectedId}
                cellRef={setTileRef(e.photo.id)}
                tileStyle={{ aspectRatio: "1 / 1", borderRadius: 12 }}
              />
            </div>
          ))}
          {!atMax && (
            <div role="listitem">
              <AddPhotoTile onAdd={onAdd} uploading={uploading} disabled={atMax} addBtnRef={addBtnRef} />
            </div>
          )}
        </div>
      </div>

      {/* Per-photo editor panel — one at a time, below the grid. */}
      {selectedEntry && (
        <PhotoEditorPanel
          key={selectedEntry.photo.id}
          photo={selectedEntry.photo}
          index={selectedEntry.index}
          isOnlyPhoto={photos.length === 1}
          uploading={uploading}
          onReplace={handleReplaceWithFocus}
          onSetPrimary={onSetPrimary}
          onRemove={handleRemoveWithFocus}
          onDescriptionSaved={onDescriptionSaved}
          replaceBtnRef={replaceBtnRef}
        />
      )}

      <p style={{ fontSize: 14, color: t.textSoft, margin: "12px 0 0" }}>
        Add up to {MAX_PHOTOS} photos. Your main photo is what people see first.
      </p>

      {error && (
        <span role="alert" style={{ display: "block", fontSize: 14, color: t.danger, marginTop: 8 }}>
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
        <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: t.text }}>
          Push notifications
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 14, color: t.textSoft }}>
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
          transition: `background ${t.motion.base} ${t.motion.standard}`,
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
            transition: `left ${t.motion.base} ${t.motion.gentle}`,
            boxShadow: t.shadow.sm,
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
      <p id={`${id}-label`} style={{ margin: 0, fontSize: 16, fontWeight: 500, color: t.text }}>
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
          transition: `background ${t.motion.base} ${t.motion.standard}`,
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
            transition: `left ${t.motion.base} ${t.motion.gentle}`,
            boxShadow: t.shadow.sm,
          }}
        />
      </button>
    </div>
  );
}

// ─── Pause toggle (backlog #8 — reuses the switch pattern) ────────────────────
// ─── Prompts (Hinge-style) ────────────────────────────────────────────────────
const MAX_PROMPTS = 3;
const PROMPT_ANSWER_MAX = 200;

// ─── Static profile-writing assist (free, client-side — no API, no LLM) ───────
// Calm, opt-in "ways to start" an answer. Tapping one drops a short example
// starter into the answer box as an EDITABLE draft the user then finishes in
// their own words — never auto-filled, never content-aware. Scaffolding beats a
// blank box, especially for autistic users. This stays free (Tier 1) forever;
// the paid Companion is only the future LLM/content-aware version. Keyed by the
// stable catalog keys (server/src/data/prompts.js — ~40 after the richer-prompts
// pass); GENERIC_STARTERS covers any key not yet mapped.
const PROMPT_STARTERS = {
  a_perfect_day: [
    "A slow morning with coffee and no plans, then…",
    "Somewhere quiet outdoors, then a favourite meal at home…",
  ],
  talk_for_hours: [
    "I could go deep on…",
    "Ask me about… and I won't stop.",
  ],
  comfortable_when: [
    "I know the plan and the people, and…",
    "Somewhere calm and familiar, where…",
  ],
  small_joy: [
    "The first sip of tea in the morning…",
    "Finding a song that fits exactly how I feel…",
  ],
  recharge: [
    "A quiet evening on my own with…",
    "Time outside, no phone, just…",
  ],
  looking_for: [
    "Someone patient and kind who…",
    "A person I can be quiet with, and who…",
  ],
  communicate_best: [
    "I do best with direct, literal messages, and…",
    "I like clear plans and a little time to reply…",
  ],
  green_flag: [
    "Someone who says what they mean, plainly…",
    "When a person respects that I need time to…",
  ],
  weekend: [
    "On a long, slow walk somewhere calm, then…",
    "At home with a project I'm slowly working on…",
  ],
  passionate: [
    "I could spend a whole afternoon on…",
    "I get really into…",
  ],
  good_first_meet: [
    "A short coffee somewhere quiet, so we can actually hear each other…",
    "A calm walk with no pressure, then…",
  ],
  understand_me: [
    "I mean exactly what I say, so…",
    "It helps to know I need a little time to…",
  ],
  // ── Richer-prompts pass — gentle starters for the new catalog keys. Voice
  //    mirrors the 12 above: calm, concrete, first-person, editable drafts.
  routine_i_love: [
    "Every morning I…",
    "The same walk, the same coffee, and…",
  ],
  learning_now: [
    "Lately I've been slowly getting into…",
    "I'm teaching myself…",
  ],
  message_lights_me_up: [
    "A clear \"here's the plan\" message…",
    "When someone remembers a small thing I mentioned…",
  ],
  feel_myself_place: [
    "At home with the lights low and…",
    "In a quiet corner of the library, where…",
  ],
  partner_understand: [
    "I need a little time to process before I reply, and…",
    "When I go quiet it usually means…",
  ],
  low_key_evening: [
    "Dinner at home, a familiar film, and…",
    "No plans, comfy clothes, and…",
  ],
  comfort_meal: [
    "The same simple dinner I never get tired of…",
    "Something warm and easy, like…",
  ],
  calming_sound: [
    "Rain on the window while I…",
    "The low hum of…",
  ],
  happily_return_to: [
    "I've read/watched it more times than I can count…",
    "I go back to it whenever I need something familiar…",
  ],
  makes_me_laugh: [
    "A gentle, silly thing that always gets me…",
    "I can't help laughing at…",
  ],
  quietly_good_at: [
    "I'm quietly good at…",
    "People are sometimes surprised that I can…",
  ],
  calm_sunday: [
    "A slow start, then…",
    "No alarm, tea, and a little bit of…",
  ],
  easiest_to_start: [
    "Ask me a clear, specific question about…",
    "Just say hello and tell me one true thing about your day…",
  ],
  proud_of: [
    "I once made…",
    "It took me a while, but I finished…",
  ],
  cozy_setup: [
    "Soft blanket, warm light, and…",
    "My favourite chair, a hot drink, and…",
  ],
  care_about: [
    "I care a lot about…",
    "I could gently talk for a while about…",
  ],
  dating_pace: [
    "Slow and steady suits me — I like to…",
    "No rush; I do best when we…",
  ],
  like_knowing_plan: [
    "Knowing the plan helps me relax, so…",
    "A clear time and place, and I'm at ease…",
  ],
  animal_i_adore: [
    "I completely melt for…",
    "I could watch them all day…",
  ],
  collect_or_organise: [
    "I quietly collect…",
    "I love sorting and arranging my…",
  ],
  on_repeat: [
    "I've had this on repeat lately…",
    "The song I keep coming back to is…",
  ],
  hands_busy: [
    "It keeps my hands busy and my mind calm…",
    "I like the steady rhythm of…",
  ],
  favourite_season: [
    "I feel most at home when it's…",
    "Everything feels right in…",
  ],
  simple_pleasure: [
    "A small thing that never gets old…",
    "I never get tired of…",
  ],
  show_i_care: [
    "I show I care by…",
    "I remember the little things and…",
  ],
  good_date_feels: [
    "Calm, unhurried, and easy to be myself…",
    "Somewhere quiet where we can actually hear each other…",
  ],
  ask_me_about: [
    "Ask me about…",
    "Get me started on…",
  ],
  safe_and_settled: [
    "A familiar routine and a bit of quiet…",
    "Knowing what to expect helps me feel settled…",
  ],
};

// Fallback "ways to start" for any prompt key not in the map above.
const GENERIC_STARTERS = [
  "One honest thing about me is…",
  "Something small but true…",
];

function startersFor(promptKey) {
  const list = PROMPT_STARTERS[promptKey];
  return list && list.length ? list : GENERIC_STARTERS;
}

// Append or set a starter into an answer without clobbering existing text, and
// respecting the 200-char cap. Empty box → the starter becomes the draft; text
// already there → the starter is appended after a space. Predictable either way.
function withStarter(answer, starter) {
  const base = answer.trim() === "" ? starter : `${answer} ${starter}`;
  return base.slice(0, PROMPT_ANSWER_MAX);
}

// One tappable starter chip. useFocusable lives at the component top level (never
// inside a .map body) so hook order stays stable — React #310 house rule.
function StarterButton({ text, onUse }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={() => onUse(text)}
      aria-label={`Use this starting point: ${text}`}
      {...f}
      style={{
        display: "inline-block",
        textAlign: "left",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 44,
        padding: "8px 14px",
        borderRadius: 999,
        border: `1.5px solid ${t.formBorder}`,
        background: t.surface,
        color: t.accentStrong,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.4,
        cursor: "pointer",
        ...f.style,
      }}
    >
      {text}
    </button>
  );
}

// ─── Typed low-pressure "choice" prompts (profile redesign §3b) ────────────────
// A non-writing way to self-express: the member picks ONE of a small fixed set of
// calm options. Rendered as an accessible single-select radiogroup of chips
// (native <input type="radio"> for full keyboard + screen-reader support, styled
// as calm chips). The chosen option becomes the prompt's `answer`.
//
// HARD GUARDRAIL (product law): this shows the member's OWN pick as self-
// expression ONLY — never a vote tally, count, "% chose this", or comparison to
// others. There is no aggregate surface anywhere here, by design.
function PromptChoiceGroup({ name, options, value, onChange, labelId }) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0, marginTop: 4 }}
    >
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <label
            key={opt}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              maxWidth: "100%",
              minWidth: 0,
              minHeight: 44,
              padding: "8px 14px",
              borderRadius: 999,
              border: `1.5px solid ${selected ? t.accentFill : t.formBorder}`,
              background: selected ? t.surfaceAlt : t.surface,
              color: t.text,
              fontSize: 15,
              fontWeight: selected ? 600 : 500,
              lineHeight: 1.4,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt}
              checked={selected}
              onChange={() => onChange(opt)}
              style={{ accentColor: t.accentFill, width: 18, height: 18, margin: 0, flexShrink: 0, cursor: "pointer" }}
            />
            <span style={{ minWidth: 0 }}>{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

// The calm affordance shown under an EMPTY answer box: a soft label + framing +
// 1–2 tappable example starters. Purely a writing aid — no counters, no urgency,
// opt-in, and it never blocks typing your own answer.
function PromptStarters({ promptKey, onUse }) {
  const starters = startersFor(promptKey);
  if (!starters.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
        Need a starting point? No pressure — just a starting point you can change.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
        {starters.map((s, i) => (
          <StarterButton key={i} text={s} onUse={onUse} />
        ))}
      </div>
    </div>
  );
}

// Editor for a single filled prompt slot. For a TEXT prompt: the prompt text, an
// editable answer textarea (≤200, live counter) + starters. For a CHOICE prompt:
// the prompt text + an accessible single-select radiogroup of its options (no
// textarea, no counter, no starters — you pick, you don't write).
function PromptSlot({ index, promptKey, promptText, answer, promptType, options, onChangeAnswer, onRemove }) {
  const taId = `prompt-answer-${index}`;
  const counterId = `prompt-answer-${index}-counter`;
  const labelId = `prompt-label-${index}`;
  const [touched, setTouched] = useState(false);
  const answerRef = useRef(null);
  const isChoice = promptType === "choice";

  function insertStarter(text) {
    onChangeAnswer(withStarter(answer, text));
    setTouched(true);
    // Focus the box and drop the caret at the end so they can keep typing.
    requestAnimationFrame(() => {
      const el = answerRef.current;
      if (el) { el.focus(); const end = el.value.length; el.setSelectionRange(end, end); }
    });
  }
  return (
    <div
      data-prompt-card
      style={{
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        marginBottom: 12,
        background: t.surfaceAlt,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        {/* Prompt text as a quiet eyebrow label; the answer below is the prominent
            content — mirrors the card-per-idea layout in the preview. */}
        <p id={labelId} style={{
          margin: 0,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 600,
          color: t.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          lineHeight: 1.4,
        }}>
          {promptText}
        </p>
        <RemovePromptButton onRemove={onRemove} promptText={promptText} />
      </div>
      {isChoice ? (
        // CHOICE prompt: a single-select radiogroup of the fixed options. The
        // chosen option IS the answer — no free text, no counter, no starters.
        <PromptChoiceGroup
          name={`prompt-choice-${index}`}
          options={options}
          value={answer}
          onChange={onChangeAnswer}
          labelId={labelId}
        />
      ) : (
        <>
          <label htmlFor={taId} style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
            Your answer to: {promptText}
          </label>
          <textarea
            id={taId}
            ref={answerRef}
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
            style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
          >
            {touched ? `${PROMPT_ANSWER_MAX - answer.length} remaining` : ""}
          </div>
          {answer.trim() === "" && (
            <PromptStarters promptKey={promptKey} onUse={insertStarter} />
          )}
        </>
      )}
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
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        ...f.style,
      }}
    >
      Remove
    </button>
  );
}

// ─── F28: "About me" facets ────────────────────────────────────────────────────
// Two short free-text facets (occupation, languages) live inline in the section.
// The two list facets ("Things that help me" / "…are hard for me") use the
// repeatable editor below. All optional and clearly skippable.
const FACET_ITEM_MAX = 60;   // per-item char cap (matches server MAX_FACET_ITEM_LEN)
const FACET_MAX_ITEMS = 5;   // max rows (matches server MAX_FACET_ITEMS)

// One editable list row: text input (≤60) + Remove. useFocusable lives at the
// component top level (never inside a parent .map) so hook order stays stable —
// React #310 house rule.
function FacetRow({ id, value, index, label, onChange, onRemove }) {
  const fRemove = useFocusable();
  const inputId = `${id}-item-${index}`;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
      <label htmlFor={inputId} style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        {label} — item {index + 1}
      </label>
      <input
        id={inputId}
        type="text"
        maxLength={FACET_ITEM_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
        onBlur={(e) => { e.target.style.outline = "none"; }}
        style={{ ...inputStyle(false), flex: 1, minWidth: 0 }}
        placeholder="Add one thing"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} item ${index + 1}`}
        {...fRemove}
        style={{
          flexShrink: 0, minHeight: 44, minWidth: 44, padding: "8px 12px",
          borderRadius: 8, border: `1px solid ${t.formBorder}`, background: t.surface,
          color: t.textSoft, fontSize: 14, fontWeight: 600, cursor: "pointer", ...fRemove.style,
        }}
      >
        Remove
      </button>
    </div>
  );
}

// Repeatable short-list editor. `items` is a string[]; `onChange` receives the
// full next array. Caps at FACET_MAX_ITEMS. Empty rows are allowed while editing
// (they're trimmed/dropped by the save payload builder + the backend).
function FacetListEditor({ id, label, helper, items, onChange, addLabel }) {
  const fAdd = useFocusable();
  const atCap = items.length >= FACET_MAX_ITEMS;
  const setItem = (i, val) => onChange(items.map((it, idx) => (idx === i ? val : it)));
  const removeItem = (i) => onChange(items.filter((_, idx) => idx !== i));
  const addItem = () => { if (!atCap) onChange([...items, ""]); };

  return (
    <div style={{ marginBottom: 20 }} role="group" aria-label={label}>
      <div style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}>{label}</div>
      <HelperText id={`${id}-hint`}>{helper}</HelperText>
      <div style={{ marginTop: 8 }}>
        {items.map((it, i) => (
          <FacetRow
            key={i}
            id={id}
            index={i}
            value={it}
            label={label}
            onChange={(val) => setItem(i, val)}
            onRemove={() => removeItem(i)}
          />
        ))}
      </div>
      {atCap ? (
        <p style={{ margin: "4px 0 0", fontSize: 13, color: t.textMuted }}>
          That's the most you can add ({FACET_MAX_ITEMS}).
        </p>
      ) : (
        <button
          type="button"
          onClick={addItem}
          {...fAdd}
          style={{
            minHeight: 44, padding: "8px 14px", borderRadius: 10,
            border: `1px solid ${t.formBorder}`, background: t.surface,
            color: t.accentStrong, fontSize: 15, fontWeight: 600, cursor: "pointer", ...fAdd.style,
          }}
        >
          {addLabel || "Add another"}
        </button>
      )}
    </div>
  );
}

// Chooser shown when adding a prompt: a select of catalog prompts not already
// chosen, then a textarea for the answer.
function PromptChooser({ available, onAdd, onCancel }) {
  const [key, setKey] = useState("");
  const [answer, setAnswer] = useState("");
  const [touched, setTouched] = useState(false);
  const answerRef = useRef(null);
  const fSelect = useFocusable();
  const fAdd = useFocusable();
  const fCancel = useFocusable();
  const selected = available.find((p) => p.key === key);
  const isChoice = selected?.type === "choice";
  const canAdd = !!key && answer.trim() !== "";

  // Switching the chosen prompt clears any in-progress answer — a stale text draft
  // or a pick that isn't valid for the newly selected prompt must not carry over.
  function selectPrompt(nextKey) {
    setKey(nextKey);
    setAnswer("");
    setTouched(false);
  }

  function insertStarter(text) {
    setAnswer((prev) => withStarter(prev, text));
    setTouched(true);
    // Focus the box and drop the caret at the end so they can keep typing.
    requestAnimationFrame(() => {
      const el = answerRef.current;
      if (el) { el.focus(); const end = el.value.length; el.setSelectionRange(end, end); }
    });
  }

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
          onChange={(e) => selectPrompt(e.target.value)}
          {...fSelect}
          style={{ ...inputStyle(false), minHeight: 44, appearance: "auto", cursor: "pointer", ...fSelect.style }}
        >
          <option value="">Select a prompt…</option>
          {available.map((p) => (
            <option key={p.key} value={p.key}>{p.text}</option>
          ))}
        </select>
      </div>

      {selected && isChoice && (
        // CHOICE prompt: pick one of the fixed options (single-select radiogroup).
        <div style={{ marginBottom: 14 }}>
          <div id="prompt-chooser-choice-label">
            <FieldLabel>Your pick</FieldLabel>
          </div>
          <PromptChoiceGroup
            name="prompt-chooser-choice"
            options={selected.options || []}
            value={answer}
            onChange={setAnswer}
            labelId="prompt-chooser-choice-label"
          />
        </div>
      )}

      {selected && !isChoice && (
        <div style={{ marginBottom: 14 }}>
          <FieldLabel htmlFor="prompt-chooser-answer">Your answer</FieldLabel>
          <textarea
            id="prompt-chooser-answer"
            ref={answerRef}
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
            style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
          >
            {touched ? `${PROMPT_ANSWER_MAX - answer.length} remaining` : ""}
          </div>
          {answer.trim() === "" && (
            <PromptStarters promptKey={key} onUse={insertStarter} />
          )}
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
            border: `1px solid ${canAdd ? t.accentFill : t.border}`,
            background: canAdd ? t.accentFill : t.surfaceAlt,
            color: canAdd ? "#fff" : t.textMuted,
            fontSize: 16,
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
            fontSize: 16,
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

// ─── Dual-handle age-range slider ────────────────────────────────────────────
// Replaces the two number inputs that suffered the HTML min/max clamp bug.
// Keyboard: Tab to focus each handle, arrow keys to move ±1 year.
const AGE_SLIDER_MIN = 18;
const AGE_SLIDER_MAX = 99;

function AgeRangeSlider({ low, high, onChange }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // "low" | "high" | null

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
    const cur = which === "low" ? low : high;
    let next = cur;
    const PAGE = 5;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":  next = cur - 1;    break;
      case "ArrowRight":
      case "ArrowUp":    next = cur + 1;    break;
      case "PageDown":   next = cur - PAGE; break;
      case "PageUp":     next = cur + PAGE; break;
      case "Home":       next = AGE_SLIDER_MIN; break;
      case "End":        next = AGE_SLIDER_MAX; break;
      default: return;
    }
    e.preventDefault();
    // Clamp to the track and preserve two-thumb ordering (low < high).
    if (which === "low") {
      onChange(Math.max(AGE_SLIDER_MIN, Math.min(next, high - 1)), high);
    } else {
      onChange(low, Math.min(AGE_SLIDER_MAX, Math.max(next, low + 1)));
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
      // focus ring via outline (set on focus/blur events)
    };
  }

  const [focusedThumb, setFocusedThumb] = useState(null);

  return (
    <div style={{ padding: "4px 0 2px" }}>
      {/* Current range label */}
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

      {/* Track + thumbs */}
      <div
        ref={trackRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ position: "relative", height: THUMB + 16, userSelect: "none", padding: "0 2px" }}
      >
        {/* Background track */}
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

        {/* Filled segment between thumbs */}
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

        {/* Low thumb */}
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

        {/* High thumb */}
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

      {/* Tick labels */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.textMuted, marginTop: 2 }}>
        <span>{AGE_SLIDER_MIN}</span>
        <span>{AGE_SLIDER_MAX}+</span>
      </div>
    </div>
  );
}

// ─── Profile-completeness nudge (backlog #4) ─────────────────────────────────
// Tracks the 8 autism-specific "differentiator" fields that enrich a Spectrum
// profile beyond the required name + interests. Renders a calm tile-based
// progress bar + a chip list of what's still empty. Hidden once all 8 are done.

// Brand spectrum ramp (literal hex — theme-constant, never flag colours) used
// to paint the completeness meter as the ramp filling left→right (D-8).
// A-2 nit #2: luminance now rises MONOTONICALLY green→sand so the meter reads as
// steadily "filling" and never dips mid-run — the old deep-teal #3E6660 (relative
// luminance ~0.11) sat darker than its lit neighbours; it's lifted toward the
// soft-teal, and the teal is nudged up a hair, so each tile is lighter than the
// last (~0.24 → 0.25 → 0.28 → 0.32 → 0.42 → 0.71).
const COMPLETENESS_RAMP = ["#5E9459", "#539490", "#5E9C93", "#6FA39A", "#C9A875", "#E7D9C4"];

// NOTE: `seeking` is deliberately NOT a completeness field. The seeking control
// always presents a valid chosen state — specific genders OR an explicit "Open
// to everyone" (which maps to seeking === "", the default). Empty is therefore a
// complete, valid preference, so `!!seeking` would falsely flag every
// open-to-everyone user as incomplete with a chip they can never clear. Removing
// it is the calm, correct fix (it can't false-positive).
const COMPLETENESS_FIELDS = [
  { key: "photo",     label: "Add a photo" },
  { key: "tagline",   label: "Add a tagline" },
  { key: "bio",       label: "Write your bio" },
  { key: "pronouns",  label: "Add pronouns / gender" },
  { key: "commStyle", label: "Fill in comms style" },
  { key: "sensory",   label: "Add sensory preferences" },
  { key: "prompt",    label: "Answer a prompt" },
];

function computeCompleteness({ photos, tagline, bio, gender, pronouns,
    commDirectness, commLiteral, commCadence, sensoryEnvironment, sensoryLighting, prompts }) {
  const filled = {
    photo:     photos.length > 0,
    tagline:   tagline.trim().length > 0,
    bio:       bio.trim().length > 0,
    pronouns:  !!(gender || pronouns),
    commStyle: !!(commDirectness || commLiteral || commCadence),
    sensory:   !!(sensoryEnvironment || sensoryLighting),
    prompt:    prompts.length > 0,
  };
  const missing = COMPLETENESS_FIELDS.filter((f) => !filled[f.key]);
  return { score: COMPLETENESS_FIELDS.length - missing.length, total: COMPLETENESS_FIELDS.length, missing };
}

// Where each completeness field is edited, so a missing-field chip can jump the
// user straight there. `section` is the COLLAPSIBLE_SECTIONS group id to
// force-open first (null = an always-visible top-area field, nothing to open).
// `focusId` is the specific control to land focus on (WCAG 2.4.3); when null we
// fall back to the group's first actionable control, then its header. Field ids
// are STABLE across the 3-group regroup — only the `section` (now a group id)
// changed: pronouns/commStyle/sensory/prompt all live inside the "aboutMe"
// group; jumpToField scrolls to the specific field id, so landing deep inside a
// large group still lands on the right control. The always-visible photo/
// tagline/bio have no group.
const COMPLETENESS_TARGETS = {
  photo:     { section: null,      focusId: "add-photo-tile" },
  tagline:   { section: null,      focusId: "tagline" },
  bio:       { section: null,      focusId: "bio" },
  pronouns:  { section: "aboutMe", focusId: "pronouns" },
  commStyle: { section: "aboutMe", focusId: "comm-directness" },
  sensory:   { section: "aboutMe", focusId: "sensory-environment" },
  prompt:    { section: "aboutMe", focusId: null },
};

// One missing-field chip = one focusable <button>. Extracted into its own
// component so useFocusable() (a hook) never runs inside the missing.map() body
// (React #310 — all hooks must run before any early return, so no hooks in a
// loop body). Mirrors the existing HelperPhraseButton-style extraction pattern.
function CompletenessChipButton({ label, chipStyle, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        ...chipStyle,
        minHeight: 30,
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "pointer",
        ...f.style,
      }}
    >
      {label}
    </button>
  );
}

function ProfileCompletenessNudge({ score, total, missing, onJump }) {
  if (missing.length === 0) return null;
  const pct = Math.round((score / total) * 100);
  const chipStyle = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 20,
    background: t.green50,
    border: `1px solid ${t.green200}`,
    color: t.accentStrong,
    fontSize: 14,
    lineHeight: 1.5,
  };
  return (
    <div
      role="region"
      aria-label="Profile completeness"
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: "18px 20px 16px",
        marginBottom: 16,
        boxShadow: t.shadow.sm,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: t.serif, fontSize: 17, fontWeight: 700, color: t.text }}>
          Profile completeness
        </span>
        <span style={{ fontSize: 14, color: t.textSoft }}>{score}/{total}</span>
      </div>

      {/* Tile bar — D-8: the completeness meter IS the brand spectrum, filling
          left→right across the green→teal→clay→sand ramp so it reads as a
          deliberate centerpiece. Literal ramp hex (not the --mark-* vars) so it
          stays brand-green→sand in every theme — never a new flag surface under
          the identity themes. Taller tiles give the meter presence. */}
      <div
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${pct}% complete — ${score} of ${total} profile sections filled`}
        style={{ display: "flex", gap: 5, marginBottom: 14 }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const litColor = COMPLETENESS_RAMP[
            Math.round((i / Math.max(1, total - 1)) * (COMPLETENESS_RAMP.length - 1))
          ];
          const lit = i < score;
          return (
            <div
              key={i}
              aria-hidden="true"
              style={{
                flex: 1,
                height: 12,
                borderRadius: 5,
                background: lit ? litColor : t.surfaceAlt,
                border: `1.5px solid ${lit ? "rgba(36,51,45,0.12)" : t.border}`,
                transition: `background 220ms cubic-bezier(0.2,0,0,1)`,
              }}
            />
          );
        })}
      </div>

      {/* Missing-field chips */}
      <p style={{ margin: "0 0 8px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
        Adding these helps matches understand you better:
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {/* Every missing-field chip is an actionable shortcut that jumps to
            where that field is edited — opens its section (if any), scrolls it
            into view, and moves focus onto the control. Rendered as real
            <button>s so keyboard / screen-reader users can act on all of them
            (previously only the "prompt" chip was actionable). */}
        {missing.map((f) => (
          <li key={f.key}>
            <CompletenessChipButton
              label={f.label}
              chipStyle={chipStyle}
              onClick={() => onJump(f.key)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── F28: read-only "About me" facets card ───────────────────────────────────
// occupation + languages render as calm labelled rows; the two lists render as
// small pill rows. Empty facets render nothing; the whole card is hidden when
// all four are empty (no empty labels — calm-by-design).
function FacetPreviewCard({ occupation, languages, helpsMe, hardForMe, cardStyle }) {
  const occ = (occupation || "").trim();
  const langs = (languages || "").trim();
  const helps = (helpsMe || []).filter((s) => s && s.trim());
  const hard = (hardForMe || []).filter((s) => s && s.trim());
  if (!occ && !langs && helps.length === 0 && hard.length === 0) return null;

  const rowLabel = {
    fontSize: 13, fontWeight: 600, color: t.textMuted,
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, lineHeight: 1.4,
  };
  const pill = {
    padding: "5px 13px", borderRadius: 24, fontSize: 14,
    background: t.surface, color: t.textSoft, border: `1px solid ${t.border}`,
  };
  const pillRow = (items) => (
    <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((it, i) => (<li key={i} style={pill}>{it}</li>))}
    </ul>
  );

  return (
    <div style={cardStyle}>
      <h4 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>About me</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {occ && (
          <div>
            <div style={rowLabel}>Occupation</div>
            <p style={{ margin: 0, color: t.text, fontSize: 15, lineHeight: 1.5 }}>{occ}</p>
          </div>
        )}
        {langs && (
          <div>
            <div style={rowLabel}>Languages</div>
            <p style={{ margin: 0, color: t.text, fontSize: 15, lineHeight: 1.5 }}>{langs}</p>
          </div>
        )}
        {helps.length > 0 && (
          <div>
            <div style={rowLabel}>Things that help me</div>
            {pillRow(helps)}
          </div>
        )}
        {hard.length > 0 && (
          <div>
            <div style={rowLabel}>Things that are hard for me</div>
            {pillRow(hard)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audience toggle (feature-gap #6) ────────────────────────────────────────
// A calm two-option segmented control that lets a member preview BOTH states of
// their card: "New people" (pre-match — what a stranger sees on Discover) vs
// "Your matches" (post-match — the full card). It makes the privacy boundary
// legible: the backend gates contextCard / helpsMe / hardForMe to a live match
// (server/src/routes/matching.js mapCandidateToCard omits them pre-match), and
// this simply mirrors which of those the preview includes. Presentation only —
// it changes NOTHING that's stored and the backend stays the real gate.
// Implemented as a real radiogroup (role=radiogroup + role=radio) with roving
// tabindex and arrow-key selection, so it's keyboard- and SR-friendly.
function AudienceToggle({ value, onChange }) {
  const fNew = useFocusable();
  const fMatch = useFocusable();
  const newRef = useRef(null);
  const matchRef = useRef(null);

  // Move + select in one step (radiogroup semantics), then keep focus on the
  // now-selected radio so keyboard focus tracks the selection.
  function select(next) {
    if (next !== value) onChange(next);
    (next === "new" ? newRef : matchRef).current?.focus();
  }
  function onKeyDown(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); select("matches"); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); select("new"); }
  }

  const optStyle = (active, f) => ({
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    padding: "8px 14px",
    borderRadius: 9,
    border: active ? `1px solid ${t.accentStrong}` : "1px solid transparent",
    background: active ? t.surface : "transparent",
    color: active ? t.text : t.textSoft,
    fontFamily: t.sans,
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    boxShadow: active ? t.shadow.sm : "none",
    ...f.style,
  });

  return (
    <div
      role="radiogroup"
      aria-label="Preview your card as"
      data-audience-toggle
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
      }}
    >
      <button
        type="button"
        role="radio"
        ref={newRef}
        aria-checked={value === "new"}
        tabIndex={value === "new" ? 0 : -1}
        onClick={() => select("new")}
        {...fNew}
        style={optStyle(value === "new", fNew)}
      >
        New people
      </button>
      <button
        type="button"
        role="radio"
        ref={matchRef}
        aria-checked={value === "matches"}
        tabIndex={value === "matches" ? 0 : -1}
        onClick={() => select("matches")}
        {...fMatch}
        style={optStyle(value === "matches", fMatch)}
      >
        Your matches
      </button>
    </div>
  );
}

// ─── Profile preview modal (backlog #8) ──────────────────────────────────────
// Read-only card view of how the user's profile appears to candidates on
// Discover. Mirrors the SuggestionScreen card layout without importing it.
function ProfilePreviewModal({
  displayName, tagline, bio, pronouns, commNote, interests, specialInterests,
  commDirectness, commLiteral, commCadence,
  sensoryEnvironment, sensoryLighting, socialDuration,
  contextCard, occupation, languages, helpsMe, hardForMe,
  photos, prompts, audio, promptTextFor, verified, onClose,
}) {
  const headingRef = useRef(null);
  const panelRef = useRef(null);

  // feature-gap #6 — which audience the member is previewing as. Defaults to
  // "new" (pre-match), the more privacy-relevant view to check first: it's the
  // stranger's-eye view where the gated fields are hidden. "matches" shows the
  // full post-match card. Presentation only — never changes stored data.
  const [audience, setAudience] = useState("new");
  const showGated = audience === "matches";

  // Focus the dialog heading on open so screen-reader users hear the context,
  // and restore focus to whatever triggered the modal on close (D26).
  useEffect(() => {
    const prevFocus = document.activeElement;
    headingRef.current?.focus();
    return () => {
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
    };
  }, []);

  // Escape closes; Tab is trapped inside the dialog (D26) — consistent with the
  // app's other modals.
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab") {
        const focusables = panelRef.current
          ? Array.from(
              panelRef.current.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
              )
            ).filter((el) => !el.disabled)
          : [];
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        // The heading (tabindex -1) is initially focused but isn't in the list;
        // treat that as "before first" so Shift+Tab wraps to the last control.
        if (e.shiftKey) {
          if (active === first || !panelRef.current?.contains(active) || active === headingRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // PROD-6 — "how others see you" shows only APPROVED photos (pending ones are
  // invisible to viewers), ordered primary-first, matching the viewer surfaces.
  const approvedPhotos = (photos || [])
    .filter((p) => p && p.url && !p.pending && p.reviewStatus !== "pending_review" && p.reviewStatus !== "rejected")
    .slice()
    .sort((a, b) => {
      if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
      return (a.position ?? 0) - (b.position ?? 0);
    });
  const hasPhoto = approvedPhotos.length > 0;

  // Comms/sensory chips — mirrors SuggestionScreen's commStyleChips helper.
  // Defined inline so we don't import from another screen.
  const chips = [];
  if (commDirectness === "direct")   chips.push("Direct");
  if (commDirectness === "softened") chips.push("Softened");
  if (commLiteral === "literal")     chips.push("Literal");
  if (commLiteral === "playful")     chips.push("Playful");
  if (commCadence === "instant")     chips.push("Quick replies");
  if (commCadence === "daily")       chips.push("Replies once a day");
  if (sensoryEnvironment === "quiet")  chips.push("Quiet settings");
  if (sensoryEnvironment === "lively") chips.push("Lively settings");
  if (sensoryLighting === "dim")     chips.push("Dim lighting");
  if (sensoryLighting === "bright")  chips.push("Bright lighting");
  if (socialDuration === "short")    chips.push("Short meetups");
  if (socialDuration === "long")     chips.push("Longer meetups");

  // D-17 Phase 0 — feature the talk_for_hours answer as the "Could talk for
  // hours about" hero; the remaining prompts render as the generic cards below
  // (deduped — the featured answer is pulled out of `restPrompts`).
  const { featured: featuredPrompt, rest: restPrompts } = splitFeaturedPrompt(prompts);
  const validPrompts = restPrompts.filter((p) => p && p.answer && p.answer.trim());

  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: t.shadow.md,
  };
  const divider = <div aria-hidden="true" style={{ height: 1, background: t.borderLight, margin: "20px 0" }} />;

  return (
    <>
      {/* Fully opaque backdrop — nothing behind the modal bleeds through */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: t.bg,
          zIndex: 1200,
        }}
      />

      {/* Scrollable modal sheet — solid theme background so the edit form behind
          is fully obscured (previously transparent, letting ghost text bleed
          through on mobile). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-heading"
        style={{
          position: "fixed",
          inset: 0,
          overflowY: "auto",
          zIndex: 1201,
          background: t.bg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 16px 48px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Sticky header bar */}
        <div
          style={{
            position: "sticky",
            top: 0,
            width: "100%",
            maxWidth: t.layout.maxContent,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "calc(12px + env(safe-area-inset-top, 0px)) 8px 12px",
            background: t.surface,
            borderBottom: `1px solid ${t.border}`,
            borderRadius: "0 0 12px 12px",
            zIndex: 2,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        >
          <h2
            id="preview-modal-heading"
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 17,
              fontWeight: 700,
              color: t.text,
              margin: 0,
              outline: "none",
              padding: "2px 4px",
            }}
          >
            How others see you
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{
              background: t.accentFill,
              border: "none",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px 18px",
              borderRadius: 8,
              minHeight: 44,
              minWidth: 44,
              fontFamily: t.sans,
            }}
          >
            Close
          </button>
        </div>

        {/* Card content — mirrors the SuggestionScreen candidate card */}
        <div style={{ width: "100%", maxWidth: t.layout.maxContent }}>

          {/* feature-gap #6 — audience toggle. Lets the member see the pre-match
              ("New people") and post-match ("Your matches") versions of their
              card, so the privacy boundary around their sensitive disclosures is
              legible. */}
          <div style={{ marginBottom: 12 }}>
            <p style={{
              margin: "0 0 8px",
              fontSize: 13,
              fontWeight: 600,
              color: t.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              lineHeight: 1.4,
            }}>
              Preview as
            </p>
            <AudienceToggle value={audience} onChange={setAudience} />
            <p style={{ margin: "10px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
              {showGated
                ? "This is everything a matched person sees — including the parts new people can't."
                : "This is what a new person sees before you match. Your “how to talk to me” note and your “helps me” / “hard for me” lists stay private until you match."}
            </p>
          </div>

          {/* Main profile card */}
          <div style={card}>

            {/* Hero photo gallery when available (PROD-6) — same carousel the
                viewer surfaces use, so the preview matches "how others see you". */}
            {hasPhoto && (
              <PhotoCarousel
                photos={approvedPhotos}
                name={displayName || "you"}
                height={380}
                swipe
                containerStyle={{ marginBottom: 18 }}
              />
            )}

            {/* Name lockup — gradient avatar when no photo */}
            <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 20 }}>
              {!hasPhoto && (
                <Avatar name={displayName} userId={null} size={88} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{
                  fontFamily: t.serif,
                  fontSize: 30,
                  margin: "0 0 3px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                }}>
                  {displayName || "Your name"}
                  {verified && <VerifiedBadge style={{ marginLeft: 10, position: "relative", top: -4 }} />}
                </h3>
                {pronouns && (
                  <div style={{ fontSize: 14, color: t.textMuted, margin: "2px 0" }}>
                    {pronouns}
                  </div>
                )}
                {tagline && (
                  <p style={{
                    fontFamily: t.serif,
                    fontSize: 16,
                    color: t.textSoft,
                    fontStyle: "italic",
                    margin: "4px 0 6px",
                    lineHeight: 1.4,
                  }}>
                    {tagline}
                  </p>
                )}
              </div>
            </div>

            {divider}

            {/* Bio */}
            {bio ? (
              <p style={{ margin: 0, color: t.text, lineHeight: 1.75 }}>{bio}</p>
            ) : (
              <p style={{ margin: 0, color: t.textMuted, lineHeight: 1.75, fontStyle: "italic", fontSize: 16 }}>
                No bio yet — add one to help people get to know you.
              </p>
            )}

            {divider}

            {/* Communication note */}
            {commNote ? (
              <p style={{ margin: 0, color: t.textSoft, fontSize: 16, lineHeight: 1.6 }}>
                <strong style={{ color: t.text, fontWeight: 600 }}>About talking: </strong>
                {commNote}
              </p>
            ) : (
              <p style={{ margin: 0, color: t.textMuted, fontSize: 16, lineHeight: 1.6, fontStyle: "italic" }}>
                No communication note yet.
              </p>
            )}
          </div>

          {/* About me — F28 facets (calm scannable rows; empty facets render
              nothing, and the whole card is hidden when all four are empty). */}
          {/* helpsMe/hardForMe are post-match-gated (absent from the Discover
              card shape in matching.js), so pass empty lists in the "New people"
              view — occupation/languages stay (they ARE on the Discover card). */}
          <FacetPreviewCard
            occupation={occupation}
            languages={languages}
            helpsMe={showGated ? helpsMe : []}
            hardForMe={showGated ? hardForMe : []}
            cardStyle={{ ...card, background: t.surfaceAlt, boxShadow: "none", border: `1px solid ${t.borderLight}` }}
          />

          {/* Interests card */}
          <div style={{
            ...card,
            background: t.surfaceAlt,
            boxShadow: "none",
            border: `1px solid ${t.borderLight}`,
          }}>
            <h4 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>
              Interests
            </h4>
            {interests.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {interests.map((interest) => (
                  <span
                    key={interest}
                    style={{
                      padding: "5px 13px",
                      borderRadius: 24,
                      fontSize: 14,
                      fontWeight: 400,
                      background: t.surface,
                      color: t.textSoft,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {interest}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: t.textMuted, fontStyle: "italic", fontSize: 14 }}>
                No interests added yet.
              </p>
            )}
          </div>

          {/* How I communicate — comms/sensory chips */}
          {chips.length > 0 && (
            <div style={{
              ...card,
              background: t.surfaceAlt,
              boxShadow: "none",
              border: `1px solid ${t.borderLight}`,
            }}>
              <h4 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>
                How I communicate
              </h4>
              <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                {chips.map((label) => (
                  <li
                    key={label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "5px 13px",
                      borderRadius: 24,
                      fontSize: 14,
                      fontWeight: 400,
                      background: t.surface,
                      color: t.textSoft,
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Context card — post-match-gated (matching.js never sends it pre-
              match), so only render it in the "Your matches" view. */}
          {showGated && contextCard && contextCard.trim() && (
            <div style={card}>
              <p style={{
                margin: "0 0 10px",
                fontSize: 13,
                fontWeight: 600,
                color: t.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                lineHeight: 1.4,
              }}>
                In their words{" "}
                <span style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: t.textMuted,
                  letterSpacing: 0,
                  textTransform: "none",
                }}>
                  (visible to your matches only)
                </span>
              </p>
              <blockquote style={{
                margin: 0,
                fontFamily: t.serif,
                fontSize: 18,
                fontStyle: "italic",
                color: t.text,
                lineHeight: 1.55,
                borderLeft: `3px solid ${t.accentFill}`,
                paddingLeft: 16,
              }}>
                {contextCard}
              </blockquote>
            </div>
          )}

          {/* D-17 — "Could talk for hours about": your matchable chips lead, the
              free-text talk_for_hours answer elaborates below. No shared-highlight
              on your own card (viewerSpecialInterests omitted — just your chips). */}
          {(featuredPrompt || (specialInterests && specialInterests.length > 0)) && (
            <div style={card}>
              <FeaturedInterest
                answer={featuredPrompt?.answer}
                specialInterests={specialInterests}
              />
            </div>
          )}

          {/* Hinge-style prompt answers — one calm card per idea: the prompt is
              a quiet eyebrow label, the answer is the prominent content. */}
          {validPrompts.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {validPrompts.map((p, i) => (
                <li key={p.promptKey || i} data-prompt-card style={card}>
                  <p style={{
                    margin: "0 0 8px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: t.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    lineHeight: 1.4,
                  }}>
                    {promptTextFor(p.promptKey)}
                  </p>
                  <p style={{
                    margin: 0,
                    fontFamily: t.serif,
                    fontSize: 22,
                    fontWeight: 700,
                    color: t.text,
                    lineHeight: 1.4,
                    letterSpacing: "-0.01em",
                  }}>
                    {p.answer}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Approved voice answers — the FREE playback + transcript cards viewers
              see. Only approved clips appear here (pending/rejected are invisible
              to others), mirroring the approved-photos-only rule above. */}
          {(() => {
            const approvedAudio = (audio || []).filter(
              (a) => a && a.url && (a.reviewStatus === "approved" || (!a.reviewStatus && !a.pending))
            );
            if (approvedAudio.length === 0) return null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {approvedAudio.map((a) => (
                  <AudioAnswerCard
                    key={a.id || a.promptKey}
                    promptText={promptTextFor(a.promptKey)}
                    url={a.url}
                    transcript={a.transcript}
                    durationMs={a.durationMs}
                  />
                ))}
              </div>
            );
          })()}

          {/* Footer note */}
          <p style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: t.textMuted,
            textAlign: "center",
            lineHeight: 1.6,
          }}>
            {showGated
              ? "This is the card someone you've matched with sees. Your search preferences and private settings are never shared."
              : "This is the card other members see on Discover. Your search preferences and private settings are never shared."}
          </p>

        </div>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProfileScreen({ onDone, onSignOut, onOpenAccount, onOpenSafety, onOpenSettings, onOpenMembership, tier = "free", pushEnabled, pushSupported, onEnablePush, onDisablePush, initialOpenSection = null, initialPreview = false }) {
  // Photo gallery (up to 6, one primary)
  const [photos, setPhotos] = useState([]); // [{ id, url, isPrimary, position }]
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  // Identity verification status (read-only from /profile/me). Declared here with
  // the other hooks — before the loading/error early returns — so the hook count
  // stays constant across renders (React #310 / a hook-after-return crashed prod).
  const [verified, setVerified] = useState(false);
  // Self-serve verification request state: null | 'pending' | 'rejected'
  const [verificationRequested, setVerificationRequested] = useState(null);
  // D34 — optional human-readable rejection reason from the backend, if present.
  // Surfaced verbatim when rejected; otherwise the copy stays neutral (never
  // asserts the photo is the problem, which is wrong-but-confident for this audience).
  const [verificationRejectionReason, setVerificationRejectionReason] = useState(null);
  const [verifRequestBusy, setVerifRequestBusy] = useState(false);
  const [verifRequestError, setVerifRequestError] = useState("");

  // All form fields (initialised to defaults; overwritten by API load in useEffect)
  const [displayName, setDisplayName] = useState(DEFAULT_PROFILE.displayName);
  const [tagline, setTagline]         = useState(DEFAULT_PROFILE.tagline);
  const [bio, setBio]                 = useState(DEFAULT_PROFILE.bio);
  const [interests, setInterests]     = useState(DEFAULT_PROFILE.interests);
  const [specialInterests, setSpecialInterests] = useState(DEFAULT_PROFILE.specialInterests);
  const [commNote, setCommNote]       = useState(DEFAULT_PROFILE.commNote);
  const [relGoal, setRelGoal]         = useState(DEFAULT_PROFILE.relationshipGoal);
  const [relStructure, setRelStructure] = useState(DEFAULT_PROFILE.relationshipStructure);
  const [distCity, setDistCity]       = useState(DEFAULT_PROFILE.distanceCity);
  const [searchRadius, setSearchRadius] = useState(DEFAULT_PROFILE.searchRadiusMiles);
  // G4: whether the backend can place this user's city on the map (radius/distance
  // only works for supported metros). Defaults true so we never flash the note
  // before the profile loads. Set from GET /profile/me's locationGeocodable.
  const [locationGeocodable, setLocationGeocodable] = useState(true);
  const [gender, setGender]           = useState(DEFAULT_PROFILE.gender);
  const [genderCustom, setGenderCustom] = useState(DEFAULT_PROFILE.genderCustom);
  const [orientation, setOrientation] = useState(DEFAULT_PROFILE.orientation);
  const [pronouns, setPronouns]       = useState(DEFAULT_PROFILE.pronouns);
  const [seeking, setSeeking]         = useState(DEFAULT_PROFILE.seeking);
  const [prefAgeMin, setPrefAgeMin]   = useState(DEFAULT_PROFILE.prefAgeMin);
  const [prefAgeMax, setPrefAgeMax]   = useState(DEFAULT_PROFILE.prefAgeMax);
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
  // F17/D19 — instant pause toggle: persists on its own via PUT /profile/me
  // (optimistic, reverts on failure) without needing the full-form Save.
  const [pauseBusy, setPauseBusy]             = useState(false);

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

  // F28 — "about me" facets (all optional). Declared with the other hooks,
  // BEFORE the loading/error early returns (React #310 — no hook-after-return).
  const [occupation, setOccupation]   = useState(DEFAULT_PROFILE.occupation);
  const [languages, setLanguages]     = useState(DEFAULT_PROFILE.languages);
  const [helpsMe, setHelpsMe]         = useState(DEFAULT_PROFILE.helpsMe);
  const [hardForMe, setHardForMe]     = useState(DEFAULT_PROFILE.hardForMe);

  // Hinge-style prompts (max 3). `prompts` is [{ promptKey, answer }];
  // `promptCatalog` is [{ key, text }]. Both declared with the other hooks,
  // BEFORE the loading/error early returns (no hook-after-return).
  const [prompts, setPrompts]               = useState([]);
  const [promptCatalog, setPromptCatalog]   = useState([]);
  const [showPromptChooser, setShowPromptChooser] = useState(false);

  // Audio prompt answers (approved own clips) — snapshot from the profile load,
  // used to render the FREE playback + transcript cards in the "How others see
  // you" preview. Recording/managing lives in AudioAnswerEditor (its own state).
  const [audio, setAudio] = useState([]);

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

  // Profile preview (backlog #8) — declared here with the other hooks, BEFORE
  // the loading/error early returns, so the hook count stays constant.
  const [showPreview, setShowPreview] = useState(false);

  // Custom interest input
  const [customTagInput, setCustomTagInput] = useState("");
  const [interestFilter, setInterestFilter] = useState("");

  // ── Collapsible sections (mobile-overwhelm reduction) ──────────────────────
  // Map of sectionKey -> boolean open. Initialised empty; the real defaults are
  // computed once the profile loads (state-aware) unless the user has persisted
  // manual choices. Declared with the other hooks, before any early return.
  const [sectionOpen, setSectionOpen] = useState({});
  const sectionsInitialised = useRef(false);

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
          specialInterests: Array.isArray(data.specialInterests) ? data.specialInterests : [],
          commNote: data.commNote || '',
          relationshipGoal: data.relationshipGoal || '',
          relationshipStructure: data.relationshipStructure || '',
          distanceCity: data.distCity || '',
          searchRadiusMiles: data.searchRadiusMiles ?? 0,
          gender: data.gender || '',
          genderCustom: data.genderCustom || '',
          orientation: data.orientation || '',
          pronouns: data.pronouns || '',
          seeking: data.seeking || '',
          prefAgeMin: data.prefAgeMin ?? 18,
          prefAgeMax: data.prefAgeMax ?? 99,
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
          occupation: data.occupation || '',
          languages: data.languages || '',
          helpsMe: Array.isArray(data.helpsMe) ? data.helpsMe : [],
          hardForMe: Array.isArray(data.hardForMe) ? data.hardForMe : [],
        };
        setDisplayName(merged.displayName);
        setTagline(merged.tagline);
        setBio(merged.bio);
        setInterests(merged.interests);
        setSpecialInterests(merged.specialInterests);
        setCommNote(merged.commNote);
        setRelGoal(merged.relationshipGoal);
        setRelStructure(merged.relationshipStructure);
        setDistCity(merged.distanceCity);
        setSearchRadius(merged.searchRadiusMiles ?? 0);
        setLocationGeocodable(data.locationGeocodable !== false);
        setGender(merged.gender || '');
        setGenderCustom(merged.genderCustom || '');
        setOrientation(merged.orientation || '');
        setPronouns(merged.pronouns || '');
        setSeeking(merged.seeking || '');
        setPrefAgeMin(merged.prefAgeMin ?? 18);
        setPrefAgeMax(merged.prefAgeMax ?? 99);
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
        setOccupation(merged.occupation);
        setLanguages(merged.languages);
        setHelpsMe(merged.helpsMe);
        setHardForMe(merged.hardForMe);
        setSavedProfile(merged);
        setHasEverSaved(!!merged.displayName);
        setVerified(!!data.verified);
        setVerificationRequested(data.verificationRequested || null);
        setVerificationRejectionReason(
          (data.verificationRejectionReason || data.verificationReason || "").trim() || null
        );
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
        if (Array.isArray(data.audio)) setAudio(data.audio);
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
        specialInterests.length > 0 ||
        commNote || relGoal || distCity || notifTier !== "in_app" ||
        wantsChildren || smoking || drinking ||
        dbWantsChildren || dbNonSmoker || dbMustBeLocal || paused ||
        commDirectness || commLiteral || commCadence ||
        sensoryEnvironment || sensoryLighting || socialDuration || contextCard ||
        occupation || languages || helpsMe.length > 0 || hardForMe.length > 0;
      setIsDirty(hasContent);
    } else {
      const dirty =
        displayName      !== savedProfile.displayName ||
        tagline          !== savedProfile.tagline ||
        bio              !== savedProfile.bio ||
        commNote         !== savedProfile.commNote ||
        relGoal          !== savedProfile.relationshipGoal ||
        relStructure     !== savedProfile.relationshipStructure ||
        distCity         !== savedProfile.distanceCity ||
        searchRadius     !== savedProfile.searchRadiusMiles ||
        gender           !== savedProfile.gender ||
        genderCustom     !== savedProfile.genderCustom ||
        orientation      !== savedProfile.orientation ||
        pronouns         !== savedProfile.pronouns ||
        seeking          !== savedProfile.seeking ||
        prefAgeMin       !== savedProfile.prefAgeMin ||
        prefAgeMax       !== savedProfile.prefAgeMax ||
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
        occupation       !== savedProfile.occupation ||
        languages        !== savedProfile.languages ||
        // List facets: order is meaningful, so compare as-is (no sort).
        JSON.stringify(helpsMe) !== JSON.stringify(savedProfile.helpsMe || []) ||
        JSON.stringify(hardForMe) !== JSON.stringify(savedProfile.hardForMe || []) ||
        // Special interests: order is the display order, so compare as-is.
        JSON.stringify(specialInterests) !== JSON.stringify(savedProfile.specialInterests || []) ||
        JSON.stringify([...interests].sort()) !==
          JSON.stringify([...(savedProfile.interests || [])].sort());
      setIsDirty(dirty);
    }
  }, [displayName, tagline, bio, interests, specialInterests, commNote, relGoal, relStructure, distCity, searchRadius, gender, genderCustom, orientation, pronouns, seeking, prefAgeMin, prefAgeMax, notifTier, wantsChildren, smoking, drinking, dbWantsChildren, dbNonSmoker, dbMustBeLocal, paused, commDirectness, commLiteral, commCadence, sensoryEnvironment, sensoryLighting, socialDuration, contextCard, occupation, languages, helpsMe, hardForMe, savedProfile]);

  // ── Initialise collapsible-section open state once the profile has loaded.
  // Persisted manual choices win; otherwise apply the state-aware defaults from
  // the spec. Runs once (guarded by sectionsInitialised) after loading clears.
  useEffect(() => {
    if (loading || sectionsInitialised.current) return;
    sectionsInitialised.current = true;

    // Base: everything collapsed.
    const defaults = {};
    for (const key of COLLAPSIBLE_SECTIONS) defaults[key] = false;

    const { missing } = computeCompleteness({
      photos, tagline, bio, gender, pronouns, seeking,
      commDirectness, commLiteral, commCadence,
      sensoryEnvironment, sensoryLighting, prompts,
    });
    const missingKeys = new Set(missing.map((m) => m.key));

    if (!hasEverSaved) {
      // First-run: don't make setup a scavenger hunt — open the content group so
      // new users see the prompts/interests/facets. Looking-for + Account stay
      // collapsed (the required fields all live in the always-visible core).
      defaults.aboutMe = true;
    } else {
      // Returning user: auto-open the group that holds an incomplete field so
      // nothing is buried. Interests, prompts, comms-style and sensory all now
      // live inside the "About me" group, so any of them being empty opens it.
      if (interests.length === 0) defaults.aboutMe = true;
      if (missingKeys.has("prompt") && prompts.length === 0) defaults.aboutMe = true;
      if (missingKeys.has("commStyle") &&
          !(commDirectness || commLiteral || commCadence)) defaults.aboutMe = true;
      if (missingKeys.has("sensory") &&
          !(sensoryEnvironment || sensoryLighting || socialDuration)) defaults.aboutMe = true;
      // Identity verification lives in "Account" — surface a rejected status so
      // it isn't buried.
      if (verificationRequested === "rejected") defaults.account = true;
    }

    // Persisted manual choices override defaults on return.
    const persisted = loadPersistedSections();
    if (persisted) {
      for (const key of COLLAPSIBLE_SECTIONS) {
        if (typeof persisted[key] === "boolean") defaults[key] = persisted[key];
      }
    }

    // Deep-link from the Hub's Preferences drill-in: force its group open so the
    // member lands ON the preferences, not a collapsed header (wins over persisted).
    if (initialOpenSection && COLLAPSIBLE_SECTIONS.includes(initialOpenSection)) {
      defaults[initialOpenSection] = true;
    }

    setSectionOpen(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Hub deep-links (declared with the other hooks, BEFORE the loading/error
  //    early returns — React #310). Both run once after the profile loads.
  // Preferences drill-in: once the forced-open Looking-for group is committed,
  // scroll its header into view so the member lands on their preferences.
  const scrolledToSectionRef = useRef(false);
  useEffect(() => {
    if (loading || scrolledToSectionRef.current) return;
    if (!initialOpenSection) return;
    scrolledToSectionRef.current = true;
    requestAnimationFrame(() => {
      const header = document.getElementById(`section-${initialOpenSection}-button`);
      if (header) {
        header.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // "How others see you" drill-in: open the existing preview modal on mount.
  const previewOpenedRef = useRef(false);
  useEffect(() => {
    if (loading || previewOpenedRef.current) return;
    if (!initialPreview) return;
    previewOpenedRef.current = true;
    setShowPreview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Close the preview. When it was opened as the Hub's "How others see you"
  // sub-view (initialPreview) and nothing's been edited, closing returns to the
  // Hub so it reads as a hub destination, not a detour into the editor.
  function closePreview() {
    setShowPreview(false);
    if (initialPreview && !isDirty) onDone?.();
  }

  // ── Toggle a single section (VIEW change — never sets isDirty). Persists.
  function toggleSection(key) {
    setSectionOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistSections(next);
      return next;
    });
  }

  // ── Force a section open (used by the error-auto-open fix + expand-all).
  function openSection(key) {
    setSectionOpen((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      persistSections(next);
      return next;
    });
  }

  // ── Jump from a completeness-nudge chip to where that field is edited.
  // Generalizes the old jumpToPrompts so EVERY missing-field chip navigates
  // (not just "prompt"). For fields inside a collapsible section we force the
  // section open (so its panel isn't `hidden`, which would dead-end
  // focus/scroll), poll until React commits the re-render, then move focus onto
  // the field's control and scroll it in. For always-visible top-area fields
  // (photo/tagline/bio) there's no panel to wait for. Focus movement is
  // WCAG-2.4.3-correct; reduced-motion is respected for the scroll. Bounded rAF
  // so we never loop forever if a panel never opens.
  function jumpToField(fieldKey) {
    const cfg = COMPLETENESS_TARGETS[fieldKey];
    if (!cfg) return;
    const { section, focusId } = cfg;
    if (section) openSection(section);

    let tries = 0;
    const settle = () => {
      const panel = section ? document.getElementById(`section-${section}-panel`) : null;
      const header = section ? document.getElementById(`section-${section}-button`) : null;
      // A section field's panel stays `hidden` until openSection's state update
      // commits; focusing/scrolling a hidden node silently no-ops. Poll a few
      // frames until it's visible. Always-visible fields skip this gate.
      const panelReady = !section || (panel && !panel.hidden);
      if (!panelReady && tries++ < 10) {
        requestAnimationFrame(settle);
        return;
      }
      // Prefer the field's specific control; else the first actionable control
      // inside the now-open panel; else the section header button.
      const specific = focusId ? document.getElementById(focusId) : null;
      const firstControl = panel && panelReady
        ? panel.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        : null;
      const target = specific || firstControl || header;
      if (!target) return;
      target.focus();
      // Scroll the specific field into view when we have one (it can sit deep in
      // a section); otherwise anchor on the section header. Reduced-motion aware.
      const scrollTarget = specific || header || target;
      scrollTarget.scrollIntoView({
        behavior: prefersReduced ? "auto" : "smooth",
        block: "start",
      });
    };
    requestAnimationFrame(settle);
  }

  // ── Expand all / Collapse all (persisted).
  const allExpanded = COLLAPSIBLE_SECTIONS.every((k) => sectionOpen[k]);
  function toggleExpandAll() {
    const target = !allExpanded;
    const next = {};
    for (const key of COLLAPSIBLE_SECTIONS) next[key] = target;
    persistSections(next);
    setSectionOpen(next);
  }

  // ── Announce tag add/remove and clear after 300ms (P-13, P-14)
  function announce(msg) {
    setTagAnnouncement(msg);
    setTimeout(() => setTagAnnouncement(""), 300);
  }

  // ── F17/D19 — instant, discoverable pause toggle.
  // Persists ONLY the `paused` field immediately (optimistic; reverts on
  // failure), mirroring how Archive works — no full-form Save required. Keeps
  // savedProfile + cache in sync so the dirty-compare doesn't flag the change,
  // and the in-form PauseToggle stays consistent.
  async function handleInstantPauseToggle() {
    if (pauseBusy) return;
    const next = !paused;
    setPauseBusy(true);
    setPaused(next); // optimistic
    setTagAnnouncement(
      next
        ? "Your profile is paused. You won't appear in Discover. You can turn it back on anytime."
        : "Your profile is active again. You're back in Discover."
    );
    setTimeout(() => setTagAnnouncement(""), 1500);
    try {
      await updateProfile({ paused: next });
      // Sync the saved snapshot + cache so this stand-alone change isn't seen
      // as unsaved dirty state by the form.
      setSavedProfile((prev) => (prev ? { ...prev, paused: next } : prev));
      cacheProfile({ ...(savedProfile || {}), paused: next });
    } catch {
      setPaused(!next); // revert
      setTagAnnouncement("Couldn't update your pause setting. Please try again.");
      setTimeout(() => setTagAnnouncement(""), 1500);
    } finally {
      setPauseBusy(false);
    }
  }

  // ── Friendly message for storage-unavailable (503) / generic errors
  function photoErrorMessage(e) {
    if (e && e.status === 503) {
      return "Photo uploads aren't available right now. Please try again later.";
    }
    return safeErrorMessage(e, "Photo upload failed. Please try again.");
  }

  // ── Validate a chosen image file; returns an error string or "" if OK.
  function validatePhotoFile(file) {
    const MAX = 10 * 1024 * 1024;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(file.type)) return "Please choose a JPEG, PNG, WebP, or GIF.";
    if (file.size > MAX) return "Photo must be under 10 MB.";
    return "";
  }

  // ── Upload a file to R2 and register it; returns the new gallery list.
  async function uploadAndAddPhoto(file) {
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
    return addProfilePhoto(key);
  }

  // ── Add a photo to the gallery
  const handleAddPhoto = useCallback(async (file) => {
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      setPhotoError(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const invalid = validatePhotoFile(file);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }
    setPhotoError("");
    setPhotoUploading(true);
    try {
      const result = await uploadAndAddPhoto(file);
      setPhotos(result);
    } catch (e) {
      setPhotoError(photoErrorMessage(e));
    } finally {
      setPhotoUploading(false);
    }
  }, [photos.length]);

  // ── Replace a photo in place: upload the new one, then remove the old one,
  //    preserving the old photo's primary status. (Add-then-delete: the new
  //    photo is safely stored before the old one is removed.)
  const handleReplacePhoto = useCallback(async (oldId, file) => {
    if (!file) return;
    const invalid = validatePhotoFile(file);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }
    const wasPrimary = photos.find((p) => p.id === oldId)?.isPrimary;
    const prevIds = new Set(photos.map((p) => p.id));
    setPhotoError("");
    setPhotoUploading(true);
    try {
      // 1. Upload + register the new photo. Result includes the new photo.
      const afterAdd = await uploadAndAddPhoto(file);
      const added = afterAdd.find((p) => !prevIds.has(p.id));
      // 2. Remove the old photo. If it was primary, the backend promotes the
      //    lowest-position remaining photo — so we re-assert primary on the new
      //    one afterward to preserve the slot's main status.
      let list = await deleteProfilePhoto(oldId);
      if (wasPrimary && added && list.some((p) => p.id === added.id)) {
        list = await setPrimaryPhoto(added.id);
      }
      setPhotos(list);
    } catch (e) {
      setPhotoError(photoErrorMessage(e));
    } finally {
      setPhotoUploading(false);
    }
  }, [photos]);

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

  // ── Update photo description optimistically (saved to DB by PhotoCell on blur)
  const handleDescriptionSaved = useCallback((id, description) => {
    setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, description } : p));
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
      // P-7: focus the FIRST invalid field. If that field lives inside a
      // collapsible section, force the section open first so the node isn't
      // `hidden` (which would dead-end focus/scroll), then focus + scroll it on
      // the next frame. Generalised: `section` is null for always-open fields.
      const firstInvalid = nameErr
        ? { ref: displayNameRef, section: null }         // display name — always-open "About you"
        : { ref: interestsErrorRef, section: "aboutMe" }; // interests — inside the "About me" group

      if (firstInvalid.section) openSection(firstInvalid.section);
      requestAnimationFrame(() => {
        const node = firstInvalid.ref.current;
        if (!node) return;
        node.focus();
        node.scrollIntoView({ block: "center" });
      });
      return;
    }

    setSaveErrorSummary("");
    // F28 — trim + drop empty facet rows before saving (matches server cleanup);
    // reflect the cleaned lists back into the editor so blank rows collapse.
    const cleanFacet = (arr) => arr.map((s) => s.trim()).filter(Boolean).slice(0, FACET_MAX_ITEMS);
    const cleanHelpsMe = cleanFacet(helpsMe);
    const cleanHardForMe = cleanFacet(hardForMe);
    // D-17 Phase 2 — trim/dedupe/cap to the backend's 3×40 shape before saving.
    const cleanSpecialInterests = normalizeSpecialInterests(specialInterests);
    const currentProfile = {
      displayName: displayName.trim(),
      tagline,
      bio,
      interests,
      specialInterests: cleanSpecialInterests,
      commNote,
      relationshipGoal: relGoal,
      relationshipStructure: relStructure,
      distanceCity: distCity,
      searchRadiusMiles: searchRadius,
      gender,
      genderCustom,
      orientation,
      pronouns,
      seeking,
      prefAgeMin,
      prefAgeMax,
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
      occupation,
      languages,
      helpsMe: cleanHelpsMe,
      hardForMe: cleanHardForMe,
    };

    try {
      await updateProfile({
        displayName: currentProfile.displayName,
        tagline: currentProfile.tagline,
        bio: currentProfile.bio,
        interests: currentProfile.interests,
        specialInterests: currentProfile.specialInterests,
        commNote: currentProfile.commNote,
        relationshipGoal: currentProfile.relationshipGoal,
        relationshipStructure: currentProfile.relationshipStructure,
        distCity: currentProfile.distanceCity,
        searchRadiusMiles: currentProfile.searchRadiusMiles,
        gender: currentProfile.gender,
        genderCustom: currentProfile.genderCustom,
        orientation: currentProfile.orientation,
        pronouns: currentProfile.pronouns,
        seeking: currentProfile.seeking,
        prefAgeMin: currentProfile.prefAgeMin,
        prefAgeMax: currentProfile.prefAgeMax,
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
        occupation: currentProfile.occupation,
        languages: currentProfile.languages,
        helpsMe: currentProfile.helpsMe,
        hardForMe: currentProfile.hardForMe,
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
      // Collapse any blank/trimmed facet rows to match what was actually saved.
      setHelpsMe(cleanHelpsMe);
      setHardForMe(cleanHardForMe);
      // Reflect the normalised (trimmed/deduped/capped) special interests back.
      setSpecialInterests(cleanSpecialInterests);
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
  // Prompt TYPE ('text' | 'choice') and, for choice prompts, the fixed options —
  // both from the catalog by key. Default 'text' if the catalog hasn't loaded yet.
  function promptTypeFor(promptKey) {
    return promptCatalog.find((c) => c.key === promptKey)?.type || "text";
  }
  function promptOptionsFor(promptKey) {
    return promptCatalog.find((c) => c.key === promptKey)?.options || [];
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
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.65,
    padding: "20px 16px 60px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: t.shadow.md,
  };
  const fieldGroup = { marginBottom: 20 };
  const h2Style = {
    fontFamily: t.serif,
    fontSize: 22,
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

  // ── Group collapsed summaries + done indicators ───────────────────────────
  // Each of the 3 top-level GROUPS shows a one-line collapsed summary (folds
  // into the header's accessible name so SR users hear it while collapsed) and a
  // ✓ when it holds meaningful content. Group summaries OR together the former
  // per-topic signals. Computed from state already in scope each render.
  const RADIUS_LABEL = { 0: "anywhere", 25: "within 25 mi", 50: "within 50 mi", 100: "within 100 mi", 250: "within 250 mi" };
  const GOAL_LABEL = { "long-term": "Long-term", friendship: "Friendship first", open: "Open to either" };
  const NOT_SET = "Not set yet";

  function joinParts(parts) {
    const kept = parts.filter(Boolean);
    return kept.length ? kept.join(" · ") : NOT_SET;
  }

  // ── Group 1: About me — prompts, interests, F28 facets, identity,
  //    how-I-communicate, sensory & social, lifestyle attributes you display.
  const answeredPrompts = prompts.filter((p) => p.promptKey && p.answer.trim());
  const promptsHasContent = answeredPrompts.length > 0;
  const interestsHasContent = interests.length > 0;
  const helpsMeFilled = helpsMe.filter((s) => s.trim()).length;
  const hardForMeFilled = hardForMe.filter((s) => s.trim()).length;
  const facetsHasContent = !!(occupation.trim() || languages.trim() || helpsMeFilled || hardForMeFilled);
  const identityHasContent = !!(gender || pronouns || orientation || relStructure);
  const communicateHasContent = !!(commDirectness || commLiteral || commCadence || contextCard.trim());
  const sensoryHasContent = !!(sensoryEnvironment || sensoryLighting || socialDuration);
  const lifestyleAttrHasContent = !!(wantsChildren || smoking || drinking);
  const aboutMeHasContent = promptsHasContent || interestsHasContent || facetsHasContent
    || identityHasContent || communicateHasContent || sensoryHasContent || lifestyleAttrHasContent;
  const aboutMeSummary = joinParts([
    interestsHasContent ? `${interests.length} interest${interests.length > 1 ? "s" : ""}` : "",
    promptsHasContent ? `${answeredPrompts.length} prompt${answeredPrompts.length > 1 ? "s" : ""}` : "",
    identityHasContent ? "identity" : "",
    communicateHasContent ? "communication" : "",
    sensoryHasContent ? "sensory" : "",
    (facetsHasContent || lifestyleAttrHasContent) ? "more about you" : "",
  ]);

  // ── Group 2: Looking for — relationship goal, who to meet, age range,
  //    location & distance, deal-breaker filters. Empty seeking === "open to
  //    everyone" (a valid, complete preference) so it doesn't force a summary.
  const lifestylePrefCount = [dbWantsChildren, dbNonSmoker, dbMustBeLocal].filter(Boolean).length;
  const seekingSelected = seeking.split(",").map((s) => s.trim()).filter(Boolean);
  const ageIsDefault = prefAgeMin === 18 && prefAgeMax === 99;
  const lookingForHasContent = !!(relGoal || seekingSelected.length || !ageIsDefault
    || searchRadius || distCity.trim() || lifestylePrefCount);
  const lookingForSummary = joinParts([
    GOAL_LABEL[relGoal] || "",
    seekingSelected.length ? "who you'll meet" : "",
    !ageIsDefault ? `ages ${prefAgeMin}–${prefAgeMax === 99 ? "99+" : prefAgeMax}` : "",
    searchRadius ? RADIUS_LABEL[searchRadius] : "",
    lifestylePrefCount ? `${lifestylePrefCount} deal-breaker${lifestylePrefCount > 1 ? "s" : ""}` : "",
  ]);

  // ── Group: Membership — its own peer group now. The summary is a PASSIVE tier
  //    signal ("Spectrum (Free)" / "Spectrum Companion"); no ✓ (hasContent=false)
  //    so a free member never sees a "you're missing something" contrast.
  const isCompanion = tier === "companion";
  const membershipSummary = isCompanion ? "Spectrum Companion" : "Spectrum (Free)";

  // ── Group: Account — profile review (verification) + notifications. Membership
  //    left this group, so the summary reflects only the review state (empty =
  //    "Not set yet"); the ✓ is reserved for a reviewed profile.
  const accountHasContent = verified;
  const accountSummary = joinParts([
    verified
      ? "Reviewed"
      : verificationRequested === "pending"
        ? "Review pending"
        : verificationRequested === "rejected"
          ? "Review not approved"
          : "",
  ]);

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

      {/* Profile preview modal (backlog #8) */}
      {showPreview && (
        <ProfilePreviewModal
          displayName={displayName}
          tagline={tagline}
          bio={bio}
          pronouns={pronouns}
          commNote={commNote}
          interests={interests}
          specialInterests={specialInterests}
          commDirectness={commDirectness}
          commLiteral={commLiteral}
          commCadence={commCadence}
          sensoryEnvironment={sensoryEnvironment}
          sensoryLighting={sensoryLighting}
          socialDuration={socialDuration}
          contextCard={contextCard}
          occupation={occupation}
          languages={languages}
          helpsMe={helpsMe}
          hardForMe={hardForMe}
          photos={photos}
          prompts={prompts}
          audio={audio}
          promptTextFor={promptTextFor}
          verified={verified}
          onClose={closePreview}
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
            // dangerFill so the white alert text clears AA in dim/navy.
            background: t.dangerFill,
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

        {/* ── Header ── The app shell owns the wordmark now; this screen keeps
            just its real "Done" action (no duplicate "Spectrum" landmark). */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 12 }}>
          <button
            type="button"
            onClick={handleDone}
            style={{
              background: "transparent",
              border: "none",
              color: t.accentStrong,
              fontSize: 16,
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, margin: "0 0 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

            {/* Preview my card — backlog #8 */}
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              aria-haspopup="dialog"
              style={{
                background: "transparent",
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                color: t.accentStrong,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                padding: "6px 14px",
                minHeight: 36,
                fontFamily: t.sans,
                flexShrink: 0,
              }}
            >
              Preview my card
            </button>
          </div>
          <SectionRule style={{ marginTop: 8, marginBottom: 18 }} />

          {/* P-27: framing copy — first-time only */}
          {!hasEverSaved && (
            <p style={{ color: t.textSoft, fontSize: 16, margin: "0 0 20px", lineHeight: 1.6 }}>
              Tell us a bit about yourself. You control what people see — none of this
              is required except your display name and at least one interest.
            </p>
          )}

          {/* Profile-completeness nudge (backlog #4): shown after first load,
              hidden automatically once all 8 differentiator fields are filled. */}
          {(() => {
            const { score, total, missing } = computeCompleteness({
              photos, tagline, bio, gender, pronouns, seeking,
              commDirectness, commLiteral, commCadence,
              sensoryEnvironment, sensoryLighting, prompts,
            });
            return <ProfileCompletenessNudge score={score} total={total} missing={missing} onJump={jumpToField} />;
          })()}

          {/* F17/D19 — discoverable, one-tap "Take a break" control near the top
              of Profile. Persists instantly (optimistic) via PUT /profile/me on
              its own — no full-form Save needed. Mirrors the calm card style. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              background: paused ? t.green50 : t.surfaceAlt,
              border: `1px solid ${paused ? t.accentStrong : t.border}`,
              borderRadius: 14,
              padding: "14px 16px",
              marginBottom: 12,
            }}
          >
            <div style={{ minWidth: 200, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: t.text }}>
                {paused ? "Your profile is paused" : "Take a break"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
                {paused
                  ? "You won't appear in Discover. Your matches and messages stay. Turn it back on whenever you're ready."
                  : "Pause your profile anytime. You'll disappear from Discover, but keep your matches and messages."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleInstantPauseToggle}
              disabled={pauseBusy}
              aria-pressed={paused}
              style={{
                flexShrink: 0,
                background: paused ? "transparent" : t.accentFill,
                color: paused ? t.accentStrong : "#fff",
                border: paused ? `1px solid ${t.accentStrong}` : "none",
                borderRadius: 10,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: t.sans,
                cursor: pauseBusy ? "default" : "pointer",
                opacity: pauseBusy ? 0.6 : 1,
                padding: "10px 18px",
                minHeight: 44,
              }}
            >
              {pauseBusy ? "Saving…" : paused ? "Turn profile back on" : "Pause my profile"}
            </button>
          </div>

          {/* Expand all / Collapse all — controls every collapsible section at
              once. Persisted. Label reflects current state. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <ExpandAllToggle allExpanded={allExpanded} onClick={toggleExpandAll} />
          </div>

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
              onReplace={handleReplacePhoto}
              onSetPrimary={handleSetPrimary}
              onRemove={handleRemovePhoto}
              onDescriptionSaved={handleDescriptionSaved}
              name={displayName}
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
                style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
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
                style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
              >
                {bioTouched ? `${500 - bio.length} remaining` : ""}
              </div>
            </div>

            {/* Communication style note (commNote) moved into the consolidated
                "How to connect with me" module inside the About me group, so the
                whole communication moat reads as one intentional place. */}
          </div>

          {/* ══════════════════════════════════════════════════════
              GROUP 1 — About me (content others see). Opens to reveal all its
              sub-sections as plain <h3> headed blocks in ONE calm scroll —
              no nested accordions (double-hiding is the anti-pattern here).
          ══════════════════════════════════════════════════════ */}
          <CollapsibleSection
            id="aboutMe"
            title="About me"
            summary={aboutMeSummary}
            hasContent={aboutMeHasContent}
            open={!!sectionOpen.aboutMe}
            onToggle={() => toggleSection("aboutMe")}
            headerStyle={h2Style}
            cardStyle={card}
          >
            {/* ── Prompts ── */}
            <SubHeading>Prompts</SubHeading>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px", lineHeight: 1.6 }}>
              Answer up to 3 prompts — an easy way to share who you are without a blank page.
            </p>

            {prompts.map((p, idx) => (
              <PromptSlot
                key={p.promptKey}
                index={idx}
                promptKey={p.promptKey}
                promptText={promptTextFor(p.promptKey)}
                promptType={promptTypeFor(p.promptKey)}
                options={promptOptionsFor(p.promptKey)}
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

            {/* ── Voice answers (record = Companion; play + transcript = free) ── */}
            <div style={{ marginTop: 18 }}>
              <AudioAnswerEditor
                tier={tier}
                promptCatalog={promptCatalog}
                promptTextFor={promptTextFor}
                onOpenMembership={onOpenMembership}
              />
            </div>

            <SubDivider />

            {/* ── Interests ── */}
            <SubHeading>Interests</SubHeading>
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
                          background: t.accentFill,
                          color: "#fff",
                          borderRadius: t.radius.pill,
                          padding: "4px 4px 4px 12px",
                          fontSize: 14,
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

            {/* Suggestion chips (P-15, P-16) — categorized library + calm filter.
                Groups render as labeled chip clusters so a large set stays
                scannable; the filter narrows across all groups without any
                counters or urgency (calm-by-design). */}
            <div
              role="group"
              aria-labelledby="suggestions-heading"
              style={{ marginBottom: 20 }}
              data-interest-library="categorized"
            >
              <h3
                id="suggestions-heading"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: t.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 10px",
                }}
              >
                Suggested interests
              </h3>

              {/* Client-side filter — purely narrows the local list as you type. */}
              <label
                htmlFor="interest-filter"
                style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
              >
                Search suggested interests
              </label>
              <input
                id="interest-filter"
                type="search"
                value={interestFilter}
                onChange={(e) => setInterestFilter(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={{ ...inputStyle(false), marginBottom: 14 }}
                placeholder="Search suggestions"
              />

              {(() => {
                const q = interestFilter.trim().toLowerCase();
                const groups = q
                  ? SUGGESTED_INTEREST_GROUPS
                      .map((g) => ({ ...g, items: g.items.filter((tag) => tag.includes(q)) }))
                      .filter((g) => g.items.length > 0)
                  : SUGGESTED_INTEREST_GROUPS;

                if (groups.length === 0) {
                  return (
                    <p style={{ fontSize: 14, color: t.textSoft, margin: 0, lineHeight: 1.5 }}>
                      No suggestions match that. You can add your own below.
                    </p>
                  );
                }

                return groups.map((group) => {
                  const groupId = `interest-group-${group.label.replace(/[^a-z]+/gi, "-").toLowerCase()}`;
                  return (
                    <div key={group.label} style={{ marginBottom: 16 }}>
                      <h4
                        id={groupId}
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: t.textSoft,
                          margin: "0 0 8px",
                        }}
                      >
                        {group.label}
                      </h4>
                      <div
                        role="group"
                        aria-labelledby={groupId}
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
                        {group.items.map((tag) => (
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
                  );
                });
              })()}
            </div>

            {/* Free-entry (P-17) */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="add-custom-tag"
                  style={{ display: "block", fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}
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
                fontSize: 14,
                color: t.danger,
                fontWeight: 500,
                outline: "none",
                minHeight: 18,
              }}
            >
              {hasSaveAttempted ? interestsError : ""}
            </span>

            {/* D-17 Phase 2 — matchable "Could talk for hours about" chips. These
                lead the merged deep-interest section on your card and drive the
                shared-highlight soft-score; capped 3×40 to match the backend. */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${t.borderLight}` }}>
              <h3 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 4px", fontWeight: 700, color: t.text }}>
                Could talk for hours about
              </h3>
              <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px", lineHeight: 1.5 }}>
                A few topics you love going deep on — we use these to suggest people who
                light up about the same things.
              </p>
              <SpecialInterestsInput
                items={specialInterests}
                onChange={setSpecialInterests}
                idPrefix="profile-special-interests"
                announce={announce}
                prefersReduced={prefersReduced}
              />
            </div>

            <SubDivider />

            {/* ══ How to connect with me — THE consolidated moat ══
                The single most differentiating part of a Spectrum profile. Brings
                together fields that used to be scattered across "How I
                communicate", "Sensory & social" and "More about you" into ONE
                clearly-labelled place, so our differentiator reads as intentional
                rather than generic form-fill. Every field keeps its existing
                input/id/save logic — this is re-parenting + re-heading only. ── */}
            <SubHeading>How to connect with me</SubHeading>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 20px", lineHeight: 1.6 }}>
              The heart of your profile — a calm, one-stop place to tell people how
              to reach you well. All optional; share as much or as little as you like.
            </p>

            {/* commNote — the short free-text "about talking" line (was in the
                always-visible About-you card; now lives with the rest of the moat). */}
            <div style={{ ...fieldGroup }}>
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

            {/* Communication preferences (comm directness / style / cadence) */}
            <ModuleLabel>How I communicate</ModuleLabel>
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
                style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}
              >
                {contextCardTouched ? `${300 - contextCard.length} remaining` : ""}
              </div>
            </div>

            {/* Sensory & social preferences */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${t.borderLight}` }}>
              <ModuleLabel>Sensory &amp; social</ModuleLabel>
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

            {/* What helps me / is hard for me (F28 lists) */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${t.borderLight}` }}>
              <ModuleLabel>What helps</ModuleLabel>
              <FacetListEditor
                id="helps-me"
                label="Things that help me"
                helper="Up to 5 short items — e.g. “Clear plans”, “Text over calls”. Optional."
                items={helpsMe}
                onChange={setHelpsMe}
                addLabel={helpsMe.length === 0 ? "Add something that helps" : "Add another"}
              />
              <FacetListEditor
                id="hard-for-me"
                label="Things that are hard for me"
                helper="Up to 5 short items — e.g. “Loud places”, “Last-minute changes”. Optional."
                items={hardForMe}
                onChange={setHardForMe}
                addLabel={hardForMe.length === 0 ? "Add something that's hard" : "Add another"}
              />
            </div>

            <SubDivider />

            {/* ── More about you (F28 facets: occupation + languages) ── */}
            <SubHeading>More about you</SubHeading>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px", lineHeight: 1.6 }}>
              A few optional details that give people predictable context. Share as much or as little as you like.
            </p>

            {/* Occupation / study */}
            <div style={{ ...fieldGroup }}>
              <FieldLabel htmlFor="occupation">Occupation or study</FieldLabel>
              <input
                id="occupation"
                type="text"
                maxLength={80}
                aria-describedby="occupation-hint"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="e.g. Librarian · Studying biology"
              />
              <HelperText id="occupation-hint">
                80 characters maximum. Optional.
              </HelperText>
            </div>

            {/* Languages */}
            <div style={{ ...fieldGroup }}>
              <FieldLabel htmlFor="languages">Languages</FieldLabel>
              <input
                id="languages"
                type="text"
                maxLength={120}
                aria-describedby="languages-hint"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="e.g. English, ASL"
              />
              <HelperText id="languages-hint">
                120 characters maximum. Optional.
              </HelperText>
            </div>

            <SubDivider />

            {/* ── Identity (moved out of the old "search" section — this is
                content shown on your card, not a matching filter). ── */}
            <SubHeading>Identity</SubHeading>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 18px", lineHeight: 1.6 }}>
              All optional. Shown on your profile so people understand and address you correctly.
            </p>

            <GenderField
              gender={gender}
              setGender={setGender}
              genderCustom={genderCustom}
              setGenderCustom={setGenderCustom}
              idPrefix="profile-gender"
            />

            <OrientationField orientation={orientation} setOrientation={setOrientation} />

            <RelationshipStructureField
              relationshipStructure={relStructure}
              setRelationshipStructure={setRelStructure}
            />

            <div style={{ ...fieldGroup, marginBottom: 0 }}>
              <FieldLabel htmlFor="pronouns">Pronouns</FieldLabel>
              <input
                id="pronouns"
                type="text"
                maxLength={40}
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
                placeholder="e.g. she/her, they/them"
              />
              <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}>
                Shown on your profile so people address you correctly.
              </span>
            </div>

            <SubDivider />

            {/* ── Lifestyle (attributes you DISPLAY — the deal-breaker filters
                that used to sit here moved to "Looking for"). ── */}
            <SubHeading>Lifestyle</SubHeading>
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
          </CollapsibleSection>

          {/* ══════════════════════════════════════════════════════
              GROUP 2 — Looking for (your matching preferences/filters).
              Relationship goal leads (it answers "what you want"), then who to
              meet, age range, location & distance, and the deal-breaker filters
              pulled out of the old Lifestyle section.
          ══════════════════════════════════════════════════════ */}
          <CollapsibleSection
            id="lookingFor"
            title="Looking for"
            summary={lookingForSummary}
            hasContent={lookingForHasContent}
            open={!!sectionOpen.lookingFor}
            onToggle={() => toggleSection("lookingFor")}
            headerStyle={h2Style}
            cardStyle={card}
          >
            {/* ── What I'm looking for (relationship goal) ── */}
            <SubHeading>What I'm looking for</SubHeading>
            <fieldset
              style={{
                border: "none",
                margin: "0 0 24px",
                padding: 0,
              }}
            >
              <legend style={srOnly}>What are you looking for?</legend>
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
                        fontSize: 16,
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
                      style={{ display: "block", fontSize: 14, color: t.textSoft, marginLeft: 30, marginBottom: 4 }}
                    >
                      {desc}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>

            <SubDivider />

            {/* ── Who I want to meet ── */}
            <SubHeading>Who I want to meet</SubHeading>
            <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
              <legend style={srOnly}>Who do you want to meet?</legend>
              <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 10, clear: "both" }}>
                Choose who you'd like to meet, or stay open to everyone.
              </span>
              {[
                { value: "woman", label: "Women" },
                { value: "man", label: "Men" },
                { value: "nonbinary", label: "Nonbinary people" },
              ].map(({ value, label }) => {
                const set = seeking.split(",").map((s) => s.trim()).filter(Boolean);
                const checked = set.includes(value);
                return (
                  <label key={value} htmlFor={`seek-${value}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer" }}>
                    <input
                      id={`seek-${value}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? set.filter((x) => x !== value) : [...set, value];
                        setSeeking(next.join(","));
                      }}
                      style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 16, color: t.text }}>{label}</span>
                  </label>
                );
              })}
              {/* D-16 — explicit "open to everyone" affordance mapping to the
                  existing empty-seeking (match-everyone) semantics. Checked
                  whenever nothing is selected; selecting it clears the set. */}
              {(() => {
                const openToEveryone = seeking.split(",").map((s) => s.trim()).filter(Boolean).length === 0;
                return (
                  <label
                    htmlFor="seek-everyone"
                    style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${t.borderLight}` }}
                  >
                    <input
                      id="seek-everyone"
                      type="checkbox"
                      checked={openToEveryone}
                      onChange={() => { if (!openToEveryone) setSeeking(""); }}
                      style={{ width: 18, height: 18, accentColor: t.accentStrong, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 16, color: t.text }}>Open to everyone</span>
                  </label>
                );
              })()}
            </fieldset>

            <SubDivider />

            {/* ── Age range ── */}
            <SubHeading>Age range</SubHeading>
            <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
              <legend style={srOnly}>Age range</legend>
              <AgeRangeSlider
                low={prefAgeMin}
                high={prefAgeMax}
                onChange={(newLow, newHigh) => {
                  setPrefAgeMin(newLow);
                  setPrefAgeMax(newHigh);
                }}
              />
              <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}>
                Only show people in this age range.
              </span>
            </fieldset>

            <SubDivider />

            {/* ── Location & distance ── */}
            <SubHeading>Location &amp; distance</SubHeading>

            {/* Distance city */}
            <div style={{ ...fieldGroup }}>
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
                style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}
              >
                Used to show people near you. Approximate is fine.
              </span>
            </div>

            {/* Search radius — distance-based matching (miles from your location) */}
            <div style={{ marginTop: 18 }}>
              <FieldLabel htmlFor="search-radius">Search radius</FieldLabel>
              <select
                id="search-radius"
                aria-describedby="radius-help"
                value={searchRadius}
                onChange={(e) => setSearchRadius(Number(e.target.value))}
                onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
                onBlur={(e) => { e.target.style.outline = "none"; }}
                style={inputStyle(false)}
              >
                <option value={0}>Anywhere</option>
                <option value={25}>Within 25 miles</option>
                <option value={50}>Within 50 miles</option>
                <option value={100}>Within 100 miles</option>
                <option value={250}>Within 250 miles</option>
              </select>
              <span
                id="radius-help"
                style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}
              >
                Only show people within this distance. Set your location above for this to apply.
              </span>
              {/* G4: honest note when we can't place this city on the map, so the
                  radius won't silently do nothing. Calm, no urgency. */}
              {distCity.trim() && !locationGeocodable && (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 14,
                    color: t.textSoft,
                    background: t.surfaceAlt,
                    border: `1px solid ${t.borderLight}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    lineHeight: 1.5,
                  }}
                >
                  We can’t apply distance for your area yet — you’ll see people from everywhere.
                </p>
              )}
            </div>

            <SubDivider />

            {/* ── Deal-breakers (filters moved out of the old Lifestyle section) ── */}
            <SubHeading>Deal-breakers</SubHeading>
            <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 16px", lineHeight: 1.6 }}>
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
          </CollapsibleSection>

          {/* ══════════════════════════════════════════════════════
              GROUP 3 — Membership (its OWN peer group, pulled out of Account per
              the profile redesign). Collapsed by default; the header summary is a
              PASSIVE tier signal ("Spectrum (Free)" / "Spectrum Companion") — no
              auto-open, no red dot / "NEW" nag. Opened: free members lead with
              reassurance (everything daily is free forever) + a calm "what
              Companion adds" card + one honest door; Companion members get status
              + badge + Manage. The Hinge model (a labelled destination), never the
              Tinder model (a banner hijacking the top). onOpenMembership/tier
              wiring is unchanged — this is display + navigation only.
          ══════════════════════════════════════════════════════ */}
          <CollapsibleSection
            id="membership"
            title="Membership"
            summary={membershipSummary}
            hasContent={false}
            open={!!sectionOpen.membership}
            onToggle={() => toggleSection("membership")}
            headerStyle={h2Style}
            cardStyle={card}
          >
            {isCompanion ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: t.text }}>
                    You're on Spectrum Companion
                  </p>
                  <CompanionBadge />
                </div>
                <p style={{ margin: "0 0 18px", fontSize: 15, color: t.textSoft, lineHeight: 1.7 }}>
                  Matching, messaging, safety, and seeing who likes you always stay
                  free — Companion only adds comfort and capability on top.
                </p>
                <button
                  type="button"
                  onClick={onOpenMembership}
                  style={{
                    minHeight: 44,
                    padding: "10px 20px",
                    borderRadius: 10,
                    border: `1px solid ${t.accentStrong}`,
                    background: "transparent",
                    color: t.accentStrong,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: t.sans,
                  }}
                >
                  Manage membership
                </button>
              </>
            ) : (
              <>
                {/* LEAD with reassurance — never "missing out". */}
                <p style={{ margin: "0 0 16px", fontSize: 16, color: t.text, lineHeight: 1.7 }}>
                  You're on <strong>Spectrum (Free)</strong>. Everything you use
                  every day is free forever — matching, messaging, safety, and
                  seeing who likes you.
                </p>

                {/* Calm "what Companion adds" card — framed as ADDITIONS, no lock
                    icons, no urgency, no counters. */}
                <div
                  style={{
                    background: t.surfaceAlt,
                    border: `1px solid ${t.borderLight}`,
                    borderRadius: 14,
                    padding: "16px 18px",
                    marginBottom: 18,
                  }}
                >
                  <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: t.text, lineHeight: 1.5 }}>
                    Spectrum Companion is one optional plan that adds:
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      "Conversation help when a message feels hard to start",
                      "Express-yourself media on your profile",
                      "Deeper filters and saved search sets",
                      "Top Picks — a small, calm set of people we think you'll like",
                    ].map((add) => (
                      <li key={add} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: 1.5, color: t.textSoft }}>
                        <span aria-hidden="true" style={{ color: t.accentStrong, fontWeight: 700, flexShrink: 0 }}>+</span>
                        <span style={{ minWidth: 0 }}>{add}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* ONE honest door — no price, no urgency on the button. */}
                <button
                  type="button"
                  onClick={onOpenMembership}
                  style={{
                    minHeight: 44,
                    padding: "10px 20px",
                    borderRadius: 10,
                    border: `1px solid ${t.accentStrong}`,
                    background: "transparent",
                    color: t.accentStrong,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: t.sans,
                  }}
                >
                  See what Companion adds
                </button>
              </>
            )}
          </CollapsibleSection>

          {/* ══════════════════════════════════════════════════════
              GROUP 4 — Account (settings, not "about you"): profile review +
              notifications. Membership moved to its own peer group above.
          ══════════════════════════════════════════════════════ */}
          <CollapsibleSection
            id="account"
            title="Account"
            summary={accountSummary}
            hasContent={accountHasContent}
            open={!!sectionOpen.account}
            onToggle={() => toggleSection("account")}
            headerStyle={h2Style}
            cardStyle={card}
          >
            {/* ── Profile review (identity verification) ── */}
            <SubHeading>Profile review</SubHeading>
            {verified ? (
              <p style={{ margin: 0, fontSize: 16, color: t.positive, fontWeight: 600, lineHeight: 1.6 }}>
                <span aria-hidden="true">✓</span> Your profile has been reviewed by our team.
              </p>
            ) : verificationRequested === "pending" ? (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 16, color: t.textSoft, lineHeight: 1.7 }}>
                  <strong style={{ color: t.text }}>Review request received.</strong> Our
                  team will look over your profile shortly.
                </p>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 600,
                    color: t.textSoft,
                    background: t.surfaceAlt,
                    border: `1px solid ${t.border}`,
                    letterSpacing: "0.01em",
                  }}
                >
                  Pending review
                </span>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 14px", fontSize: 16, color: t.textSoft, lineHeight: 1.7 }}>
                  {verificationRequested === "rejected"
                    ? (verificationRejectionReason
                        ? `Your review wasn't approved this time. ${verificationRejectionReason} You can review your details and try again.`
                        : "Your review wasn't approved this time. You can review your details and try again.")
                    : "Ask our team to review your profile. Reviewed members get a badge that shows others a real person has looked over their profile. This is a team review, not a formal identity or ID check."}
                </p>
                {/* First-time explainer only — keep the rejected state to its
                    existing retry + reason (no clutter). */}
                {verificationRequested !== "rejected" && <VerificationGuide />}
                {verifRequestError && (
                  <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "0 0 10px" }}>
                    {verifRequestError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={verifRequestBusy}
                  onClick={async () => {
                    setVerifRequestBusy(true);
                    setVerifRequestError("");
                    try {
                      await requestVerification();
                      setVerificationRequested("pending");
                    } catch (e) {
                      setVerifRequestError(e?.message || "Couldn't submit your request. Please try again.");
                    } finally {
                      setVerifRequestBusy(false);
                    }
                  }}
                  style={{
                    minHeight: 44,
                    padding: "10px 20px",
                    borderRadius: 10,
                    border: `1px solid ${t.accentStrong}`,
                    background: "transparent",
                    color: t.accentStrong,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: verifRequestBusy ? "wait" : "pointer",
                    fontFamily: t.sans,
                    opacity: verifRequestBusy ? 0.7 : 1,
                  }}
                >
                  {verifRequestBusy ? "Submitting…" : verificationRequested === "rejected" ? "Re-request review" : "Request review"}
                </button>
              </>
            )}

            <SubDivider />

            {/* ── Notifications ── */}
            <SubHeading>Notifications</SubHeading>
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
                style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 12, float: "left", width: "100%" }}
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
                        fontSize: 16,
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
                      style={{ display: "block", fontSize: 14, color: t.textSoft, marginLeft: 30, marginBottom: 4 }}
                    >
                      {desc}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
          </CollapsibleSection>

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

          {/* Moderation moved to the primary nav (top tab on desktop / bottom
              bar item on mobile) for admins — no longer a Profile button. */}

          {/* ── Account & settings hub ──
              On mobile the top bar is stripped to the logo, so the utility nav
              (Safety / Settings / Account & security) lives here. Rendered on all
              viewports for consistency with the always-shown Sign-out section.
              Distinct labelled landmark from the bottom <nav aria-label="Primary">. */}
          {(onOpenSafety || onOpenSettings || onOpenAccount) && (
            <nav
              aria-label="Account and settings"
              style={{
                marginTop: 24,
                paddingTop: 24,
                borderTop: `1px solid ${t.borderLight}`,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Safety first — a vulnerable audience shouldn't dig for safety tools. */}
              {onOpenSafety && (
                <HubRow
                  icon={<ShieldIcon size={20} />}
                  title="Safety"
                  description="Report, block, and safety tools."
                  onClick={onOpenSafety}
                />
              )}
              {onOpenSettings && (
                <HubRow
                  icon={<GearIcon size={20} />}
                  title="Settings"
                  description="Appearance, accessibility, feedback."
                  onClick={onOpenSettings}
                />
              )}
              {onOpenAccount && (
                <HubRow
                  icon={<LockIcon size={20} />}
                  title="Account & security"
                  description="Change your password or email, or delete your account."
                  onClick={onOpenAccount}
                />
              )}
            </nav>
          )}

          {/* ── Sign out ── */}
          {onSignOut && (
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: `1px solid ${t.borderLight}`, textAlign: "center" }}>
              <SignOutButton onSignOut={onSignOut} />
            </div>
          )}

          {/* ── Download my data ── */}
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${t.borderLight}`, textAlign: "center" }}>
            <a
              href={getExportUrl()}
              download="spectrum-dating-export.zip"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                color: t.textSoft,
                fontSize: 16,
                fontWeight: 500,
                textDecoration: "none",
                padding: "10px 24px",
                minHeight: 44,
                boxSizing: "border-box",
              }}
            >
              Download my data
            </a>
            <p style={{ margin: "10px 0 0", fontSize: 14, color: t.textMuted }}>
              A ZIP with a readable page of your profile and conversations, plus
              your photos and a machine-readable copy.
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

// ── Account & security link ───────────────────────────────────────────────────
// The change-password / change-email / delete-account controls now live on the
// dedicated AccountSecurityScreen; this row navigates there.
// A calm navigation row: leading icon + title/description + trailing chevron.
// Navigates to a full screen (no popup/disclosure). The text label carries the
// accessible name; the leading icon is aria-hidden decorative (from icons.jsx).
// ── Verification guide (calm, first-time explainer) ──────────────────────────
// Static and presentational — no hooks, no tappables. Rendered ONLY in the
// default not-yet-requested state so the pending/rejected/verified states stay
// quiet and uncluttered. Purely lowers anxiety around the existing (free) team
// review; it does not touch the request/pending/rejected/verified logic.
function VerificationGuide() {
  const panel = {
    background: t.surfaceAlt,
    border: `1px solid ${t.borderLight}`,
    borderRadius: 14,
    padding: "16px 18px",
    margin: "0 0 14px",
  };
  const heading = { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: t.text };
  const itemText = { minWidth: 0, fontSize: 15, color: t.textSoft, lineHeight: 1.6 };
  const steps = [
    "You ask for a review — one tap, that's it.",
    "A real person on our team looks over your profile.",
    "You get a calm badge that tells others a real person reviewed your profile.",
  ];
  const isList = [
    "It's a light review by a real person on our team.",
    "It's optional — you never have to ask, and it changes nothing else about your account.",
    "If it isn't approved, you can quietly try again. There's no limit and no penalty.",
  ];
  const isntList = [
    "It is not an ID or document upload.",
    "It is not a face scan or any kind of biometric check.",
    "Nothing is stored beyond the badge itself.",
  ];
  return (
    <div>
      {/* Step-by-step: what actually happens after you ask */}
      <div style={panel}>
        <p style={heading}>What happens when you ask for a review</p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 auto",
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: t.accentFill,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                {i + 1}
              </span>
              <span style={itemText}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* What it is — and isn't (honest framing that reduces anxiety) */}
      <div style={panel}>
        <p style={heading}>What this is — and isn't</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {isList.map((s, i) => (
            <li key={`is-${i}`} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", color: t.positiveText, fontSize: 15, fontWeight: 700, lineHeight: 1.6 }}>✓</span>
              <span style={itemText}>{s}</span>
            </li>
          ))}
          {isntList.map((s, i) => (
            <li key={`isnt-${i}`} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", color: t.textMuted, fontSize: 15, fontWeight: 700, lineHeight: 1.6 }}>×</span>
              <span style={itemText}>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Gentle, optional tips — friendly, never gates or pressure */}
      <div style={{ ...panel, margin: 0 }}>
        <p style={heading}>A couple of things that help</p>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
          These aren't required — just two things that help the review go smoothly.
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {["A clear main photo.", "A filled-in bio."].map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", color: t.accentStrong, fontSize: 15, lineHeight: 1.6 }}>•</span>
              <span style={itemText}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HubRow({ icon, title, description, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 56,
        padding: "14px 18px",
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        cursor: "pointer",
        textAlign: "left",
        ...f.style,
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", color: t.accentStrong, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 2 }}>{description}</span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 20, color: t.accentStrong, flexShrink: 0 }}>→</span>
    </button>
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
        fontSize: 16,
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
        borderRadius: t.radius.pill,
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
        borderRadius: t.radius.pill,
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
        fontSize: 16,
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
        fontSize: 16,
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

// ── Expand all / Collapse all toggle ──────────────────────────────────────────
function ExpandAllToggle({ allExpanded, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        background: "transparent",
        border: "none",
        color: t.accentStrong,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        padding: "8px 4px",
        minHeight: 44,
        fontFamily: t.sans,
        ...f.style,
      }}
    >
      {allExpanded ? "Collapse all" : "Expand all"}
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
        border: `1px solid ${disabled ? t.border : t.positiveFill}`,
        background: disabled ? t.surfaceAlt : t.positiveFill,
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
