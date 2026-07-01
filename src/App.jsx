import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import SuggestionScreen from "./SuggestionScreen.jsx";
import MessagingApp from "./messaging/MessagingApp.jsx";
import ProfileScreen from "./ProfileScreen.jsx";
import MatchesScreen from "./MatchesScreen.jsx";
import SafetyScreen from "./SafetyScreen.jsx";
import SettingsScreen, { readA11y } from "./SettingsScreen.jsx";
import AdminScreen from "./AdminScreen.jsx";
import AuthScreen from "./AuthScreen.jsx";
import LandingScreen from "./LandingScreen.jsx";
import OnboardingScreen from "./OnboardingScreen.jsx";
import ResetPasswordScreen from "./ResetPasswordScreen.jsx";
import { isLoggedIn, clearAuth, getToken, getUserId, signOut, getProfile, getPushVapidKey, savePushSubscription, removePushSubscription, verifyEmail, resendVerification } from "./api.js";
import { t } from "./tokens.js";
import { useViewport } from "./useViewport.js";
import AnimatedSpectrumMark from "./AnimatedSpectrumMark.jsx";
import SpectrumMark from "./SpectrumMark.jsx";
import { ShieldIcon, GearIcon, HeartIcon } from "./icons.jsx";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
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

// Human-readable screen names — drive document.title + the SR announcement so
// SPA tab changes are titled and announced (S4).
const SCREEN_NAMES = {
  suggestions: "Discover",
  matches: "Matches",
  messages: "Messages",
  profile: "Profile",
  admin: "Moderation",
  safety: "Safety Center",
  settings: "Settings",
};

// Skip-to-content link — the first focusable element. Visibility is handled by
// the `.skip-link` CSS class (off-screen until :focus), so it's robust to React
// state timing. Jumps focus to <main id="main-content"> past the header + nav.
function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(e) => {
        const main = document.getElementById("main-content");
        if (main) { e.preventDefault(); main.focus(); main.scrollIntoView(); }
      }}
    >
      Skip to content
    </a>
  );
}

