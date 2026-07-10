import { useState, useRef, useEffect, useId } from "react";
import { t } from "./tokens.js";
import { SlidersIcon } from "./icons.jsx";
import { useFocusable } from "./useFocusable.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// A11yQuickToggles — a discreet "comfort" control for the pre-auth / onboarding
// screens (Landing, Auth, Onboarding), where the users who most need plainer
// words and less visual load meet the busiest, highest-stakes screens with no
// way to turn them on (those toggles otherwise live only in Settings, behind
// auth + the Profile hub).
//
// It writes to the SAME `spectrum_a11y` prefs via App's `onChange` (applyA11y),
// so a change persists and Settings reflects it later, and the global
// PlainLanguage/ReducedSensory providers/effects react immediately. It does NOT
// fork a second prefs store — App owns the single source of truth and passes the
// live `prefs` in. Kept visually quiet: a small corner disclosure, not a banner.

// One compact labelled switch, matching the Settings ToggleRow pattern
// (role="switch", aria-checked, aria-labelledby) so screen-reader behaviour and
// keyboard affordances are consistent across the app.
function QuickToggle({ id, label, checked, onChange }) {
  const f = useFocusable();
  return (
    <div
      // Whole row is the tap target; the switch stops propagation so a tap on it
      // toggles once, not twice (same pattern as SettingsScreen's ToggleRow).
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        padding: "10px 4px",
        cursor: "pointer",
      }}
    >
      <span id={`${id}-label`} style={{ fontSize: 15, fontWeight: 600, color: t.text, minWidth: 0 }}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
        {...f}
        style={{
          position: "relative",
          width: 44,
          height: 26,
          borderRadius: 13,
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
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
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

export default function A11yQuickToggles({ prefs, onChange }) {
  const plain = usePlainLanguage();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const fTrigger = useFocusable();
  const panelId = useId();

  // B26 parity — Low Stimulation implies reduce-motion (it absorbed Calm mode).
  // Remember the pre-Low-Stim reduceMotion so turning it back off restores it
  // instead of leaving reduce-motion stuck on, exactly like SettingsScreen.
  const priorReduceMotion = useRef(null);
  function setPref(key, value) {
    const next = { ...prefs, [key]: value };
    if (key === "reducedSensory") {
      if (value) {
        priorReduceMotion.current = prefs.reduceMotion;
        next.reduceMotion = true;
      } else {
        next.reduceMotion = priorReduceMotion.current ?? false;
        priorReduceMotion.current = null;
      }
    }
    onChange(next);
  }

  // Dismiss on outside pointer + Escape (Escape returns focus to the trigger).
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        right: "calc(env(safe-area-inset-right, 0px) + 10px)",
        zIndex: 50,
        fontFamily: t.sans,
        // Right-align the panel under the trigger.
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        {...fTrigger}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          minHeight: 40,
          padding: "8px 12px",
          borderRadius: 999,
          background: t.surface,
          color: t.accentStrong,
          border: `1px solid ${t.border}`,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: t.shadow.sm,
          ...fTrigger.style,
        }}
      >
        <SlidersIcon size={16} aria-hidden="true" />
        {plain ? "Make it easier" : "Comfort"}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={plain ? "Make it easier" : "Comfort options"}
          style={{
            marginTop: 8,
            width: 264,
            maxWidth: "calc(100vw - 24px)",
            background: t.surface,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 16,
            padding: "14px 16px",
            boxShadow: t.shadow.md,
            boxSizing: "border-box",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 13, color: t.textSoft, lineHeight: 1.5 }}>
            {plain
              ? "Turn these on anytime. They save on this device."
              : "Turn these on whenever you like — they save on this device."}
          </p>
          <QuickToggle
            id="quick-plain-language"
            label="Plain language"
            checked={!!prefs.plainLanguage}
            onChange={(v) => setPref("plainLanguage", v)}
          />
          <div style={{ height: 1, background: t.borderLight, margin: "2px 0" }} />
          <QuickToggle
            id="quick-low-stim"
            label="Low stimulation"
            checked={!!prefs.reducedSensory}
            onChange={(v) => setPref("reducedSensory", v)}
          />
        </div>
      )}
    </div>
  );
}
