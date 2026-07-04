// D-11/D-13 — shared, calm-by-design identity controls used by BOTH the
// onboarding "who you'd like to meet" step and the profile identity block, so
// the expanded-gender + orientation UX stays identical in both places.
//
// Calm-by-design: the gender picker shows a short COMMON list by default with a
// quiet "More options" expander revealing the full set, plus a "Self-describe"
// free-text. Orientation is an optional low-stimulation chip multi-select. All
// of it is optional and skippable.
import { useState } from "react";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";

// The 3 everyday options shown up-front (these also happen to be the matchable
// core, but the picker treats them as plain display values).
export const GENDER_COMMON = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Nonbinary" },
];

// Revealed behind "More options". Kept in sync with the server's VALID_GENDERS
// enum (server/src/routes/profile.js). Order is gentle, not ranked.
export const GENDER_MORE = [
  { value: "agender", label: "Agender" },
  { value: "genderfluid", label: "Genderfluid" },
  { value: "genderqueer", label: "Genderqueer" },
  { value: "trans-woman", label: "Trans woman" },
  { value: "trans-man", label: "Trans man" },
  { value: "two-spirit", label: "Two-spirit" },
  { value: "bigender", label: "Bigender" },
  { value: "intersex", label: "Intersex" },
  { value: "questioning", label: "Questioning" },
];

// Sentinel gender value that reveals the self-describe free-text field.
export const GENDER_SELF_DESCRIBE = "other";

// value → human label, for read-only display (cards, matched profile).
export const GENDER_LABELS = Object.fromEntries(
  [...GENDER_COMMON, ...GENDER_MORE, { value: GENDER_SELF_DESCRIBE, label: "Self-described" }]
    .map((o) => [o.value, o.label])
);

// D-13 orientation options (display only; never affects matching).
export const ORIENTATION_OPTIONS = [
  { value: "straight", label: "Straight" },
  { value: "gay", label: "Gay" },
  { value: "lesbian", label: "Lesbian" },
  { value: "bisexual", label: "Bisexual" },
  { value: "pansexual", label: "Pansexual" },
  { value: "asexual", label: "Asexual" },
  { value: "demisexual", label: "Demisexual" },
  { value: "queer", label: "Queer" },
  { value: "questioning", label: "Questioning" },
];
const ORIENTATION_LABELS = Object.fromEntries(ORIENTATION_OPTIONS.map((o) => [o.value, o.label]));

// D-14 relationship STRUCTURE (display only; a SEPARATE axis from relationship
// GOAL — both coexist and never affect matching). Kept in sync with the
// server's VALID_RELATIONSHIP_STRUCTURE enum (server/src/routes/profile.js).
export const RELATIONSHIP_STRUCTURE_OPTIONS = [
  { value: "monogamous", label: "Monogamous" },
  { value: "open", label: "Open" },
  { value: "polyamorous", label: "Polyamorous" },
  { value: "queerplatonic", label: "Queerplatonic" },
  { value: "figuring-it-out", label: "Figuring it out" },
];
const RELATIONSHIP_STRUCTURE_LABELS = Object.fromEntries(
  RELATIONSHIP_STRUCTURE_OPTIONS.map((o) => [o.value, o.label])
);

// Human-readable label for a stored relationship-structure value ('' → '').
export function relationshipStructureLabel(value) {
  if (!value) return "";
  return RELATIONSHIP_STRUCTURE_LABELS[value] || value;
}

const MORE_VALUES = new Set(GENDER_MORE.map((o) => o.value));

// Human-readable label for a stored gender value ('' → '', unknown → raw).
export function genderLabel(value) {
  if (!value) return "";
  return GENDER_LABELS[value] || value;
}

// Turn a stored comma-joined orientation string into readable labels.
export function orientationLabels(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => ORIENTATION_LABELS[v] || v);
}

// ─── Selectable pill (mirrors the interest SuggestionChip look) ────────────────
function Pill({ label, active, onClick, ariaLabel }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        minHeight: 44,
        padding: "8px 14px",
        borderRadius: 24,
        border: `1.5px solid ${active ? t.accentFill : t.formBorder}`,
        background: active ? t.accentFill : t.surfaceAlt,
        color: active ? "#fff" : t.textSoft,
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {label}
    </button>
  );
}

function inputStyle() {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: `1.5px solid ${t.formBorder}`,
    borderRadius: 10,
    fontSize: 16,
    color: t.text,
    background: t.surface,
    fontFamily: t.sans,
    outline: "none",
  };
}

