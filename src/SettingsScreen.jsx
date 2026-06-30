import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";

// Accessibility settings — frontend-only. Prefs persist in localStorage under
// `spectrum_a11y` and are applied globally by App.jsx. This screen just lets the
// user toggle them and saves immediately. Same calm shell as MatchesScreen /
// SafetyScreen.

export const A11Y_KEY = "spectrum_a11y";

export const DEFAULT_A11Y = {
  reduceMotion: false,
  highContrast: false,
  largerText: false,
  calmMode: false,
};

// Read + normalise the saved prefs. Always returns a full, well-typed object so
// callers never have to guard for missing/garbage values.
export function readA11y() {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (!raw) return { ...DEFAULT_A11Y };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_A11Y };
    return {
      reduceMotion: !!parsed.reduceMotion,
      highContrast: !!parsed.highContrast,
      largerText: !!parsed.largerText,
      calmMode: !!parsed.calmMode,
    };
  } catch {
    return { ...DEFAULT_A11Y };
  }
}

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

const cardStyle = {
  background: t.surface,
  border: `1px solid ${t.border}`,
  borderRadius: 16,
  padding: "6px 18px",
  boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
};

function SecondaryButton({ children, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.formBorder}`,
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 600,
        background: t.green100,
        color: t.text,
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// One labelled toggle row. Reuses the small switch pattern used elsewhere
// (ProfileScreen: role="switch", aria-checked, aria-labelledby).
function ToggleRow({ id, label, description, checked, onChange, first }) {
  const f = useFocusable();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 0",
        borderTop: first ? "none" : `1px solid ${t.borderLight}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p id={`${id}-label`} style={{ margin: 0, fontSize: 16, fontWeight: 600, color: t.text }}>
          {label}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
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

export default function SettingsScreen({ onBack, onChange }) {
  const [prefs, setPrefs] = useState(() => readA11y());
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const update = useCallback(
    (key, value) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        // Calm mode implies reduce-motion (calm enables it). Keep them coherent
        // so the switches reflect what's actually applied.
        if (key === "calmMode" && value) next.reduceMotion = true;
        try {
          localStorage.setItem(A11Y_KEY, JSON.stringify(next));
        } catch {
          // localStorage may be unavailable (private mode); still apply live.
        }
        if (typeof onChange === "function") onChange(next);
        return next;
      });
    },
    [onChange]
  );

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 48px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: 600, margin: "0 auto" };

  return (
    <div style={page}>
      <div style={shell}>
        <SecondaryButton onClick={onBack}>← Back</SecondaryButton>

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          Accessibility
        </h1>
        <p style={{ margin: "0 0 26px", fontSize: 15, color: t.textSoft }}>
          Adjust how Spectrum looks and feels. Changes save instantly and stay on
          this device.
        </p>

        <div style={cardStyle}>
          <ToggleRow
            id="a11y-reduce-motion"
            first
            label="Reduce motion"
            description="Turn off animations and smooth-scrolling across the app."
            checked={prefs.reduceMotion}
            onChange={(v) => update("reduceMotion", v)}
          />
          <ToggleRow
            id="a11y-high-contrast"
            label="High contrast"
            description="Deepen colours and text to make things easier to read."
            checked={prefs.highContrast}
            onChange={(v) => update("highContrast", v)}
          />
          <ToggleRow
            id="a11y-larger-text"
            label="Larger text"
            description="Enlarge everything by about 15% for easier reading."
            checked={prefs.largerText}
            onChange={(v) => update("largerText", v)}
          />
          <ToggleRow
            id="a11y-calm-mode"
            label="Calm mode"
            description="Reduce motion and hide decorative backgrounds for a quieter, flatter look."
            checked={prefs.calmMode}
            onChange={(v) => update("calmMode", v)}
          />
        </div>

        <p style={{ margin: "20px 2px 0", fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>
          These settings only change how the app appears for you. If text still
          isn't large enough, your browser or device zoom can enlarge it further.
        </p>
      </div>
    </div>
  );
}
