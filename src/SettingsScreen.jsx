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

// Segmented control for the theme choice (Light / Warm dim). Mirrors the calm,
// rounded styling of the rest of the screen and applies the change immediately.
function ThemeSegmented({ value, onChange }) {
  const options = [
    { key: "light", label: "Light" },
    { key: "dim", label: "Warm dim" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: t.surfaceAlt,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <ThemeOption
            key={opt.key}
            label={opt.label}
            active={active}
            onClick={() => onChange(opt.key)}
          />
        );
      })}
    </div>
  );
}

function ThemeOption({ label, active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      {...f}
      style={{
        flex: 1,
        minHeight: 44,
        padding: "10px 12px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: active ? t.surface : "transparent",
        color: active ? t.text : t.textSoft,
        boxShadow: active ? t.shadow.sm : "none",
        transition: `background ${t.motion.base} ${t.motion.standard}, color ${t.motion.base} ${t.motion.standard}`,
        ...f.style,
      }}
    >
      {label}
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
          Warm dim is easier on the eyes in low light.
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
