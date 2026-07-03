import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { submitFeedback, getProfile, updateProfile } from "./api.js";
// A11y pref helpers live in their own small module (a11yPrefs.js) so App can
// import readA11y on the critical path without pulling this whole (now lazily
// split) screen back into the main bundle. Re-exported here for any existing
// importers.
import { A11Y_KEY, DEFAULT_A11Y, readA11y } from "./a11yPrefs.js";
import { useFocusable } from "./useFocusable.js";

export { A11Y_KEY, DEFAULT_A11Y, readA11y };

// Accessibility settings — frontend-only. Prefs persist in localStorage under
// `spectrum_a11y` and are applied globally by App.jsx. This screen just lets the
// user toggle them and saves immediately. Same calm shell as MatchesScreen /
// SafetyScreen.


const cardStyle = {
  background: t.surface,
  border: `1px solid ${t.border}`,
  borderRadius: 16,
  padding: "6px 18px",
  boxShadow: t.shadow.sm,
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
        fontSize: 16,
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

// Theme picker — a swatch-card radio grid. Each card is a static mini preview
// built from THAT theme's actual palette (hardcoded per card, since only one
// theme's CSS variables can be live at once): the theme's bg as the card fill,
// a surface chip, an accent dot, and "Aa" in its text color. Seeing before
// committing beats flashing the whole screen through every option; selection
// still applies instantly (predictable), and dim stays the default.
const THEME_CARDS = [
  { key: "dim",       label: "Warm dim",   note: "The calm default", bg: "#181F1D", surface: "#26312D", border: "#3E4D47", accent: "#356962", text: "#E4EAE6" },
  { key: "light",     label: "Light",      note: "",                 bg: "#F5F3EE", surface: "#FFFFFF", border: "#C7D2CA", accent: "#3E6660", text: "#24332D" },
  { key: "navy",      label: "Navy",       note: "",                 bg: "#121A2B", surface: "#1C2740", border: "#3A4B6B", accent: "#33518A", text: "#E5EAF3" },
  { key: "lightblue", label: "Light blue", note: "",                 bg: "#F2F5F9", surface: "#FFFFFF", border: "#BFCEDC", accent: "#2F5675", text: "#22303F" },
  { key: "pink",      label: "Pink",       note: "",                 bg: "#FAF3F2", surface: "#FFFFFF", border: "#D8C2C8", accent: "#8A4560", text: "#372B2F" },
  // Identity themes — named honestly (the rendered colors are what an onlooker
  // recognizes, not the menu label; euphemisms only patronize). The flag shows
  // in the swatch stripe; the UI itself stays a calm single-accent theme.
  { key: "pride",     label: "Pride",      note: "Calm violet, rainbow in the logo", bg: "#F7F5F2", surface: "#FFFFFF", border: "#CCC5D4", accent: "#5A3E8C", text: "#2B2833", stripes: ["#B5544C", "#C08A45", "#B29A45", "#5E9459", "#4F7DA6", "#7B5EA7"] },
  { key: "trans",     label: "Trans pride", note: "Soft blue, pink message bubbles",  bg: "#F3F8FB", surface: "#FFFFFF", border: "#BDD2DE", accent: "#21607C", text: "#23323B", stripes: ["#5BCEFA", "#F5A9B8", "#FFFFFF", "#F5A9B8", "#5BCEFA"] },
];

const IDENTITY_KEYS = ["pride", "trans"];

function ThemeSegmented({ value, onChange }) {
  // FE-6: the identity disclosure paragraph (rendered only while pride/trans is
  // active) is associated to the identity cards via aria-describedby.
  const identityActive = IDENTITY_KEYS.includes(value);
  return (
    <div
      // FE-6: role="group", NOT role="radiogroup". These cards are plain
      // aria-pressed toggle buttons (each its own Tab stop), so we don't claim
      // radiogroup keyboard semantics (roving tabindex / Arrow selection) we
      // don't implement.
      role="group"
      aria-label="Theme"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      {THEME_CARDS.map((c) => (
        <ThemeCard
          key={c.key}
          card={c}
          active={value === c.key}
          onClick={() => onChange(c.key)}
          describedBy={IDENTITY_KEYS.includes(c.key) && identityActive ? "identity-theme-note" : undefined}
        />
      ))}
      {/* Plain, non-alarming disclosure for the identity themes (shown while
          one is selected): screen visibility, the instant revert gesture, and
          the sign-out reset. Honest information, no fear framing. */}
      {identityActive && (
        <p id="identity-theme-note" style={{ gridColumn: "1 / -1", margin: "2px 2px 0", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
          This changes how the app looks to anyone who can see your screen. You can
          switch back anytime — double-tap the Spectrum logo, or (with a keyboard or
          screen reader) select it, where it reads as a &ldquo;Switch back to Warm
          dim&rdquo; button, to return to Warm dim instantly. It also switches back to
          Warm dim when you sign out.
        </p>
      )}
    </div>
  );
}

function ThemeCard({ card, active, onClick, describedBy }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      // FE-6: honest aria-pressed toggle (no role="radio" without radio behavior).
      aria-pressed={active}
      aria-describedby={describedBy}
      aria-label={`${card.label} theme${card.note ? ` — ${card.note.toLowerCase()}` : ""}`}
      onClick={onClick}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={{
        padding: 0,
        border: active ? `2px solid ${t.accentStrong}` : `1px solid ${t.border}`,
        borderRadius: 12,
        background: t.surface,
        cursor: "pointer",
        overflow: "hidden",
        textAlign: "left",
        fontFamily: t.sans,
        ...f.style,
      }}
    >
      {/* Static swatch preview in the target theme's own colors */}
      <span
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 56,
          padding: "0 12px",
          background: card.bg,
          borderBottom: `1px solid ${card.border}`,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, color: card.text }}>Aa</span>
        <span style={{ width: 26, height: 18, borderRadius: 5, background: card.surface, border: `1px solid ${card.border}` }} />
        <span style={{ width: 14, height: 14, borderRadius: "50%", background: card.accent }} />
        {card.stripes && (
          <span style={{ display: "flex", flexDirection: "column", width: 10, height: 18, borderRadius: 3, overflow: "hidden", border: `1px solid ${card.border}`, marginLeft: "auto" }}>
            {card.stripes.map((s, i) => (
              <span key={i} style={{ flex: 1, background: s }} />
            ))}
          </span>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 40, padding: "4px 12px" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{card.label}</span>
        {active && <span aria-hidden="true" style={{ color: t.accentStrong, fontWeight: 700 }}>✓</span>}
      </span>
      {card.note && (
        <span style={{ display: "block", padding: "0 12px 8px", fontSize: 13, color: t.textSoft }}>
          {card.note}
        </span>
      )}
    </button>
  );
}

// One labelled toggle row. Reuses the small switch pattern used elsewhere
// (ProfileScreen: role="switch", aria-checked, aria-labelledby).
function ToggleRow({ id, label, description, checked, onChange, first }) {
  const f = useFocusable();
  return (
    <div
      // UX-TAP — the whole row is the tap target (label + description), not just
      // the tiny switch. The switch button stops propagation so a tap on it
      // toggles once, not twice. Keyboard/focus stays on the role="switch" button.
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 0",
        borderTop: first ? "none" : `1px solid ${t.borderLight}`,
        cursor: "pointer",
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
        onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
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

const FEEDBACK_MAX = 2000;

// F3 — member-facing feedback. A small, calm "tell us what felt wrong" surface.
// No pressure: plain language, optional, gentle success + graceful error.
function FeedbackSection() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");
  const f = useFocusable();

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && status !== "sending";

  async function handleSend() {
    if (!canSend) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      await submitFeedback(trimmed);
      setStatus("sent");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err?.status === 429
          ? "You've sent feedback recently. Please try again a little later."
          : "We couldn't send that just now. Please try again."
      );
    }
  }

  return (
    <div style={{ ...cardStyle, padding: "18px 18px" }}>
      <label
        htmlFor="feedback-message"
        style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}
      >
        Tell us what felt wrong
      </label>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
        If something felt confusing, uncomfortable, or off, we'd like to know.
        This goes straight to our team. No pressure — share as much or as little
        as you like.
      </p>
      <textarea
        id="feedback-message"
        value={message}
        onChange={(e) => {
          setMessage(e.target.value.slice(0, FEEDBACK_MAX));
          if (status !== "idle") setStatus("idle");
        }}
        maxLength={FEEDBACK_MAX}
        rows={4}
        placeholder="What's on your mind?"
        {...f}
        style={{
          width: "100%",
          border: `1px solid ${t.formBorder}`,
          borderRadius: 11,
          padding: "12px 14px",
          // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
          fontSize: 16,
          color: t.text,
          background: t.bg,
          resize: "vertical",
          fontFamily: t.sans,
          lineHeight: 1.5,
          boxSizing: "border-box",
          ...f.style,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: t.textMuted }}>
          {message.length}/{FEEDBACK_MAX}
        </span>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          style={{
            minHeight: 44,
            padding: "10px 20px",
            borderRadius: 11,
            border: `1px solid ${t.accent}`,
            cursor: canSend ? "pointer" : "not-allowed",
            opacity: canSend ? 1 : 0.6,
            fontSize: 16,
            fontWeight: 600,
            background: t.accent,
            color: "#fff",
          }}
        >
          {status === "sending" ? "Sending…" : "Send feedback"}
        </button>
      </div>

      {status === "sent" && (
        <p role="status" style={{ margin: "12px 0 0", fontSize: 14, color: t.accentStrong, lineHeight: 1.5 }}>
          Thank you — we've received your note. It really helps.
        </p>
      )}
      {status === "error" && (
        <p role="alert" style={{ margin: "12px 0 0", fontSize: 14, color: t.danger, lineHeight: 1.5 }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}

// F6 — weekly email digest opt-in. Unlike the a11y toggles (localStorage), this
// preference lives on the profile: read from GET /profile/me, persisted via
// PUT /profile/me { weeklyDigest }. Optimistic with revert-on-failure so the
// switch always reflects what's actually saved. Off by default.
function DigestSection() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false); // profile fetched yet?
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getProfile()
      .then((p) => {
        if (!alive) return;
        setEnabled(!!p?.weeklyDigest);
        setLoaded(true);
      })
      .catch(() => {
        // Couldn't load — leave the switch off (the safe default) and let the
        // user still toggle; a failed persist will surface its own message.
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleToggle(next) {
    if (saving) return;
    const prev = enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    setError("");
    try {
      await updateProfile({ weeklyDigest: next });
    } catch {
      setEnabled(prev); // revert on failure
      setError("We couldn't save that just now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={cardStyle}>
      <ToggleRow
        id="digest-weekly"
        first
        label="Weekly email digest"
        description="A calm weekly email with your new matches and unread counts. Off by default — turn it on if a gentle nudge helps. No message content, ever."
        checked={enabled}
        onChange={loaded ? handleToggle : () => {}}
      />
      <p style={{ margin: "0 0 14px", fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
        Emails only start once this is on and your email address is verified. You
        can turn it off here anytime.
      </p>
      {error && (
        <p role="alert" style={{ margin: "0 0 14px", fontSize: 14, color: t.danger, lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

// A calm navigation row (icon-free) that links to another screen.
function LinkRow({ title, description, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
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
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginTop: 2 }}>{description}</span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 20, color: t.accentStrong, flexShrink: 0 }}>→</span>
    </button>
  );
}

export default function SettingsScreen({ onBack, onChange, onOpenAccount }) {
  const [prefs, setPrefs] = useState(() => readA11y());
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const update = useCallback(
    (key, value) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        // Low Stimulation implies reduce-motion (it absorbed Calm mode). Keep them
        // coherent so the switches reflect what's actually applied.
        if (key === "reducedSensory" && value) next.reduceMotion = true;
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
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };

  return (
    <div style={page}>
      <div style={shell}>
        <SecondaryButton onClick={onBack}>← Back</SecondaryButton>

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          Settings
        </h1>
        <p style={{ margin: "0 0 26px", fontSize: 16, color: t.textSoft }}>
          Adjust how Spectrum looks and feels. Changes save instantly and stay on
          this device.
        </p>

        <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "0 2px 4px", color: t.text }}>
          Theme
        </h2>
        <p style={{ margin: "0 2px 12px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          Pick whichever feels comfortable. You can change it anytime.
        </p>
        <ThemeSegmented value={prefs.theme} onChange={(v) => update("theme", v)} />

        <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "28px 2px 12px", color: t.text }}>
          Accessibility
        </h2>

        <div style={cardStyle}>
          <ToggleRow
            id="a11y-reduced-sensory"
            first
            label="Low stimulation"
            description="Hide decorative visuals and backgrounds, calm animations, and use a quieter, flatter style."
            checked={prefs.reducedSensory}
            onChange={(v) => update("reducedSensory", v)}
          />
          <ToggleRow
            id="a11y-plain-language"
            label="Plain language"
            description="Use shorter, more direct wording on buttons and messages."
            checked={prefs.plainLanguage}
            onChange={(v) => update("plainLanguage", v)}
          />
          <ToggleRow
            id="a11y-reduce-motion"
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
        </div>

        <p style={{ margin: "20px 2px 0", fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
          These settings only change how the app appears for you. If text still
          isn't large enough, your browser or device zoom can enlarge it further.
        </p>

        {onOpenAccount && (
          <>
            <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "32px 2px 12px", color: t.text }}>
              Account
            </h2>
            <LinkRow
              title="Account & security"
              description="Change your password or email, or delete your account."
              onClick={onOpenAccount}
            />
          </>
        )}

        <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "32px 2px 12px", color: t.text }}>
          Email
        </h2>
        <DigestSection />

        <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, margin: "32px 2px 12px", color: t.text }}>
          Send feedback
        </h2>
        <FeedbackSection />
      </div>
    </div>
  );
}