function NavTab({ label, active, onClick, badgeCount }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 44,
        padding: "12px 8px",
        background: "transparent",
        border: "none",
        borderBottom: active ? `2px solid ${t.accent}` : "2px solid transparent",
        color: active ? t.accentStrong : t.textMuted,
        fontSize: 15,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        position: "relative",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {label}
      {badgeCount > 0 && (
        <span
          aria-label={`${badgeCount} unread`}
          style={{
            background: t.accentFill,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 10,
            padding: "2px 6px",
            lineHeight: 1,
          }}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
}

// ─── Mobile bottom-nav icons ──────────────────────────────────────────────────
// Tiny inline glyphs (1.6px stroke, currentColor) for the 4 primary mobile tabs.
// HeartIcon (from icons.jsx) is reused for Matches; the rest are local so the
// bottom bar reads as a consistent icon+label set.
function NavGlyph({ children }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      focusable="false" style={{ display: "block" }}>
      {children}
    </svg>
  );
}
const DiscoverGlyph = () => <NavGlyph><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></NavGlyph>;
const MessagesGlyph = () => <NavGlyph><path d="M4 5h16v11H9l-4 3v-3H4z" /></NavGlyph>;
const ProfileGlyph = () => <NavGlyph><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" /></NavGlyph>;
const ModerationGlyph = () => <NavGlyph><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></NavGlyph>;

// Fixed bottom tab bar (mobile only). 4 items, each ≥44px, icon + label.
// Plain nav buttons with aria-current="page" on the active item + focus rings.
function BottomNavTab({ label, icon, active, onClick, badgeCount }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 44,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        padding: "6px 4px",
        background: "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        color: active ? t.accentStrong : t.textMuted,
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        position: "relative",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <span style={{ position: "relative", display: "inline-flex" }}>
        {icon}
        {badgeCount > 0 && (
          <span
            aria-label={`${badgeCount} unread`}
            style={{
              position: "absolute",
              top: -4,
              right: -8,
              background: t.accentFill,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 10,
              padding: "1px 5px",
              lineHeight: 1.3,
            }}
          >
            {badgeCount}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

function SafetyLink({ active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Safety Center"
      aria-current={active ? "page" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        padding: "6px 12px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
        color: active ? t.accent : t.textSoft,
        borderRadius: 8,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <ShieldIcon size={16} /> Safety
    </button>
  );
}

function SettingsLink({ active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Accessibility settings"
      aria-current={active ? "page" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        padding: "6px 12px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
        color: active ? t.accent : t.textSoft,
        borderRadius: 8,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <GearIcon size={16} /> Settings
    </button>
  );
}

// ─── Global accessibility prefs application (low-risk, no token refactor) ──────
// Reduce-motion / calm inject a single <style id="a11y-overrides"> stylesheet.
// High-contrast / larger-text / calm-background are applied as inline style
// overrides on the top-level app container (returned by a11yWrapperStyle).

const A11Y_STYLE_ID = "a11y-overrides";

const REDUCE_MOTION_CSS = `*, *::before, *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}`;

function applyA11yStylesheet(prefs) {
  if (typeof document === "undefined") return;
  const wantReduceMotion = !!(prefs.reduceMotion || prefs.calmMode);
  let el = document.getElementById(A11Y_STYLE_ID);
  if (!wantReduceMotion) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = A11Y_STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== REDUCE_MOTION_CSS) el.textContent = REDUCE_MOTION_CSS;
}

// Apply the warm-dim theme by toggling <html data-theme>. The CSS variables
// defined in index.html for [data-theme="dim"] then cascade to every token.
// '' (empty) falls back to the default light :root values. The high-contrast /
// larger-text / calm overrides layer on top of whichever theme is active.
function applyTheme(prefs) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = prefs.theme === "dim" ? "dim" : "";
}

// Inline style overrides for the top-level app container based on prefs.
// - high contrast: a root `filter` (global + safe).
// - larger text: `zoom` enlarges everything proportionally (px inline styles
//   won't scale via root font-size). Fixed-position sheets/dialogs render
//   relative to the zoomed container, so this stays visually consistent.
// - calm mode: flatten the page background to t.bg (drop decorative gradient).
function a11yWrapperStyle(prefs) {
  const style = {};
  if (prefs.highContrast) style.filter = "contrast(1.15)";
  if (prefs.largerText) style.zoom = 1.15;
  if (prefs.calmMode || prefs.reducedSensory) style.background = t.bg;
  return style;
}

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

function VerifyResultBanner({ result, onDismiss }) {
  const f = useFocusable();
  const isSuccess = result === "success";
  // Themed so the banners adapt to the dim theme and keep AA contrast.
  const bg = isSuccess ? t.green50 : t.surfaceAlt;
  const borderColor = isSuccess ? t.positive : t.danger;
  const textColor = t.text;
  const message = isSuccess
    ? "✓ Your email is verified. Thank you!"
    : "This verification link is invalid or expired. You can request a new one from your profile.";
  return (
    <div
      role="status"
      style={{
        background: bg,
        borderBottom: `1px solid ${borderColor}`,
        padding: "12px 20px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: t.layout.maxContent,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 14,
          color: textColor,
        }}
      >
        <span style={{ flex: 1 }}>{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          {...f}
          style={{
            background: "none",
            border: "none",
            color: textColor,
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
            ...f.style,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function VerifyEmailBanner({ onDismiss }) {
  const [status, setStatus] = useState("idle"); // 'idle' | 'sending' | 'sent' | 'error'
  const fResend = useFocusable();
  const fDismiss = useFocusable();

  async function handleResend() {
    setStatus("sending");
    try {
      await resendVerification();
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div
      role="status"
      style={{
        background: t.sand,
        borderBottom: `1px solid ${t.warning}`,
        padding: "12px 20px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: t.layout.maxContent,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 14,
          color: t.text,
        }}
      >
        <span style={{ flex: 1 }}>
          {status === "sent"
            ? "Sent — check your inbox."
            : status === "error"
            ? "Couldn't resend right now. Please try again."
            : "Please verify your email. Check your inbox for a link."}
        </span>
        {status !== "sent" && (
          <button
            type="button"
            onClick={handleResend}
            disabled={status === "sending"}
            {...fResend}
            style={{
              background: "none",
              border: `1px solid ${t.warning}`,
              color: t.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: status === "sending" ? "not-allowed" : "pointer",
              padding: "6px 12px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              ...fResend.style,
            }}
          >
            {status === "sending" ? "Sending…" : "Resend"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          {...fDismiss}
          style={{
            background: "none",
            border: "none",
            color: t.text,
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
            ...fDismiss.style,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Inactivity warning banner (WCAG 2.2.1) ───────────────────────────────────
// Fixed top banner shown when the user has been idle. Appears before the abrupt
// 401 logout so the user can extend their session.
function InactivityWarningBanner({ secondsLeft, onStillHere, btnRef }) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = mins > 0
    ? `${mins}:${String(secs).padStart(2, "0")}`
    : `${secs} sec${secs !== 1 ? "s" : ""}`;

  function handleKey(e) {
    if (e.key === "Escape") onStillHere();
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="inactivity-heading"
      aria-describedby="inactivity-desc"
      onKeyDown={handleKey}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        zIndex: 200,
        background: t.surface,
        borderBottom: `3px solid ${t.accentFill}`,
        boxShadow: "0 4px 20px rgba(36,51,45,0.18)",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <p id="inactivity-heading" style={{ margin: 0, fontWeight: 700, color: t.text, fontSize: 15 }}>
          Still here?
        </p>
        <p id="inactivity-desc" style={{ margin: "3px 0 0", color: t.textSoft, fontSize: 14 }}>
          You'll be signed out in{" "}
          <strong style={{ color: t.text, fontVariantNumeric: "tabular-nums" }}>{timeStr}</strong>
          {" "}due to inactivity.
        </p>
      </div>
      <button
        ref={btnRef}
        type="button"
        onClick={onStillHere}
        style={{
          minHeight: 44,
          padding: "10px 20px",
          borderRadius: 11,
          border: "none",
          background: t.accentFill,
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        I'm still here
      </button>
    </div>
  );
}

export default function App() {
  const viewport = useViewport(); // "mobile" | "tablet" | "desktop"
  const isMobile = viewport === "mobile";
  const [authed, setAuthed] = useState(() => isLoggedIn());
  const [authMessage, setAuthMessage] = useState("");
  // Unauthenticated flow: a new visitor sees the marketing LandingScreen first.
  // Choosing an action reveals AuthScreen in the matching mode; "← Back"
  // returns to the landing page. Returning users with a stored token skip
  // straight past both (the `authed` branch wins below).
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [onboarding, setOnboarding] = useState(false);
  // 'suggestions' | 'matches' | 'messages' | 'profile' | 'admin' | 'safety' | 'settings'
  // Honor a ?tab= deep-link / refresh on cold load. Without this the tab always
  // initialized to "suggestions" and the sync effect below rewrote the URL,
  // so bookmarks, shared links, and refresh-mid-flow all dumped you on Discover.
  // 'admin' is intentionally NOT cold-bootable from the URL — admin status is
  // fetched async, so a crafted ?tab=admin falls back to Discover rather than
  // flashing a gated screen. In-app nav to admin still works for admins.
  const initialTab = (() => {
    try {
      const tab = new URLSearchParams(window.location.search).get("tab");
      const allowed = ["suggestions", "matches", "messages", "profile", "safety", "settings"];
      return allowed.includes(tab) ? tab : "suggestions";
    } catch { return "suggestions"; }
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [prevTab, setPrevTab] = useState(initialTab);

  // ?reset=TOKEN → show the reset-password screen (declared here so the title
  // effect below can account for it).
  const [resetToken, setResetToken] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("reset"); }
    catch { return null; }
  });

  // Title the SPA on every screen change so the page is properly titled across
  // ALL views, not just the authed tabs (S4 — fixes "Discover" on the landing page).
  useEffect(() => {
    let title;
    if (resetToken) {
      title = "Reset password · Spectrum";
    } else if (!authed) {
      title = showAuth
        ? `${authMode === "register" ? "Create account" : "Sign in"} · Spectrum`
        : "Spectrum — Dating at your own pace";
    } else if (onboarding) {
      title = "Set up your profile · Spectrum";
    } else {
      title = `${SCREEN_NAMES[activeTab] || "Spectrum"} · Spectrum`;
    }
    document.title = title;
  }, [resetToken, authed, showAuth, authMode, onboarding, activeTab]);

  // ── Client-side routing for the authed tabs ──────────────────────────────────
  // Sync activeTab <-> the URL (?tab=) so the browser Back/Forward buttons move
  // between tabs instead of leaving the app or resetting to Discover.
  const navFromPop = useRef(false);
  useEffect(() => {
    if (!authed || onboarding || resetToken) return;
    if (navFromPop.current) { navFromPop.current = false; return; }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== activeTab) {
        url.searchParams.set("tab", activeTab);
        window.history.pushState({ tab: activeTab }, "", url);
      }
    } catch { /* no-op */ }
  }, [activeTab, authed, onboarding, resetToken]);
  useEffect(() => {
    const onPop = () => {
      let tab = null;
      try { tab = new URLSearchParams(window.location.search).get("tab"); } catch { /* no-op */ }
      if (tab && tab !== activeTab) {
        navFromPop.current = true; // don't push a new entry for this change
        setActiveTab(tab);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeTab]);

  // Offline awareness — a calm banner when the connection drops.
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // When opening a chat from the Matches tab, this tells MessagingApp which
  // conversation to open on mount.
  const [pendingConversationId, setPendingConversationId] = useState(null);

  // Email verification state
  const [verifyResult, setVerifyResult] = useState(null); // null | 'success' | 'error'
  const [emailVerified, setEmailVerified] = useState(true); // default true so banner hidden until we know
  const [emailVerifyEnabled, setEmailVerifyEnabled] = useState(false);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);

  // Admin / moderation access
  const [isAdmin, setIsAdmin] = useState(false);

  // Accessibility prefs (frontend-only, persisted in localStorage). Read once on
  // mount; applied globally via the effect below + inline wrapper styles.
  const [a11y, setA11y] = useState(() => readA11y());

  // applyA11y — updates state + localStorage + re-applies the global stylesheet.
  // Passed to SettingsScreen as onChange so toggles apply live.
  const applyA11y = useCallback((prefs) => {
    setA11y(prefs);
    try {
      localStorage.setItem("spectrum_a11y", JSON.stringify(prefs));
    } catch {
      // localStorage may be unavailable (private mode); state still applies live.
    }
    applyA11yStylesheet(prefs);
    applyTheme(prefs);
  }, []);

  // Inject/remove the reduce-motion stylesheet + apply the theme whenever the
  // relevant prefs change (covers initial mount too).
  useEffect(() => {
    applyA11yStylesheet(a11y);
    applyTheme(a11y);
  }, [a11y]);

  // Handle ?verify=TOKEN URL param on mount — verify regardless of auth state
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verify");
    if (!token) return;
    verifyEmail(token)
      .then(() => {
        setVerifyResult("success");
        setEmailVerified(true);
      })
      .catch(() => setVerifyResult("error"))
      .finally(() => {
        // Clean the URL so refresh doesn't re-trigger
        window.history.replaceState({}, "", window.location.pathname);
      });
  }, []);

  // Capture verification fields from an auth (login/register) response
  const handleAuthed = useCallback((data) => {
    setAuthMessage("");
    if (data && typeof data === "object") {
      if (typeof data.emailVerified === "boolean") setEmailVerified(data.emailVerified);
      if (typeof data.emailVerificationEnabled === "boolean") setEmailVerifyEnabled(data.emailVerificationEnabled);
      if (typeof data.isAdmin === "boolean") setIsAdmin(data.isAdmin);
    }
    setAuthed(true);
  }, []);

  // ── Inactivity warning (WCAG 2.2.1) ─────────────────────────────────────────
  // After INACTIVITY_WARN_MS of no user input, show the banner + start a
  // INACTIVITY_GRACE_S countdown. If the user doesn't respond, dispatch
  // auth:expired ourselves (graceful logout). Any activity resets the timer
  // (only while the warning is NOT showing — we don't want mouse moves to
  // dismiss a mid-countdown banner silently).
  const INACTIVITY_WARN_MS = 20 * 60 * 1000; // 20 min
  const INACTIVITY_GRACE_S = 120;             // 2-min countdown

  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [inactivitySecondsLeft, setInactivitySecondsLeft] = useState(INACTIVITY_GRACE_S);
  const inactivityTimerRef   = useRef(null);
  const countdownIntervalRef = useRef(null);
  const warningActiveRef     = useRef(false);
  const scheduleWarningRef   = useRef(null);
  const stillHereBtnRef      = useRef(null);

  useEffect(() => {
    if (!authed) {
      clearTimeout(inactivityTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      warningActiveRef.current = false;
      setShowInactivityWarning(false);
      return;
    }

    function startWarningCountdown() {
      warningActiveRef.current = true;
      setShowInactivityWarning(true);
      setInactivitySecondsLeft(INACTIVITY_GRACE_S);
      requestAnimationFrame(() => stillHereBtnRef.current?.focus());

      clearInterval(countdownIntervalRef.current);
      let s = INACTIVITY_GRACE_S;
      countdownIntervalRef.current = setInterval(() => {
        s -= 1;
        setInactivitySecondsLeft(s);
        if (s <= 0) {
          clearInterval(countdownIntervalRef.current);
          warningActiveRef.current = false;
          setShowInactivityWarning(false);
          window.dispatchEvent(new Event("auth:expired"));
        }
      }, 1000);
    }

    function scheduleWarning() {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(startWarningCountdown, INACTIVITY_WARN_MS);
    }
    scheduleWarningRef.current = scheduleWarning;

    function onActivity() {
      if (!warningActiveRef.current) scheduleWarning();
    }

    scheduleWarning();
    const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    return () => {
      clearTimeout(inactivityTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
    };
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStillHere() {
    clearInterval(countdownIntervalRef.current);
    warningActiveRef.current = false;
    setShowInactivityWarning(false);
    setInactivitySecondsLeft(INACTIVITY_GRACE_S);
    scheduleWarningRef.current?.();
  }

  // Listen for token expiry from api.js — auto-logout on 401
  useEffect(() => {
    function handleExpired() {
      setAuthMessage("Your session has expired. Please sign in again.");
      setAuthed(false);
      setOnboarding(false);
      setIsAdmin(false);
      // Send the user straight to the sign-in form (not the marketing page) so
      // the expiry message has context.
      setAuthMode("login");
      setShowAuth(true);
    }
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, []);

  // Check onboarding status whenever auth state becomes true
  useEffect(() => {
    if (!authed) return;
    getProfile()
      .then((p) => {
        if (!p.onboardingComplete) setOnboarding(true);
        // Persist email verification state across reloads
        if (typeof p.emailVerified === "boolean") setEmailVerified(p.emailVerified);
        if (typeof p.emailVerificationEnabled === "boolean") setEmailVerifyEnabled(p.emailVerificationEnabled);
        if (typeof p.isAdmin === "boolean") setIsAdmin(p.isAdmin);
      })
      .catch(() => {
        // Silently fail — if we can't load the profile here, let the main app
        // handle it; don't block auth behind a network error.
      });
  }, [authed]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setAuthMessage("You have been signed out.");
    setAuthed(false);
    setOnboarding(false);
    setUnreadCount(0);
    setActivityCount(0);
    setIsAdmin(false);
    setShowAuth(false); // back to the landing page
    if (activeTab === "admin") setActiveTab("suggestions");
  }, [activeTab]);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  // Register service worker + check current push subscription
  useEffect(() => {
    if (!authed) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setPushSupported(true);

    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setPushEnabled(!!sub);
      });
    }).catch(() => {});
  }, [authed]);

  const enablePush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await getPushVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await savePushSubscription(sub);
      setPushEnabled(true);
    } catch (e) {
      console.error('Push subscribe failed:', e);
    }
  }, []);

  const disablePush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushEnabled(false);
    } catch (e) {
      console.error('Push unsubscribe failed:', e);
    }
  }, []);

  // Unread count — driven by live conversations list via onUnreadCount callback from MessagingApp
  const [unreadCount, setUnreadCount] = useState(0);
  // Activity count — incoming likes from the activity inbox (drives the Matches tab badge)
  const [activityCount, setActivityCount] = useState(0);

  // Ref so the socket effect can read the current tab without a stale closure
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // App-level socket connection — increments badge for new messages on non-active tabs
  useEffect(() => {
    if (!authed) return;
    const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");
    const token = getToken();
    if (!token || !BASE_URL) return;

    const socket = io(BASE_URL, {
      auth: { token },
      transports: ["websocket"],
    });

    socket.on("new_message", (payload) => {
      // Don't count the user's own sent messages — the badge tracks messages
      // *received* while away from the Messages tab.
      if (payload?.message?.senderId === getUserId()) return;
      if (activeTabRef.current !== "messages") {
        setUnreadCount(prev => prev + 1);
      }
    });

    // Realtime new-match signal — bump the Matches tab activity badge when a
    // mutual match lands while the user is elsewhere. Mirrors new_message.
    socket.on("new_match", () => {
      if (activeTabRef.current !== "matches") {
        setActivityCount(prev => prev + 1);
      }
    });

    socket.on("connect_error", () => {
      // Silent — badge just won't update in real-time; no UX impact
    });

    return () => socket.disconnect();
  }, [authed]);

  return (
    <>
      <div role="status" aria-live="assertive" aria-atomic="true" style={srOnly}>
        {authMessage}
      </div>
      {isOffline && (
        <div
          role="status"
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
            background: t.surfaceAlt, borderBottom: `2px solid ${t.warning}`,
            color: t.text, textAlign: "center", padding: "8px 16px",
            fontSize: 14, fontWeight: 600,
          }}
        >
          You're offline — we'll reconnect automatically.
        </div>
      )}
      {authed && showInactivityWarning && (
        <InactivityWarningBanner
          secondsLeft={inactivitySecondsLeft}
          onStillHere={handleStillHere}
          btnRef={stillHereBtnRef}
        />
      )}
      {resetToken ? (
        <ResetPasswordScreen
          token={resetToken}
          onDone={() => {
            setResetToken(null);
            window.history.replaceState({}, "", window.location.pathname);
            setAuthMode("login");
            setShowAuth(true);
          }}
        />
      ) : (
      <>
      {verifyResult && (
        <VerifyResultBanner result={verifyResult} onDismiss={() => setVerifyResult(null)} />
      )}
      {!authed
        ? showAuth
          ? (
            <AuthScreen
              onAuth={handleAuthed}
              initialMode={authMode}
              onBack={() => setShowAuth(false)}
            />
          )
          : (
            <>
              <SkipLink />
              <LandingScreen
                onGetStarted={() => { setAuthMode("register"); setShowAuth(true); }}
                onSignIn={() => { setAuthMode("login"); setShowAuth(true); }}
              />
            </>
          )
        : onboarding
        ? <OnboardingScreen onComplete={() => setOnboarding(false)} />
        : (
          <>
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              background: t.bg,
              fontFamily: t.sans,
              color: t.text,
              // Reserve space so content always clears the fixed bottom nav bar.
              paddingBottom: "calc(56px + env(safe-area-inset-bottom))",
              ...a11yWrapperStyle(a11y),
            }}
          >
            <SkipLink />
            {/* Announces the current screen to screen readers on tab change (S4). */}
            <div aria-live="polite" style={srOnly}>{SCREEN_NAMES[activeTab]}</div>
            {emailVerifyEnabled && !emailVerified && !verifyBannerDismissed && (
              <VerifyEmailBanner onDismiss={() => setVerifyBannerDismissed(true)} />
            )}
            {/* App-level header / wordmark */}
            <header
              style={{
                background: t.surface,
                borderBottom: `1px solid ${t.border}`,
                padding: "14px 20px 0",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  maxWidth: t.layout.maxContent,
                  margin: "0 auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a11y.reducedSensory
                      ? <SpectrumMark height={14} />
                      : <AnimatedSpectrumMark height={14} />}
                    <div
                      style={{
                        fontFamily: t.serif,
                        fontWeight: 700,
                        fontSize: 19,
                        letterSpacing: "-0.01em",
                        color: t.text,
                      }}
                    >
                      Spectrum
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <SafetyLink
                      active={activeTab === "safety"}
                      onClick={() => {
                        if (activeTab !== "safety") setPrevTab(activeTab);
                        setActiveTab("safety");
                      }}
                    />
                    <SettingsLink
                      active={activeTab === "settings"}
                      onClick={() => {
                        if (activeTab !== "settings") setPrevTab(activeTab);
                        setActiveTab("settings");
                      }}
                    />
                  </div>
                </div>

                {/* Primary nav is a single FIXED BOTTOM bar on every viewport
                    (rendered as a sibling of this wrapper, below) so it's always
                    pinned to the bottom of the screen regardless of scroll. */}
              </div>
            </header>

            {/* Main content — grows to fill viewport. id + tabIndex make it the
                target of the skip link and a focus destination on tab change. */}
            <main
              id="main-content"
              tabIndex={-1}
              aria-label={
                activeTab === "suggestions" ? "Discover" :
                activeTab === "matches" ? "Matches" :
                activeTab === "messages" ? "Messages" :
                activeTab === "admin" ? "Moderation" :
                activeTab === "safety" ? "Safety Center" :
                activeTab === "settings" ? "Accessibility settings" : "Profile"
              }
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: activeTab === "messages" ? "hidden" : "auto",
                // Mobile: full-bleed (the wrapper reserves bottom-bar space).
                // Tablet/desktop: sit the content column inside a surface
                // "panel" on the gradient — reads as an app, not a strip.
                ...(isMobile
                  ? {}
                  : {
                      background: t.surface,
                      border: `1px solid ${t.border}`,
                      borderRadius: 16,
                      margin: "24px auto",
                      width: "calc(100% - 48px)",
                      // Messages on desktop hosts a 2-pane layout (list + thread)
                      // so its panel is wider; every other screen caps at the
                      // single content column.
                      maxWidth:
                        viewport === "desktop" && activeTab === "messages"
                          ? 1080
                          : t.layout.maxContent + 48,
                    }),
              }}
            >
              {activeTab === "suggestions" && (
                <SuggestionScreen
                  onOpenMessages={() => setActiveTab("messages")}
                  onOpenConversation={(conversationId) => {
                    setPendingConversationId(conversationId);
                    setPrevTab("suggestions");
                    setActiveTab("messages");
                    setUnreadCount(0);
                  }}
                  onGoToProfile={() => setActiveTab("profile")}
                  plainLanguage={!!a11y.plainLanguage}
                  reducedSensory={!!a11y.reducedSensory}
                />
              )}
              {activeTab === "matches" && (
                <MatchesScreen
                  onGoDiscover={() => { setPrevTab("matches"); setActiveTab("suggestions"); }}
                  onActivityCount={(n) => setActivityCount(n)}
                  onOpenConversation={(conversationId) => {
                    setPendingConversationId(conversationId);
                    setPrevTab("matches");
                    setActiveTab("messages");
                    setUnreadCount(0);
                  }}
                  plainLanguage={!!a11y.plainLanguage}
                  reducedSensory={!!a11y.reducedSensory}
                />
              )}
              {activeTab === "messages" && (
                <MessagingApp
                  onUnreadCount={setUnreadCount}
                  initialConversationId={pendingConversationId}
                  plainLanguage={!!a11y.plainLanguage}
                />
              )}
              {activeTab === "profile" && (
                <ProfileScreen
                  onDone={() => setActiveTab(prevTab || "suggestions")}
                  onSignOut={handleSignOut}
                  onAccountDeleted={() => {
                    setAuthMessage("Your account has been deleted.");
                    setAuthed(false);
                    setOnboarding(false);
                    setUnreadCount(0);
                    setIsAdmin(false);
                    setShowAuth(false); // back to the landing page
                  }}
                  pushEnabled={pushEnabled}
                  pushSupported={pushSupported}
                  onEnablePush={enablePush}
                  onDisablePush={disablePush}
                />
              )}
              {activeTab === "admin" && isAdmin && <AdminScreen />}
              {activeTab === "safety" && (
                <SafetyScreen onBack={() => setActiveTab(prevTab || "suggestions")} />
              )}
              {activeTab === "settings" && (
                <SettingsScreen
                  onBack={() => setActiveTab(prevTab || "suggestions")}
                  onChange={applyA11y}
                />
              )}
            </main>

          </div>

          {/* Primary nav — a single FIXED BOTTOM bar on EVERY viewport, rendered
              OUTSIDE the a11y wrapper so its filter/zoom can never break
              position:fixed. Always pinned to the bottom, regardless of scroll.
              On wide screens the tabs are centered within the content width. */}
          <nav
            aria-label="Primary"
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              background: t.surface,
              borderTop: `1px solid ${t.border}`,
              paddingBottom: "env(safe-area-inset-bottom)",
              zIndex: 50,
            }}
          >
            <div style={{ display: "flex", width: "100%", maxWidth: t.layout.maxContent, margin: "0 auto" }}>
              <BottomNavTab
                label="Discover"
                icon={<DiscoverGlyph />}
                active={activeTab === "suggestions"}
                onClick={() => { setPrevTab(activeTab); setActiveTab("suggestions"); }}
              />
              <BottomNavTab
                label="Matches"
                icon={<HeartIcon size={22} />}
                active={activeTab === "matches"}
                onClick={() => { setPrevTab(activeTab); setActiveTab("matches"); setActivityCount(0); }}
                badgeCount={activeTab === "matches" ? 0 : activityCount}
              />
              <BottomNavTab
                label="Messages"
                icon={<MessagesGlyph />}
                active={activeTab === "messages"}
                onClick={() => { setPrevTab(activeTab); setPendingConversationId(null); setActiveTab("messages"); setUnreadCount(0); }}
                badgeCount={activeTab === "messages" ? 0 : unreadCount}
              />
              <BottomNavTab
                label="Profile"
                icon={<ProfileGlyph />}
                active={activeTab === "profile"}
                onClick={() => { setPrevTab(activeTab); setActiveTab("profile"); }}
              />
              {isAdmin && (
                <BottomNavTab
                  label="Moderation"
                  icon={<ModerationGlyph />}
                  active={activeTab === "admin"}
                  onClick={() => { setPrevTab(activeTab); setActiveTab("admin"); }}
                />
              )}
            </div>
          </nav>
          </>
        )
      }
      </>
      )}
    </>
  );
}
