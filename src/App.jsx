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
import { isLoggedIn, clearAuth, getToken, signOut, getProfile, getPushVapidKey, savePushSubscription, removePushSubscription, verifyEmail, resendVerification } from "./api.js";
import { t } from "./tokens.js";
import { useViewport } from "./useViewport.js";
import AnimatedSpectrumMark from "./AnimatedSpectrumMark.jsx";
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
  if (prefs.calmMode) style.background = t.bg;
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
  const [activeTab, setActiveTab] = useState("suggestions");
  const [prevTab, setPrevTab] = useState("suggestions");

  // Title the SPA on every screen change so the page is properly titled (S4).
  useEffect(() => {
    const name = SCREEN_NAMES[activeTab] || "Spectrum";
    document.title = `${name} · Spectrum`;
  }, [activeTab]);
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

  // Handle ?reset=TOKEN URL param — show the reset-password screen.
  const [resetToken, setResetToken] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("reset"); }
    catch { return null; }
  });

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

    socket.on("new_message", () => {
      if (activeTabRef.current !== "messages") {
        setUnreadCount(prev => prev + 1);
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
            <LandingScreen
              onGetStarted={() => { setAuthMode("register"); setShowAuth(true); }}
              onSignIn={() => { setAuthMode("login"); setShowAuth(true); }}
            />
          )
        : onboarding
        ? <OnboardingScreen onComplete={() => setOnboarding(false)} />
        : (
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              background: t.bg,
              fontFamily: t.sans,
              color: t.text,
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
                    <AnimatedSpectrumMark height={14} />
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

                {/* Top tab bar — tablet/desktop only. On mobile the primary
                    nav moves to a fixed bottom bar (rendered below). The 4
                    destinations are identical for every user; Moderation lives
                    inside Profile now (not a peer tab). */}
                {!isMobile && (
                  <nav
                    aria-label="Primary"
                    style={{
                      display: "flex",
                      borderBottom: `1px solid ${t.border}`,
                      marginBottom: -1,
                    }}
                  >
                    <NavTab
                      label="Discover"
                      active={activeTab === "suggestions"}
                      onClick={() => { setPrevTab(activeTab); setActiveTab("suggestions"); }}
                    />
                    <NavTab
                      label="Matches"
                      active={activeTab === "matches"}
                      onClick={() => { setPrevTab(activeTab); setActiveTab("matches"); }}
                    />
                    <NavTab
                      label="Messages"
                      active={activeTab === "messages"}
                      onClick={() => { setPrevTab(activeTab); setPendingConversationId(null); setActiveTab("messages"); setUnreadCount(0); }}
                      badgeCount={activeTab === "messages" ? 0 : unreadCount}
                    />
                    <NavTab
                      label="Profile"
                      active={activeTab === "profile"}
                      onClick={() => { setPrevTab(activeTab); setActiveTab("profile"); }}
                    />
                    {isAdmin && (
                      <NavTab
                        label="Moderation"
                        active={activeTab === "admin"}
                        onClick={() => { setPrevTab(activeTab); setActiveTab("admin"); }}
                      />
                    )}
                  </nav>
                )}
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
                // Mobile: full-bleed; clear the fixed bottom nav bar.
                // Tablet/desktop: sit the content column inside a surface
                // "panel" on the gradient — reads as an app, not a strip.
                ...(isMobile
                  ? { paddingBottom: 64 }
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
                  onGoToProfile={() => setActiveTab("profile")}
                />
              )}
              {activeTab === "matches" && (
                <MatchesScreen
                  onOpenConversation={(conversationId) => {
                    setPendingConversationId(conversationId);
                    setPrevTab("matches");
                    setActiveTab("messages");
                    setUnreadCount(0);
                  }}
                />
              )}
              {activeTab === "messages" && (
                <MessagingApp
                  onUnreadCount={setUnreadCount}
                  initialConversationId={pendingConversationId}
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

            {/* Mobile: fixed bottom tab bar — the primary nav. Same 4
                destinations, same order, for every user. Safety/Settings stay
                as the top-right header links above; Moderation lives in Profile. */}
            {isMobile && (
              <nav
                aria-label="Primary"
                style={{
                  position: "fixed",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  display: "flex",
                  background: t.surface,
                  borderTop: `1px solid ${t.border}`,
                  paddingBottom: "env(safe-area-inset-bottom)",
                  zIndex: 50,
                }}
              >
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
                  onClick={() => { setPrevTab(activeTab); setActiveTab("matches"); }}
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
              </nav>
            )}
          </div>
        )
      }
      </>
      )}
    </>
  );
}