// ─── Gender field: common list + "More options" + self-describe ────────────────
export function GenderField({ gender, setGender, genderCustom, setGenderCustom, idPrefix = "gender" }) {
  const advancedSelected = MORE_VALUES.has(gender) || gender === GENDER_SELF_DESCRIBE;
  const [expanded, setExpanded] = useState(false);
  const showMore = expanded || advancedSelected;

  function pick(value) {
    setGender(value);
    // Leaving self-describe clears the free-text so a stale label never lingers.
    if (value !== GENDER_SELF_DESCRIBE && setGenderCustom) setGenderCustom("");
  }

  return (
    <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4, float: "left", width: "100%" }}>
        Your gender
      </legend>
      <span style={{ display: "block", fontSize: 14, color: t.textSoft, margin: "0 0 10px", clear: "both" }}>
        Optional. Shown on your profile.
      </span>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Pill label="Prefer not to say" active={!gender} onClick={() => pick("")} />
        {GENDER_COMMON.map((o) => (
          <Pill key={o.value} label={o.label} active={gender === o.value} onClick={() => pick(o.value)} />
        ))}
      </div>

      {!showMore && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 12,
            background: "none",
            border: "none",
            padding: "6px 2px",
            minHeight: 40,
            color: t.accentStrong,
            fontSize: 15,
            fontWeight: 600,
            fontFamily: t.sans,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          More options
        </button>
      )}

      {showMore && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {GENDER_MORE.map((o) => (
            <Pill key={o.value} label={o.label} active={gender === o.value} onClick={() => pick(o.value)} />
          ))}
          <Pill
            label="Self-describe"
            active={gender === GENDER_SELF_DESCRIBE}
            onClick={() => setGender(GENDER_SELF_DESCRIBE)}
          />
        </div>
      )}

      {gender === GENDER_SELF_DESCRIBE && setGenderCustom && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`${idPrefix}-custom`} style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 4 }}>
            Describe your gender
          </label>
          <input
            id={`${idPrefix}-custom`}
            type="text"
            maxLength={40}
            value={genderCustom || ""}
            onChange={(e) => setGenderCustom(e.target.value)}
            onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
            onBlur={(e) => { e.target.style.outline = "none"; }}
            style={inputStyle()}
            placeholder="e.g. Demigirl"
          />
        </div>
      )}
    </fieldset>
  );
}

// ─── Orientation field: optional chip multi-select ─────────────────────────────
export function OrientationField({ orientation, setOrientation }) {
  const selected = String(orientation || "").split(",").map((s) => s.trim()).filter(Boolean);

  function toggle(value) {
    const next = selected.includes(value)
      ? selected.filter((x) => x !== value)
      : [...selected, value];
    setOrientation(next.join(","));
  }

  return (
    <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4, float: "left", width: "100%" }}>
        Sexuality
      </legend>
      <span style={{ display: "block", fontSize: 14, color: t.textSoft, margin: "0 0 10px", clear: "both" }}>
        Optional. Choose any that fit — shown on your profile, never used to filter Discover.
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ORIENTATION_OPTIONS.map((o) => (
          <Pill
            key={o.value}
            label={o.label}
            active={selected.includes(o.value)}
            ariaLabel={selected.includes(o.value) ? `${o.label} — selected` : o.label}
            onClick={() => toggle(o.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

// ─── Relationship structure: optional single-select pills ──────────────────────
// D-14. Display only, never used to filter Discover. A SEPARATE axis from the
// relationship *goal* (long-term / friendship / open) — both can be set.
export function RelationshipStructureField({ relationshipStructure, setRelationshipStructure }) {
  return (
    <fieldset style={{ border: "none", margin: "0 0 20px", padding: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4, float: "left", width: "100%" }}>
        Relationship style
      </legend>
      <span style={{ display: "block", fontSize: 14, color: t.textSoft, margin: "0 0 10px", clear: "both" }}>
        Optional. Shown on your profile, never used to filter Discover.
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Pill
          label="Prefer not to say"
          active={!relationshipStructure}
          onClick={() => setRelationshipStructure("")}
        />
        {RELATIONSHIP_STRUCTURE_OPTIONS.map((o) => (
          <Pill
            key={o.value}
            label={o.label}
            active={relationshipStructure === o.value}
            onClick={() => setRelationshipStructure(o.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}
