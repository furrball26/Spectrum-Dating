import { useState, useEffect, useRef } from "react";
import { getProfile, updateProfile } from "./api.js";
import { t } from "./tokens.js";
import { useFocusable } from "./useFocusable.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// NotificationsScreen — Spectrum Dating
// Split out of ProfileScreen so notification preferences live on their own calm
// surface, reached from the Profile Hub's bell button (not buried in the profile
// editor). Owns two things:
//   • Push notifications on/off — the browser push-permission flow, driven by
//     props from App (pushEnabled/pushSupported/onEnablePush/onDisablePush).
//   • Notification style (notificationTier: in_app | silent_push | name_only) —
//     loaded via getProfile() on mount and saved via updateProfile() the moment
//     a choice changes. This screen now OWNS notificationTier; the profile editor
//     no longer touches it, so a profile save can't clobber a choice made here.
// Calm-by-design: no urgency, no badge counts, no "you have N unread" nags — this
// is a quiet settings doorway. The markup mirrors AccountSecurityScreen's chrome.

// ─── Push notification toggle ─────────────────────────────────────────────────
// Relocated intact from ProfileScreen (same behavior/markup). useFocusable runs
// before the (supported) early return — one hook, above the return (React #310).
function NotificationToggle({ enabled, supported, onEnable, onDisable }) {
  const f = useFocusable();
  const plain = usePlainLanguage();
  if (!supported) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: t.text }}>
          {plain ? "Phone alerts" : "Push notifications"}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 14, color: t.textSoft }}>
          {plain ? "Tell me about new matches and messages." : "Get notified about new matches and messages"}
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
        aria-label={
          plain
            ? (enabled ? "Turn off phone alerts" : "Turn on phone alerts")
            : (enabled ? "Disable push notifications" : "Enable push notifications")
        }
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

// ── Back button (mirrors AccountSecurityScreen's BackButton) ──────────────────
function BackButton({ onClick }) {
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
      ← Back
    </button>
  );
}

const NOTIF_TIERS = [
  {
    value: "none",
    id: "notif-off",
    label: "Off",
    labelPlain: "Off",
    desc: "No push notifications at all. New messages simply wait for you in the app — you'll see a dot on the Messages tab when there's something new.",
    descPlain: "No phone alerts. New messages wait for you in the app. A dot shows on the Messages tab.",
  },
  {
    value: "silent_push",
    id: "notif-silent",
    label: "Silent push",
    labelPlain: "Silent buzz",
    desc: "Your phone will nudge you, but without the message text.",
    descPlain: "Your phone buzzes, but doesn't show the message text.",
  },
  {
    value: "name_only",
    id: "notif-name",
    label: "Name only",
    labelPlain: "Name only",
    desc: "Your phone shows who messaged you, but not what they said.",
    descPlain: "Your phone shows who wrote you, not what they said.",
  },
];

export default function NotificationsScreen({
  onBack,
  pushEnabled,
  pushSupported,
  onEnablePush,
  onDisablePush,
}) {
  const headingRef = useRef(null);
  const plain = usePlainLanguage();
  // Default to the backend's own default (name_only) so an untouched UI agrees
  // with what the server will actually do — never pre-select the retired "in_app".
  const [notifTier, setNotifTier] = useState("name_only");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // "" | "saving" | "saved" | "error" — a calm, low-key save state (no toasts).
  const [saveState, setSaveState] = useState("");

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    getProfile()
      .then((data) => {
        if (!alive) return;
        setNotifTier(data.notificationTier || "name_only");
      })
      .catch(() => {
        if (alive) setLoadError("Could not load your notification settings. Check your connection.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  async function changeTier(value) {
    if (value === notifTier) return;
    const previous = notifTier;
    setNotifTier(value); // optimistic — the radios respond immediately (calm, predictable)
    setSaveState("saving");
    try {
      await updateProfile({ notificationTier: value });
      setSaveState("saved");
    } catch {
      setNotifTier(previous); // revert on failure so what's shown matches what's saved
      setSaveState("error");
    }
  }

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
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: t.shadow.md,
  };

  return (
    <div style={page}>
      <div style={shell}>
        <BackButton onClick={onBack} />

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          {plain ? "Alerts" : "Notifications"}
        </h1>
        <p style={{ margin: "0 0 26px", fontSize: 16, color: t.textSoft, lineHeight: 1.6 }}>
          {plain
            ? "Choose how Spectrum tells you about new matches and messages. You can pick what feels calm."
            : "Choose how, and how quietly, Spectrum lets you know about new matches and messages. Nothing here is urgent — set it to whatever feels calm."}
        </p>

        {pushSupported && (
          <div style={card}>
            <NotificationToggle
              enabled={pushEnabled}
              supported={pushSupported}
              onEnable={onEnablePush}
              onDisable={onDisablePush}
            />
          </div>
        )}

        <div style={card}>
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend
              style={{ fontWeight: 600, fontSize: 16, color: t.text, marginBottom: 12, float: "left", width: "100%" }}
            >
              {plain ? "Alert style" : "Notification style"}
            </legend>
            <div style={{ clear: "both" }}>
              {NOTIF_TIERS.map(({ value, id, label, labelPlain, desc, descPlain }) => (
                <div key={value} style={{ marginBottom: 8 }}>
                  {/* Entire row is the touch target. */}
                  <label
                    htmlFor={id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: 44,
                      cursor: loading ? "default" : "pointer",
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
                      disabled={loading}
                      aria-describedby={`${id}-desc`}
                      onChange={() => changeTier(value)}
                      style={{ accentColor: t.accentStrong, width: 18, height: 18, flexShrink: 0 }}
                    />
                    <span>{plain ? labelPlain : label}</span>
                  </label>
                  <span
                    id={`${id}-desc`}
                    style={{ display: "block", fontSize: 14, color: t.textSoft, marginLeft: 30, marginBottom: 4 }}
                  >
                    {plain ? descPlain : desc}
                  </span>
                </div>
              ))}
            </div>
            {/* Honesty note: the tiers govern the TEXT a push shows, not whether
                the device makes a sound or vibrates. "Silent" can read as "no
                sound," which would be misleading — name where that actually
                lives. Copy-only; no new controls. */}
            <p style={{ margin: "12px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
              {plain
                ? "Sound and vibration are set on your phone, not here."
                : "Sound and vibration are controlled by your device's notification settings, not here."}
            </p>
          </fieldset>

          {/* Calm, low-key save state — polite live region, no toast. */}
          <div role="status" aria-live="polite" aria-atomic="true" style={{ minHeight: 20, marginTop: 4 }}>
            {saveState === "saving" && (
              <span style={{ fontSize: 14, color: t.textSoft }}>Saving…</span>
            )}
            {saveState === "saved" && (
              <span style={{ fontSize: 14, color: t.textSoft }}>
                <span aria-hidden="true">✓</span> Saved.
              </span>
            )}
            {saveState === "error" && (
              <span role="alert" style={{ fontSize: 14, color: t.danger }}>
                {plain ? "Could not save. Please try again." : "Couldn't save that just now. Please try again."}
              </span>
            )}
          </div>

          {loadError && (
            <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, color: t.danger }}>
              {loadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
