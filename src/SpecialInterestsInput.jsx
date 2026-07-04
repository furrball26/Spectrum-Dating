import { useState } from "react";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";
import {
  SPECIAL_INTERESTS_MAX,
  SPECIAL_INTEREST_MAX_LEN,
  addSpecialInterest,
} from "./specialInterests.js";

// D-17 Phase 2 — the collection UI for the matchable "special interests" chips
// ("Could talk for hours about"). One calm chip/tag input, capped at 3 items of
// ≤40 chars each (matching the backend EXACTLY so the client never submits what
// the server rejects). Shared by ProfileScreen's editor and OnboardingScreen's
// moat step so the two never drift. Pure-controlled: `items` in, `onChange` out.
//
// House rules: useFocusable lives at each component's top level (never inside a
// .map), so the remove chip is its own component — hook order stays stable.

function SpecialInterestChip({ label, onRemove, prefersReduced }) {
  const f = useFocusable();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: "100%",
        minWidth: 0,
        background: t.accentFill,
        color: "#fff",
        borderRadius: 24,
        padding: "4px 4px 4px 12px",
        fontSize: 14,
        fontWeight: 500,
        transition: prefersReduced ? "none" : "opacity 150ms ease",
      }}
    >
      {/* minWidth:0 + overflow guards long chip text inside the flex row. */}
      <span aria-hidden="true" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        {...f}
        style={{
          flexShrink: 0,
          minHeight: 32,
          minWidth: 32,
          marginLeft: 4,
          border: "none",
          background: "transparent",
          color: "#fff",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          borderRadius: 999,
          ...f.style,
        }}
      >
        ×
      </button>
    </div>
  );
}

// `idPrefix` keeps input/label/hint ids unique when two of these mount (they
// don't today, but it's cheap insurance). `announce` (optional) pipes add/remove
// into the host screen's existing SR live region.
export default function SpecialInterestsInput({ items, onChange, idPrefix = "special-interests", announce, prefersReduced = false }) {
  const [input, setInput] = useState("");
  const fAdd = useFocusable();
  const list = Array.isArray(items) ? items : [];
  const atCap = list.length >= SPECIAL_INTERESTS_MAX;

  const inputId = `${idPrefix}-input`;
  const hintId = `${idPrefix}-hint`;

  function handleAdd() {
    const raw = input.trim();
    const next = addSpecialInterest(list, raw);
    if (next === list) {
      // No-op (blank, duplicate, or at cap). Clear a pure-whitespace input so it
      // doesn't look stuck; leave real text so a duplicate stays visible to edit.
      if (!raw) setInput("");
      return;
    }
    onChange(next);
    announce?.(`Added: ${next[next.length - 1]}`);
    setInput("");
  }

  function handleRemove(tag) {
    onChange(list.filter((x) => x !== tag));
    announce?.(`Removed: ${tag}`);
  }

  return (
    <div>
      {/* Selected chips */}
      {list.length > 0 && (
        <ul
          role="list"
          aria-label="Your special interests"
          style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}
        >
          {list.map((tag) => (
            <li key={tag} role="listitem" style={{ minWidth: 0, maxWidth: "100%" }}>
              <SpecialInterestChip label={tag} onRemove={() => handleRemove(tag)} prefersReduced={prefersReduced} />
            </li>
          ))}
        </ul>
      )}

      {atCap ? (
        <p style={{ margin: "0", fontSize: 13, color: t.textMuted }}>
          That's the most you can add ({SPECIAL_INTERESTS_MAX}). Remove one to swap it out.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={inputId} style={{ display: "block", fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 4 }}>
              Add a topic
            </label>
            <input
              id={inputId}
              type="text"
              maxLength={SPECIAL_INTEREST_MAX_LEN}
              aria-describedby={hintId}
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
              onFocus={(e) => { e.target.style.outline = `2px solid ${t.focus}`; e.target.style.outlineOffset = "2px"; }}
              onBlur={(e) => { e.target.style.outline = "none"; }}
              style={{
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
              }}
              placeholder="e.g. steam trains"
            />
            <span id={hintId} style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 4 }}>
              Up to {SPECIAL_INTERESTS_MAX} topics, {SPECIAL_INTEREST_MAX_LEN} characters each. Press Enter to add.
            </span>
          </div>
          <button
            type="button"
            aria-label="Add topic"
            onClick={handleAdd}
            {...fAdd}
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
              alignSelf: "flex-start",
              marginTop: 26,
              flexShrink: 0,
              ...fAdd.style,
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
