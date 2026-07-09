import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
// socket.io-client is loaded lazily (dynamic import inside the authed socket
// effect) so it stays off the logged-out critical path — see the socket effect.
import Avatar from "./Avatar.jsx";
import AuthScreen from "./AuthScreen.jsx";
import ResetPasswordScreen from "./ResetPasswordScreen.jsx";
import Skeleton from "./Skeleton.jsx";
import { readA11y, IDENTITY_THEMES } from "./a11yPrefs.js";
import { PlainLanguageProvider } from "./PlainLanguageContext.jsx";
import { computeCompleteness } from "./completeness.js";

// ── Code-split screens ──────────────────────────────────────────────────────
// Screens that are never the FIRST PAINT are lazy-loaded so they ship in their
// own chunk instead of the main bundle — a logged-out visitor should not have to
// download the whole authed app (B6). SuggestionScreen (Discover), MessagingApp,
// and LikesScreen are all behind auth + a tab switch, and each is already
// rendered inside a <Suspense fallback={<ScreenFallback/>}> boundary below, so
// lazy() just works. lazy() calls live at module scope (never inside a component).
const SuggestionScreen = lazy(() => import("./SuggestionScreen.jsx"));
const MessagingApp = lazy(() => import("./messaging/MessagingApp.jsx"));
const LikesScreen = lazy(() => import("./LikesScreen.jsx"));
const ProfileScreen = lazy(() => import("./ProfileScreen.jsx"));
const ProfileHub = lazy(() => import("./ProfileHub.jsx"));
const SafetyScreen = lazy(() => import("./SafetyScreen.jsx"));
const SettingsScreen = lazy(() => import("./SettingsScreen.jsx"));
const AccountSecurityScreen = lazy(() => import("./AccountSecurityScreen.jsx"));
const NotificationsScreen = lazy(() => import("./NotificationsScreen.jsx"));
const AdminScreen = lazy(() => import("./AdminScreen.jsx"));
const MembershipScreen = lazy(() => import("./MembershipScreen.jsx"));
const BestFits = lazy(() => import("./BestFits.jsx"));
const LandingScreen = lazy(() => import("./LandingScreen.jsx"));
const OnboardingScreen = lazy(() => import("./OnboardingScreen.jsx"));
const RequireCityScreen = lazy(() => import("./RequireCityScreen.jsx"));
const TermsScreen = lazy(() => import("./TermsScreen.jsx"));
import { isLoggedIn, clearAuth, getToken, getUserId, signOut, getProfile, getPushVapidKey, savePushSubscription, removePushSubscription, verifyEmail, resendVerification, sendPageview, getRegionSafety, updateProfile } from "./api.js";
import { shouldShowRegionAlert, REGION_ALERT_SESSION_KEY, shouldShowTransAlert, TRANS_ALERT_SESSION_KEY } from "./regionSafety.js";
import { connectSocket, disconnectSocket, onSocket } from "./socketClient.js";
import { t } from "./tokens.js";
import { useViewport } from "./useViewport.js";
import AnimatedSpectrumMark from "./AnimatedSpectrumMark.jsx";
import SpectrumMark from "./SpectrumMark.jsx";
import { ShieldIcon, GearIcon, HeartIcon, LockIcon, CompassIcon, MessageBubbleIcon } from "./icons.jsx";
import { useFocusable } from "./useFocusable.js";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Calm Suspense fallback for lazily-loaded screens. Reuses the shared Skeleton
// (which respects prefers-reduced-motion — static tint, no shimmer, for those
// users), so there's no spinner jank. A few stacked blocks approximate a screen
// header + body so the transition reads as "content loading", not a flash.
function ScreenFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "24px",
        width: "100%",
        maxWidth: 640,
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <Skeleton width="45%" height={28} radius={10} />
      <Skeleton width="100%" height={120} radius={14} />
      <Skeleton width="100%" height={72} radius={14} />
      <Skeleton width="70%" height={72} radius={14} />
    </div>
  );
}


// Human-readable screen names — drive document.title + the SR announcement so
// SPA tab changes are titled and announced (S4).
const SCREEN_NAMES = {
  suggestions: "Discover",
  matches: "Likes",
  messages: "Messages",
  profile: "Profile",
  admin: "Moderation",
  safety: "Safety Center",
  settings: "Settings",
  account: "Account & security",
  notifications: "Notifications",
  membership: "Membership",
  bestFits: "Best fits",
  terms: "Terms & Community Standards",
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
        fontSize: 16,
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
      {/* Calm "there's something new" dot — a presence indicator, NOT a counter
          (no number; product law forbids unread counts / gamification). */}
      {badgeCount > 0 && (
        <span
          aria-label="new activity"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: t.accentFill,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
      )}
    </button>
  );
}

// ─── Nav icons ────────────────────────────────────────────────────────────────
// One family from icons.jsx: 24px / 1.75 stroke on mobile (22px on the desktop
// rail), outline when inactive, the SAME silhouette filled when active.

// Fixed bottom tab bar (mobile only). 4 items, each ≥44px, icon + label.
// Plain nav buttons with aria-current="page" on the active item + focus rings.
// `vertical` renders the desktop side-rail variant: icon + label in a row,
// left-aligned, with a quiet tinted plate on the active item. Mobile/tablet
// keep the stacked bottom-bar look.
function BottomNavTab({ label, icon, active, onClick, badgeCount, badgeAria, vertical = false }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      style={{
        minHeight: 44,
        display: "flex",
        cursor: "pointer",
        position: "relative",
        border: "none",
        ...(vertical
          ? {
              width: "100%",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 12,
              padding: "10px 14px",
              background: active ? t.green50 : "transparent",
              borderRadius: 10,
              color: active ? t.accentStrong : t.textSoft,
              fontSize: 16,
              fontWeight: active ? 700 : 500,
              fontFamily: t.sans,
              textAlign: "left",
            }
          : {
              flex: 1,
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: "6px 4px",
              background: "transparent",
              borderRadius: 8,
              color: active ? t.accentStrong : t.textMuted,
              fontSize: 12,
              fontWeight: active ? 700 : 500,
            }),
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <span style={{ position: "relative", display: "inline-flex" }}>
        {typeof icon === "function" ? icon(active, vertical ? 22 : 24) : icon}
        {/* Calm "there's something new" dot — a presence indicator, NOT a
            counter (no number; product law forbids unread counts). A thin ring
            in the surface color keeps it legible over the active icon. */}
        {badgeCount > 0 && (
          <span
            aria-label={badgeAria || "new activity"}
            style={{
              position: "absolute",
              top: -3,
              right: -5,
              width: 9,
              height: 9,
              boxSizing: "border-box",
              borderRadius: "50%",
              background: t.accentFill,
              boxShadow: `0 0 0 2px ${t.surface}`,
            }}
          />
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
        color: active ? t.accentStrong : t.textSoft,
        borderRadius: 8,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <ShieldIcon size={18} /> Safety
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
        color: active ? t.accentStrong : t.textSoft,
        borderRadius: 8,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <GearIcon size={18} /> Settings
    </button>
  );
}

function SecurityLink({ active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Account & security"
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
        color: active ? t.accentStrong : t.textSoft,
        borderRadius: 8,
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <LockIcon size={18} /> Security
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
  const wantReduceMotion = !!(prefs.reduceMotion || prefs.reducedSensory);
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
// Browser-chrome color per theme (status bar / PWA). Keyed by theme id;
// unknown ids fall back to dim's, matching the prefs normaliser.
const THEME_META_COLOR = {
  light: "#3E6660",
  dim: "#181F1D",
  navy: "#121A2B",
  lightblue: "#2F5675",
  pink: "#8A4560",
  pride: "#5A3E8C",
  trans: "#21607C",
  bisexual: "#7A3E86",
  lesbian: "#A32A5A",
  pansexual: "#A81A62",
  nonbinary: "#5C4691",
  asexual: "#67337A",
};

// The one sanctioned multi-color surface outside the brand mark: a 3px flag
// ribbon under the app header for the identity themes. Decorative only
// (aria-hidden), never animated, and hidden entirely under reduced-sensory.
const FLAG_RIBBONS = {
  pride: "linear-gradient(90deg,#B5544C 0%,#B5544C 16.6%,#C08A45 16.6%,#C08A45 33.3%,#B29A45 33.3%,#B29A45 50%,#5E9459 50%,#5E9459 66.6%,#4F7DA6 66.6%,#4F7DA6 83.3%,#7B5EA7 83.3%,#7B5EA7 100%)",
  trans: "linear-gradient(90deg,#5BCEFA 0%,#5BCEFA 20%,#F5A9B8 20%,#F5A9B8 40%,#FFFFFF 40%,#FFFFFF 60%,#F5A9B8 60%,#F5A9B8 80%,#5BCEFA 80%,#5BCEFA 100%)",
};
function applyTheme(prefs) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = prefs.theme === "light" ? "" : prefs.theme;
  // High-contrast token layer (index.html :root[data-contrast="high"]). Set on
  // the document root — NOT the app wrapper — so it reaches every screen,
  // including the pre-auth/onboarding first run, and so it deepens text/border
  // tokens in every theme without distorting photos.
  document.documentElement.dataset.contrast = prefs.highContrast ? "high" : "";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_META_COLOR[prefs.theme] || THEME_META_COLOR.dim);
}

// Inline style overrides for the top-level app container based on prefs.
// - high contrast: a root `filter` (global + safe).
// - larger text: a `transform: scale` wrapper enlarges everything
//   proportionally (px inline styles won't scale via root font-size). D4 — CSS
//   `zoom` is a no-op in Firefox; `transform` works cross-browser. To keep the
//   scaled container edge-aligned we pin the origin to the top-center and
//   pre-shrink width by the inverse factor so the post-scale box refills the
//   viewport (no horizontal clipping / centered as before). Fixed sheets/dialogs
//   inside render relative to this transformed container, matching prior behavior.
const LARGER_TEXT_SCALE = 1.15;
function a11yWrapperStyle(prefs) {
  const style = {};
  // Mild shell-wide contrast punch. Photos/media are excluded from it via a
  // counter-filter in index.html (:root[data-contrast="high"] img/video/canvas)
  // so faces are never distorted; genuine readable contrast comes from the
  // token layer keyed on data-contrast. Kept as a filter (not removed) so the
  // effect still reaches non-token decoration.
  if (prefs.highContrast) style.filter = "contrast(1.15)";
  if (prefs.largerText) {
    style.transform = `scale(${LARGER_TEXT_SCALE})`;
    style.transformOrigin = "top center";
    style.width = `${100 / LARGER_TEXT_SCALE}%`;
    style.margin = "0 auto";
  }
  if (prefs.reducedSensory) style.background = t.bg;
  return style;
}

// D-9 — desktop dead-space fill. On wide viewports the left rail + a centred
// ~640px column leaves the surrounding area empty/dark, reading unfinished.
// This is the landing's soft, static, very-low-contrast spectrum atmosphere
// wash (green + teal + warm clay), painted on the app shell BEHIND the opaque
// header/content panels so it only shows in the empty gutters. Static and
// decorative; the warm-clay stops also bring the ramp's warm end onto the
// desktop shell (D-6). Reduced-sensory falls back to flat t.bg automatically
// (a11yWrapperStyle sets `background: t.bg`, which is spread after this).
const DESKTOP_ATMOSPHERE = [
  // A-2 nit #3: cool corner alphas lifted 0.09 → 0.12 so the wash isn't
  // lopsided-warm (the two clay corners below sit at 0.13/0.08).
  "radial-gradient(38% 46% at 11% 20%, rgba(94,148,89,0.12) 0%, rgba(94,148,89,0) 70%)",
  "radial-gradient(40% 48% at 91% 15%, rgba(79,138,139,0.12) 0%, rgba(79,138,139,0) 70%)",
  "radial-gradient(52% 54% at 90% 88%, rgba(201,168,117,0.13) 0%, rgba(201,168,117,0) 72%)",
  "radial-gradient(46% 50% at 8% 90%, rgba(201,168,117,0.08) 0%, rgba(201,168,117,0) 72%)",
].join(", ");

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

// FE-4: while an identity theme (pride/trans) is active, the logo cluster is a
// real <button aria-label="Switch back to Warm dim"> — a keyboard/screen-reader
// path to the quick revert (a safety "panic-off" affordance). Otherwise it's the
// plain <div> carrying ONLY the existing pointer double-tap gesture. Both paths
// call the same revert handler; the button keeps double-tap too. Purely additive:
// no identity-theme trust&safety invariant (logout reset, double-tap, client-only)
// changes here.
function LogoRevertShell({ active, onRevert, style, children }) {
  // B8 — hook before any early return (React #310). The panic-revert button is a
  // safety-critical control, so it must carry the app's visible keyboard focus
  // ring like every other interactive control.
  const f = useFocusable();
  if (active) {
    return (
      <button
        type="button"
        aria-label="Switch back to Warm dim"
        onClick={onRevert}
        onDoubleClick={onRevert}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        style={{
          display: "flex",
          alignItems: "center",
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          ...style,
          ...f.style,
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <div style={style} onDoubleClick={onRevert}>
      {children}
    </div>
  );
}

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
            // D7 — 44px hit target (was ~28×20px) without enlarging the glyph.
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
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
              // D32 — warningBorder ≥3:1 on the sand banner bg (was t.warning at 2.34:1).
              border: `1px solid ${t.warningBorder}`,
              color: t.text,
              fontSize: 14,
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
            // D7 — 44px hit target (was ~28×20px) without enlarging the glyph.
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
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

// ── Traveler / at-risk region alert (calm-by-design) ─────────────────────────
// Shown at most once per session when the backend flags the member's COARSE
// region as one where LGBTQ+ people can face legal risk (the server-side lookup
// is transient — never stored or logged; see server/src/routes/profile.js).
// Calm amber ONLY (the shared `sand` warning surface used by the verify-email
// banner) — never a red alarm; supportive and brief. Offers to HIDE the profile
// (reuses the existing pause mechanism → paused=true, so the member stops
// appearing in Discover) plus a Dismiss. If already hidden, the copy simply
// confirms it and only Dismiss remains.
function RegionSafetyBanner({ paused, busy, onHide, onDismiss }) {
  const fHide = useFocusable();
  const fDismiss = useFocusable();
  return (
    <div
      role="status"
      style={{
        background: t.sand,
        borderBottom: `1px solid ${t.warningBorder}`,
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
        {/* minWidth:0 so the message can shrink/wrap next to the buttons
            (flex-row truncation invariant). */}
        <span style={{ flex: 1, minWidth: 0 }}>
          {paused
            ? "Your profile is hidden — you're not visible in Discover. You can turn it back on anytime from your profile."
            : "You appear to be somewhere LGBTQ+ people can face risk. If you'd like, you can hide your profile so you're not visible here."}
        </span>
        {!paused && (
          <button
            type="button"
            onClick={onHide}
            disabled={busy}
            {...fHide}
            style={{
              background: "none",
              border: `1px solid ${t.warningBorder}`,
              color: t.text,
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              padding: "6px 12px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              ...fHide.style,
            }}
          >
            {busy ? "Hiding…" : "Hide my profile"}
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
            // 44px hit target without enlarging the glyph (matches the other banners).
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
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

// ── Trans home-region safety alert (calm-by-design) ──────────────────────────
// Companion to RegionSafetyBanner. Shown at most once per session when the
// backend flags that the member is trans/gender-diverse AND their stated HOME
// state has enacted anti-trans law (computed server-side from their own profile;
// nothing is stored). Same calm amber `sand` surface, same Hide + Dismiss layout
// and focus/aria treatment — warm and supportive, never alarmist. Offers to HIDE
// the profile (reuses the same pause mechanism → paused=true) plus a Dismiss.
// The country/legal-danger banner takes priority: this one renders only when
// that one is NOT showing (see the render gate), so at most one appears.
function TransSafetyBanner({ paused, busy, onHide, onDismiss }) {
  const fHide = useFocusable();
  const fDismiss = useFocusable();
  return (
    <div
      role="status"
      style={{
        background: t.sand,
        borderBottom: `1px solid ${t.warningBorder}`,
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
        {/* minWidth:0 so the message can shrink/wrap next to the buttons
            (flex-row truncation invariant). */}
        <span style={{ flex: 1, minWidth: 0 }}>
          {paused
            ? "Your profile is hidden — you're not visible in Discover. You can turn it back on anytime from your profile."
            : "The area you've set as home has laws that can affect trans people's rights. You're welcome here — if you'd like, you can hide your profile so you're not visible in Discover."}
        </span>
        {!paused && (
          <button
            type="button"
            onClick={onHide}
            disabled={busy}
            {...fHide}
            style={{
              background: "none",
              border: `1px solid ${t.warningBorder}`,
              color: t.text,
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              padding: "6px 12px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              ...fHide.style,
            }}
          >
            {busy ? "Hiding…" : "Hide my profile"}
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
            // 44px hit target without enlarging the glyph (matches the other banners).
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
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
        boxShadow: t.shadow.lg,
        padding: "calc(14px + env(safe-area-inset-top, 0px)) 20px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <p id="inactivity-heading" style={{ margin: 0, fontWeight: 700, color: t.text, fontSize: 16 }}>
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
          fontSize: 16,
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
  // Required-city gate for LEGACY members: onboarding is complete but dist_city
  // is blank (they signed up before the city field was required). Shown AFTER
  // onboarding, BEFORE the app, until they add a coarse city (needed for nearby
  // matching). Never overlaps onboarding — the profile check below sets exactly
  // one of the two.
  const [needsCity, setNeedsCity] = useState(false);
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
      const allowed = ["suggestions", "matches", "messages", "profile", "safety", "settings", "account", "notifications", "membership", "bestFits", "terms"];
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

  // ── Page-view telemetry beacon (fire-and-forget) ──────────────────────────
  // One anonymous beacon per distinct tab the user lands on. Gated exactly like
  // the nav effect above (authed, past onboarding, not the reset screen). The
  // last-sent ref DEDUPES: the mount that also primes the nav effect records the
  // landing view once, and each later tab change (including Back/Forward, which
  // routes through setActiveTab) sends once — never twice for the same view. The
  // beacon itself never blocks nav and swallows every error (see api.js).
  const lastBeaconTab = useRef(null);
  useEffect(() => {
    if (!authed || onboarding || resetToken) return;
    if (lastBeaconTab.current === activeTab) return;
    lastBeaconTab.current = activeTab;
    sendPageview(activeTab);
  }, [activeTab, authed, onboarding, resetToken]);

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
  // Deep-link into a specific conversation. Preferably an OBJECT seed
  // ({id, otherUser, started}) so MessagingApp can open the thread instantly
  // without waiting for the conversations list; a bare string id still works.
  const [pendingConversation, setPendingConversation] = useState(null);

  // Email verification state
  const [verifyResult, setVerifyResult] = useState(null); // null | 'success' | 'error'
  const [emailVerified, setEmailVerified] = useState(true); // default true so banner hidden until we know
  const [emailVerifyEnabled, setEmailVerifyEnabled] = useState(false);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);

  // ── Traveler / at-risk region alert ─────────────────────────────────────────
  // Whether the backend flagged our COARSE region as one where LGBTQ+ people can
  // face legal risk. Whether the member has hidden (paused) their profile — drives
  // the banner copy + the Hide button. Dismissed-this-session gate (sessionStorage)
  // so the calm banner shows at most once per session and never nags.
  const [regionAtRisk, setRegionAtRisk] = useState(false);
  const [myPaused, setMyPaused] = useState(false);
  const [regionHideBusy, setRegionHideBusy] = useState(false);
  const [regionAlertDismissed, setRegionAlertDismissed] = useState(() => {
    try { return !!sessionStorage.getItem(REGION_ALERT_SESSION_KEY); } catch { return false; }
  });
  const dismissRegionAlert = useCallback(() => {
    setRegionAlertDismissed(true);
    try { sessionStorage.setItem(REGION_ALERT_SESSION_KEY, "1"); } catch { /* no-op */ }
  }, []);
  // Trans home-region alert — separate flag + separate session gate from the
  // country/at-risk banner above (shown at most once per session, never nags).
  // Reuses myPaused + handleRegionHide/regionHideBusy (same pause mechanism).
  const [transAtRisk, setTransAtRisk] = useState(false);
  const [transAlertDismissed, setTransAlertDismissed] = useState(() => {
    try { return !!sessionStorage.getItem(TRANS_ALERT_SESSION_KEY); } catch { return false; }
  });
  const dismissTransAlert = useCallback(() => {
    setTransAlertDismissed(true);
    try { sessionStorage.setItem(TRANS_ALERT_SESSION_KEY, "1"); } catch { /* no-op */ }
  }, []);
  // homeStateAtRisk — GENDER-INDEPENDENT signal: the member's STATED HOME STATE
  // has enacted anti-trans law (does NOT drive the load banners; it feeds the
  // contextual gender-field note only). `locationAtRisk` = country-legal-risk OR
  // home-state-risk, the single boolean the gender note keys off.
  const [homeStateAtRisk, setHomeStateAtRisk] = useState(false);
  const locationAtRisk = regionAtRisk || homeStateAtRisk;
  const handleRegionHide = useCallback(async () => {
    setRegionHideBusy(true);
    try {
      // Reuse the existing instant-pause mechanism (F17): paused=true removes the
      // member from Discover. Same field, same endpoint as the Profile toggle.
      await updateProfile({ paused: true });
      setMyPaused(true);
    } catch {
      // Leave the banner in place so the member can retry; don't hide it silently.
    } finally {
      setRegionHideBusy(false);
    }
  }, []);

  // iOS Safari can leave a phantom out-of-bounds window scroll after the
  // keyboard dismisses (it pans the window to lift a focused field, then fails
  // to re-clamp), exposing un-painted backdrop below the document (IMG_3119).
  // The window legitimately never scrolls in this layout (all scrolling lives
  // inside <main>), so snapping back to 0 on visual-viewport resize is safe.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => { if (window.scrollY > 0) window.scrollTo(0, 0); };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Admin / moderation access
  const [isAdmin, setIsAdmin] = useState(false);

  // Current user's own primary photo — drives the Profile nav-tab avatar.
  // Loaded once when authed (see the getProfile effect below) and refreshed
  // when the user leaves the Profile screen (where photo edits happen).
  const [myPhotoUrl, setMyPhotoUrl] = useState(null);
  const [myDisplayName, setMyDisplayName] = useState("");
  // Identity-review ("Reviewed") status — drives the Profile Hub's badge. Seeded
  // from /profile/me (returns `verified`) alongside the avatar/name below.
  const [myVerified, setMyVerified] = useState(false);
  // Within the Profile tab, which sub-view is showing. The tab now DEFAULTS to a
  // calm Profile Hub (home); Edit / Preferences are deliberate drill-ins reached
  // from it. Reset to "hub" every time the Profile tab is (re)entered.
  //   'hub'         → <ProfileHub>
  //   'edit'        → <ProfileScreen> (full editor, via the avatar pencil)
  //   'preferences' → <ProfileScreen> opened at the "Looking for" group
  //   'preview'     → <ProfileScreen> with the "How others see you" preview open
  const [profileView, setProfileView] = useState("hub");
  // Profile completeness for the Hub's calm "here's what still helps" cue,
  // computed from /profile/me in applyMyProfile. null until the first load; the
  // Hub renders nothing while null. When the cue is tapped, profileJumpField
  // carries the first-missing field key into the editor so it lands right there.
  const [myCompleteness, setMyCompleteness] = useState(null);
  const [profileJumpField, setProfileJumpField] = useState(null);
  // Billing tier — drives the calm "Companion" marker on Settings + the
  // Membership screen. Seeded from /profile/me (which now returns `tier`) and
  // updated by the Membership screen after an upgrade/cancel. "no tier = free".
  const [tier, setTier] = useState("free");

  // Pull the signed-in user's primary photo + name out of a profile payload.
  // Primary = first photo flagged isPrimary, else the first photo, else none.
  const applyMyProfile = useCallback((p) => {
    if (!p || typeof p !== "object") return;
    if (typeof p.displayName === "string") setMyDisplayName(p.displayName);
    // Track pause state so the at-risk banner can reflect "already hidden".
    if (typeof p.paused === "boolean") setMyPaused(p.paused);
    if (typeof p.tier === "string") setTier(p.tier);
    if (typeof p.verified === "boolean") setMyVerified(p.verified);
    if (Array.isArray(p.photos)) {
      const primary = p.photos.find((ph) => ph && ph.isPrimary) || p.photos[0] || null;
      setMyPhotoUrl(primary?.url || null);
    }
    // Completeness for the Hub cue. Same 7-field logic the in-form nudge uses
    // (shared computeCompleteness). Prompts are counted only when actually
    // answered (non-empty), matching how the editor treats an answered prompt.
    setMyCompleteness(
      computeCompleteness({
        photos: p.photos,
        tagline: p.tagline,
        bio: p.bio,
        gender: p.gender,
        pronouns: p.pronouns,
        commDirectness: p.commDirectness,
        commLiteral: p.commLiteral,
        commCadence: p.commCadence,
        sensoryEnvironment: p.sensoryEnvironment,
        sensoryLighting: p.sensoryLighting,
        prompts: Array.isArray(p.prompts)
          ? p.prompts.filter((x) => x && x.promptKey && (x.answer || "").trim())
          : [],
      })
    );
  }, []);

  // Refresh the nav avatar when returning from the Profile screen, where the
  // user may have changed their primary photo.
  const refreshMyProfile = useCallback(() => {
    getProfile().then(applyMyProfile).catch(() => { /* keep last-known avatar */ });
  }, [applyMyProfile]);

  // Accessibility prefs (frontend-only, persisted in localStorage). Read once on
  // mount; applied globally via the effect below + inline wrapper styles.
  const [a11y, setA11y] = useState(() => readA11y());
  // FE-4: polite SR announcement when the identity theme is reverted (keyboard,
  // pointer double-tap, or click all route through revertIdentityTheme). A
  // monotonic tick guarantees the live region re-announces even on repeat reverts.
  const [themeRevertNote, setThemeRevertNote] = useState("");
  const revertTickRef = useRef(0);
  // Mirror of the live theme so revertIdentityTheme (deps []) can guard the
  // announcement on the pre-revert theme without going stale.
  const themeRef = useRef(a11y.theme);
  useEffect(() => { themeRef.current = a11y.theme; }, [a11y.theme]);

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

  // One-gesture quiet revert (safety): double-tapping the Spectrum mark while
  // an identity theme is active switches instantly back to Warm dim — no
  // navigation through Settings needed when someone walks into the room.
  // Silent by design; the tip is disclosed at selection time in Settings.
  const revertIdentityTheme = useCallback(() => {
    // Guard on the live theme so a stray double-tap/click on the plain (non-
    // identity) logo neither reverts nor announces anything.
    if (!IDENTITY_THEMES.includes(themeRef.current)) return;
    setA11y((prev) => {
      if (!IDENTITY_THEMES.includes(prev.theme)) return prev;
      const next = { ...prev, theme: "dim" };
      try { localStorage.setItem("spectrum_a11y", JSON.stringify(next)); } catch { /* state still applies */ }
      return next;
    });
    // FE-4: announce via the polite live region. Trailing NBSPs keyed off a
    // monotonic tick keep the text node changing so repeat reverts still fire
    // (an identical string wouldn't re-announce), while the visible/read text
    // stays "Switched back to Warm dim."
    revertTickRef.current += 1;
    setThemeRevertNote("Switched back to Warm dim." + " ".repeat(revertTickRef.current % 2));
  }, []);

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
      setNeedsCity(false);
      setIsAdmin(false);
      // Send the user straight to the sign-in form (not the marketing page) so
      // the expiry message has context.
      setAuthMode("login");
      setShowAuth(true);
      // Trust & safety: identity-flag theme must not persist in-memory across a
      // same-session logout→login (clearAuth already reset localStorage + DOM).
      setA11y((prev) => IDENTITY_THEMES.includes(prev.theme) ? { ...prev, theme: "dim" } : prev);
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
        // Required-city gate: a legacy member who finished onboarding before the
        // city field existed has onboardingComplete but a blank dist_city
        // (returned as distCity from /profile/me). Gate them until it's set.
        else if (!p.distCity || !String(p.distCity).trim()) setNeedsCity(true);
        // Persist email verification state across reloads
        if (typeof p.emailVerified === "boolean") setEmailVerified(p.emailVerified);
        if (typeof p.emailVerificationEnabled === "boolean") setEmailVerifyEnabled(p.emailVerificationEnabled);
        if (typeof p.isAdmin === "boolean") setIsAdmin(p.isAdmin);
        // Seed the Profile nav-tab avatar from the same payload.
        applyMyProfile(p);
      })
      .catch(() => {
        // Silently fail — if we can't load the profile here, let the main app
        // handle it; don't block auth behind a network error.
      });
  }, [authed, applyMyProfile]);

  // Traveler / at-risk region alert. Once authed and past onboarding, ask the
  // backend whether our COARSE region is one where LGBTQ+ people can face legal
  // risk (the lookup is transient server-side — never stored or logged). Skip the
  // call entirely if the member already dismissed the banner this session.
  // Best-effort and protective: any failure is swallowed so it never blocks the app.
  // Note: the fetch runs during onboarding too (no `onboarding` guard), so the
  // contextual gender-field note has atRisk/homeStateAtRisk at the moment of
  // disclosure. The LOAD banners can't leak into onboarding regardless — they
  // render only in the post-onboarding app shell (the `onboarding ?` branch
  // shows OnboardingScreen instead), so no explicit banner gate is needed here.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    getRegionSafety()
      .then((r) => {
        if (cancelled || !r) return;
        if (r.atRisk === true) setRegionAtRisk(true);
        if (r.transAtRisk === true) setTransAtRisk(true);
        if (r.homeStateAtRisk === true) setHomeStateAtRisk(true);
      })
      .catch(() => { /* protective, best-effort — never block the app */ });
    return () => { cancelled = true; };
  }, [authed]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setAuthMessage("You have been signed out.");
    setAuthed(false);
    setOnboarding(false);
    setNeedsCity(false);
    setUnreadCount(0);
    setActivityCount(0);
    setIsAdmin(false);
    setMyPhotoUrl(null);
    setMyDisplayName("");
    setTier("free");
    setShowAuth(false); // back to the landing page
    // Trust & safety: identity-flag theme must not persist in-memory into the
    // next login on this page load (clearAuth already reset localStorage + DOM).
    setA11y((prev) => IDENTITY_THEMES.includes(prev.theme) ? { ...prev, theme: "dim" } : prev);
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
  // Messages "home" reset signal — incremented on every Messages nav tap so
  // MessagingApp can drop back to its conversation list even when the Messages
  // tab is already active (tapping the nav from a conversation/block-report
  // sub-screen otherwise does nothing, since activeTab doesn't change).
  const [messagesHomeSignal, setMessagesHomeSignal] = useState(0);
  // Activity count — incoming likes from the activity inbox (drives the Matches tab badge)
  const [activityCount, setActivityCount] = useState(0);
  // Stable so MatchesScreen's activity effect doesn't re-run (and re-fetch) on
  // every App render — a fresh inline arrow here caused a redundant getActivity
  // per render and a flickering badge.
  const handleActivityCount = useCallback((n) => setActivityCount(n), []);

  // Ref so the socket effect can read the current tab without a stale closure
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // E12 — App owns the ONE shared socket connection's lifecycle: connect when
  // authed, disconnect on logout / auth:expired (both flip `authed` false, which
  // re-runs this effect's cleanup). It subscribes for the badge behavior only;
  // ConversationScreen subscribes to the SAME connection for thread rendering
  // without opening a second socket or churning one on every thread switch.
  useEffect(() => {
    if (!authed) return;
    const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");
    const token = getToken();
    if (!token || !BASE_URL) return;

    // Idempotent — opens the connection once (socket.io-client is dynamically
    // imported inside, staying off the logged-out bundle).
    connectSocket(token, BASE_URL);

    const offMessage = onSocket("new_message", (payload) => {
      // Don't count the user's own sent messages — the badge tracks messages
      // *received* while away from the Messages tab.
      if (payload?.message?.senderId === getUserId()) return;
      if (activeTabRef.current !== "messages") {
        setUnreadCount(prev => prev + 1);
      }
    });

    // Realtime new-match signal — bump the Matches tab activity badge when a
    // mutual match lands while the user is elsewhere. Mirrors new_message.
    const offMatch = onSocket("new_match", () => {
      if (activeTabRef.current !== "matches") {
        setActivityCount(prev => prev + 1);
      }
    });

    return () => {
      offMessage();
      offMatch();
      // Sever the shared connection on logout / expiry (authed → false). A
      // subsequent login re-runs this effect and reconnects with the new token.
      disconnectSocket();
    };
  }, [authed]);

  return (
    <PlainLanguageProvider value={!!a11y.plainLanguage}>
    <>
      <div role="status" aria-live="assertive" aria-atomic="true" style={srOnly}>
        {authMessage}
      </div>
      {/* FE-4: polite SR announcement for the identity-theme quick-revert
          (keyboard button, click, and pointer double-tap all route here). */}
      <div role="status" aria-live="polite" aria-atomic="true" style={srOnly}>
        {themeRevertNote}
      </div>
      {isOffline && (
        // D29 — the offline banner sits BELOW the inactivity "Still here?" dialog
        // (zIndex 200) so it can never cover the "I'm still here" button. Two
        // top:0 fixed overlays must not trap the user; the dialog always wins.
        <div
          role="status"
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 150,
            // D32 — warningBorder ≥3:1 on surfaceAlt (was t.warning at 2.86:1).
            background: t.surfaceAlt, borderBottom: `2px solid ${t.warningBorder}`,
            color: t.text, textAlign: "center", padding: "8px 16px",
            // D7 — reserve the iOS notch/status-bar area (as the header does) so the
            // fixed banner reads as its own bar and never clips under / collides with
            // the header's top edge on notched devices.
            paddingTop: "calc(8px + env(safe-area-inset-top, 0px))",
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
            // a11y wrapper reaches the pre-auth flow too, so Larger text / High
            // contrast apply during the highest-stakes first run. These screens
            // have no position:fixed descendants, so the transform/filter
            // containing-block caveat (why the authed nav stays outside) is moot.
            <div style={a11yWrapperStyle(a11y)}>
              <AuthScreen
                onAuth={handleAuthed}
                initialMode={authMode}
                onBack={() => setShowAuth(false)}
              />
            </div>
          )
          : (
            <>
              <SkipLink />
              <div style={a11yWrapperStyle(a11y)}>
                <Suspense fallback={<ScreenFallback />}>
                  <LandingScreen
                    onGetStarted={() => { setAuthMode("register"); setShowAuth(true); }}
                    onSignIn={() => { setAuthMode("login"); setShowAuth(true); }}
                  />
                </Suspense>
              </div>
            </>
          )
        : onboarding
        ? (
          <div style={a11yWrapperStyle(a11y)}>
            <Suspense fallback={<ScreenFallback />}>
              <OnboardingScreen onComplete={() => setOnboarding(false)} locationAtRisk={locationAtRisk} />
            </Suspense>
          </div>
        )
        : needsCity
        ? (
          <div style={a11yWrapperStyle(a11y)}>
            <Suspense fallback={<ScreenFallback />}>
              <RequireCityScreen
                onComplete={() => setNeedsCity(false)}
                onSignOut={handleSignOut}
              />
            </Suspense>
          </div>
        )
        : (
          <>
          <div
            style={{
              // Messages hosts its own internal scroller (the message log), so
              // the shell must be HEIGHT-LOCKED to the viewport there — with
              // minHeight the whole page grew to fit the thread and the log
              // never scrolled. Every other tab keeps normal page scrolling.
              // dvh tracks the iOS dynamic toolbar (100vh hides the composer
              // behind it).
              ...(activeTab === "messages"
                ? { height: "100dvh", overflow: "hidden" }
                : { minHeight: "100dvh" }),
              display: "flex",
              flexDirection: "column",
              background:
                viewport === "desktop" && !a11y.reducedSensory
                  ? `${DESKTOP_ATMOSPHERE}, ${t.bg}`
                  : t.bg,
              fontFamily: t.sans,
              color: t.text,
              // Reserve space for the fixed nav: bottom bar on mobile/tablet,
              // left rail on desktop.
              ...(viewport === "desktop"
                ? { paddingLeft: 224 }
                : { paddingBottom: "calc(56px + env(safe-area-inset-bottom))" }),
              ...a11yWrapperStyle(a11y),
            }}
          >
            <SkipLink />
            {/* Announces the current screen to screen readers on tab change (S4). */}
            <div aria-live="polite" style={srOnly}>{SCREEN_NAMES[activeTab]}</div>
            {emailVerifyEnabled && !emailVerified && !verifyBannerDismissed && (
              <VerifyEmailBanner onDismiss={() => setVerifyBannerDismissed(true)} />
            )}
            {shouldShowRegionAlert(regionAtRisk, regionAlertDismissed) && (
              <RegionSafetyBanner
                paused={myPaused}
                busy={regionHideBusy}
                onHide={handleRegionHide}
                onDismiss={dismissRegionAlert}
              />
            )}
            {/* Calm priority: show AT MOST ONE safety banner at a time. The
                country/legal-danger banner above is a more acute risk, so it
                wins; the trans home-region banner shows only when it is NOT. */}
            {shouldShowTransAlert(transAtRisk, transAlertDismissed) &&
              !shouldShowRegionAlert(regionAtRisk, regionAlertDismissed) && (
              <TransSafetyBanner
                paused={myPaused}
                busy={regionHideBusy}
                onHide={handleRegionHide}
                onDismiss={dismissTransAlert}
              />
            )}
            {/* App-level header / wordmark */}
            <header
              style={{
                background: t.surface,
                borderBottom: `1px solid ${t.border}`,
                // Reserve the iOS notch/status-bar area (viewport-fit=cover).
                padding: "calc(14px + env(safe-area-inset-top, 0px)) 20px 0",
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
                  <LogoRevertShell
                    active={IDENTITY_THEMES.includes(a11y.theme)}
                    onRevert={revertIdentityTheme}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {/* On desktop the left rail already carries the brand lockup,
                        so the header omits its own to avoid a double logo. */}
                    {viewport !== "desktop" && (a11y.reducedSensory
                      ? <SpectrumMark height={isMobile ? 20 : 18} />
                      : <AnimatedSpectrumMark height={isMobile ? 20 : 18} />)}
                    {/* Wordmark is shown in BOTH breakpoints. The earlier mobile
                        overflow came from the utility BUTTON cluster (now moved to
                        the Profile hub, see below), not the wordmark — so there's
                        room for "Spectrum" on mobile and hiding it read as broken. */}
                    {viewport !== "desktop" && (
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
                    )}
                  </LogoRevertShell>
                  {/* Utility cluster is desktop-only; on mobile it moves into the
                      Profile account hub (see ProfileScreen). */}
                  {!isMobile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                      <SecurityLink
                        active={activeTab === "account"}
                        onClick={() => {
                          if (activeTab !== "account") setPrevTab(activeTab);
                          setActiveTab("account");
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Primary nav is a single FIXED BOTTOM bar on every viewport
                    (rendered as a sibling of this wrapper, below) so it's always
                    pinned to the bottom of the screen regardless of scroll. */}
              </div>
            </header>

            {/* Identity-theme flag ribbon — 3px, decorative, static, and gone
                entirely under reduced-sensory (the one multi-color surface
                outside the brand mark). */}
            {FLAG_RIBBONS[a11y.theme] && !a11y.reducedSensory && (
              <div aria-hidden="true" style={{ height: 3, flexShrink: 0, background: FLAG_RIBBONS[a11y.theme] }} />
            )}

            {/* Main content — grows to fill viewport. id + tabIndex make it the
                target of the skip link and a focus destination on tab change. */}
            <main
              id="main-content"
              tabIndex={-1}
              aria-label={
                activeTab === "suggestions" ? "Discover" :
                activeTab === "matches" ? "Likes" :
                activeTab === "messages" ? "Messages" :
                activeTab === "admin" ? "Moderation" :
                activeTab === "safety" ? "Safety Center" :
                activeTab === "settings" ? "Accessibility settings" :
                activeTab === "account" ? "Account & security" :
                activeTab === "notifications" ? "Notifications" :
                activeTab === "terms" ? "Terms & Community Standards" : "Profile"
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
              <Suspense fallback={<ScreenFallback />}>
              {activeTab === "suggestions" && (
                <SuggestionScreen
                  onOpenMessages={() => setActiveTab("messages")}
                  onOpenConversation={(conversationId, seedInfo) => {
                    setPendingConversation(seedInfo ? { id: conversationId, ...seedInfo } : conversationId);
                    setPrevTab("suggestions");
                    setActiveTab("messages");
                    setUnreadCount(0);
                  }}
                  onGoToProfile={() => { setProfileView("hub"); setActiveTab("profile"); }}
                  onOpenTopPicks={() => { setPrevTab("suggestions"); setActiveTab("bestFits"); }}
                  onOpenMembership={() => { setPrevTab("suggestions"); setActiveTab("membership"); }}
                  tier={tier}
                  plainLanguage={!!a11y.plainLanguage}
                  reducedSensory={!!a11y.reducedSensory}
                />
              )}
              {activeTab === "matches" && (
                <LikesScreen
                  onActivityCount={handleActivityCount}
                  onOpenConversation={(conversationId, seedInfo) => {
                    setPendingConversation(seedInfo ? { id: conversationId, ...seedInfo } : conversationId);
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
                  initialConversation={typeof pendingConversation === "object" && pendingConversation ? pendingConversation : null}
                  initialConversationId={typeof pendingConversation === "string" ? pendingConversation : null}
                  onConsumedInitial={() => setPendingConversation(null)}
                  homeSignal={messagesHomeSignal}
                  plainLanguage={!!a11y.plainLanguage}
                  reducedSensory={!!a11y.reducedSensory}
                />
              )}
              {activeTab === "profile" && profileView === "hub" && (
                <ProfileHub
                  displayName={myDisplayName}
                  photoUrl={myPhotoUrl}
                  verified={myVerified}
                  tier={tier}
                  completeness={myCompleteness}
                  // Tapping the completeness cue opens the editor landed on the
                  // first still-empty field; the pencil opens it fresh (no jump).
                  onOpenEditField={(key) => { setProfileJumpField(key); setProfileView("edit"); }}
                  onEditProfile={() => { setProfileJumpField(null); setProfileView("edit"); }}
                  onOpenPreferences={() => setProfileView("preferences")}
                  onOpenPreview={() => setProfileView("preview")}
                  onOpenSettings={() => { setPrevTab("profile"); setActiveTab("settings"); }}
                  onOpenNotifications={() => { setPrevTab("profile"); setActiveTab("notifications"); }}
                  onOpenMembership={() => { setPrevTab("profile"); setActiveTab("membership"); }}
                  onOpenTopPicks={() => { setPrevTab("profile"); setActiveTab("bestFits"); }}
                  onOpenSafety={() => { setPrevTab("profile"); setActiveTab("safety"); }}
                  onOpenAccount={() => { setPrevTab("profile"); setActiveTab("account"); }}
                  onSignOut={handleSignOut}
                />
              )}
              {activeTab === "profile" && profileView !== "hub" && (
                <ProfileScreen
                  // Back / Done from the editor returns to the Hub (the tab's home),
                  // refreshing the Hub avatar/name/verified from the saved profile.
                  onDone={() => { refreshMyProfile(); setProfileView("hub"); }}
                  // Preferences drill-in lands on the "Looking for" group, opened.
                  initialOpenSection={profileView === "preferences" ? "lookingFor" : null}
                  // "How others see you" drill-in opens the preview modal on mount;
                  // closing it returns to the Hub (it reads as a hub sub-view).
                  initialPreview={profileView === "preview"}
                  // Completeness drill-in: land on the first still-empty field
                  // (only when the editor was opened via the Hub cue).
                  initialJumpField={profileView === "edit" ? profileJumpField : null}
                  onSignOut={handleSignOut}
                  onOpenAccount={() => { setPrevTab("profile"); setActiveTab("account"); }}
                  onOpenSafety={() => { setPrevTab("profile"); setActiveTab("safety"); }}
                  onOpenSettings={() => { setPrevTab("profile"); setActiveTab("settings"); }}
                  onOpenMembership={() => { setPrevTab("profile"); setActiveTab("membership"); }}
                  tier={tier}
                  locationAtRisk={locationAtRisk}
                />
              )}
              {activeTab === "notifications" && (
                <NotificationsScreen
                  onBack={() => setActiveTab(prevTab || "profile")}
                  pushEnabled={pushEnabled}
                  pushSupported={pushSupported}
                  onEnablePush={enablePush}
                  onDisablePush={disablePush}
                />
              )}
              {activeTab === "account" && (
                <AccountSecurityScreen
                  onBack={() => setActiveTab(prevTab || "profile")}
                  onAccountDeleted={() => {
                    setAuthMessage("Your account has been deleted.");
                    setAuthed(false);
                    setOnboarding(false);
                    setNeedsCity(false);
                    setUnreadCount(0);
                    setIsAdmin(false);
                    setMyPhotoUrl(null);
                    setMyDisplayName("");
                    setTier("free");
                    setShowAuth(false); // back to the landing page
                  }}
                />
              )}
              {activeTab === "admin" && isAdmin && <AdminScreen onTierChange={setTier} />}
              {activeTab === "safety" && (
                <SafetyScreen onBack={() => setActiveTab(prevTab || "suggestions")} />
              )}
              {activeTab === "settings" && (
                <SettingsScreen
                  onBack={() => setActiveTab(prevTab || "suggestions")}
                  onChange={applyA11y}
                  onOpenTerms={() => { setPrevTab("settings"); setActiveTab("terms"); }}
                  tier={tier}
                />
              )}
              {activeTab === "terms" && (
                <TermsScreen onBack={() => setActiveTab(prevTab || "settings")} />
              )}
              {activeTab === "membership" && (
                <MembershipScreen
                  onBack={() => setActiveTab(prevTab || "settings")}
                  tier={tier}
                  onTierChange={setTier}
                  onOpenBestFits={() => { setPrevTab("membership"); setActiveTab("bestFits"); }}
                />
              )}
              {activeTab === "bestFits" && (
                <BestFits
                  onBack={() => setActiveTab(prevTab || "membership")}
                  onOpenMessages={() => setActiveTab("messages")}
                  onOpenConversation={(conversationId, seedInfo) => {
                    setPendingConversation(seedInfo ? { id: conversationId, ...seedInfo } : conversationId);
                    setPrevTab("bestFits");
                    setActiveTab("messages");
                    setUnreadCount(0);
                  }}
                  tier={tier}
                  plainLanguage={!!a11y.plainLanguage}
                />
              )}
              </Suspense>
            </main>

          </div>

          {/* Primary nav — a fixed BOTTOM bar on mobile/tablet, and a fixed
              LEFT RAIL on desktop (the mobile bar on a big monitor read as
              unfinished — audit D17). Rendered OUTSIDE the a11y wrapper so its
              filter/zoom can never break position:fixed. */}
          <nav
            aria-label="Primary"
            style={
              viewport === "desktop"
                ? {
                    position: "fixed",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 224,
                    background: t.surface,
                    borderRight: `1px solid ${t.border}`,
                    padding: "20px 12px",
                    boxSizing: "border-box",
                    zIndex: 50,
                    overflowY: "auto",
                  }
                : {
                    position: "fixed",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: t.surface,
                    borderTop: `1px solid ${t.border}`,
                    paddingBottom: "env(safe-area-inset-bottom)",
                    zIndex: 50,
                  }
            }
          >
            {viewport === "desktop" && (
              <LogoRevertShell
                active={IDENTITY_THEMES.includes(a11y.theme)}
                onRevert={revertIdentityTheme}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 18px" }}
              >
                {/* mark 13 keeps the full lockup inside the 224px rail */}
                <SpectrumMark height={13} />
                <span style={{ fontFamily: t.serif, fontWeight: 700, fontSize: 19, color: t.text }}>
                  Spectrum
                </span>
              </LogoRevertShell>
            )}
            <div
              style={
                viewport === "desktop"
                  ? { display: "flex", flexDirection: "column", gap: 4 }
                  : { display: "flex", width: "100%", maxWidth: t.layout.maxContent, margin: "0 auto" }
              }
            >
              <BottomNavTab
                vertical={viewport === "desktop"}
                label="Discover"
                icon={(a, s) => <CompassIcon size={s} filled={a} />}
                active={activeTab === "suggestions"}
                onClick={() => { setPrevTab(activeTab); setActiveTab("suggestions"); }}
              />
              <BottomNavTab
                vertical={viewport === "desktop"}
                label="Likes"
                icon={(a, s) => <HeartIcon size={s} strokeWidth={1.75} filled={a} />}
                active={activeTab === "matches"}
                // Don't zero the count merely on visit — a "liked you" is still
                // unactioned until you like back or dismiss them. It hides while
                // this tab is active and reappears on leave; it drops only when
                // MatchesScreen reports a smaller count (someone was acted on).
                onClick={() => { setPrevTab(activeTab); setActiveTab("matches"); }}
                badgeCount={activeTab === "matches" ? 0 : activityCount}
                badgeAria="new likes"
              />
              <BottomNavTab
                vertical={viewport === "desktop"}
                label="Messages"
                icon={(a, s) => <MessageBubbleIcon size={s} filled={a} />}
                active={activeTab === "messages"}
                onClick={() => { setPrevTab(activeTab); setPendingConversation(null); setActiveTab("messages"); setUnreadCount(0); setMessagesHomeSignal((n) => n + 1); }}
                badgeCount={activeTab === "messages" ? 0 : unreadCount}
                badgeAria="new messages"
              />
              <BottomNavTab
                vertical={viewport === "desktop"}
                label="Profile"
                icon={
                  <Avatar
                    name={myDisplayName}
                    userId={getUserId()}
                    photoUrl={myPhotoUrl}
                    size={24}
                    style={
                      activeTab === "profile"
                        ? { boxShadow: `0 0 0 2px ${t.surface}, 0 0 0 4px ${t.accentStrong}` }
                        : { boxShadow: `0 0 0 1.5px ${t.border}` }
                    }
                  />
                }
                active={activeTab === "profile"}
                onClick={() => { setPrevTab(activeTab); setProfileView("hub"); setActiveTab("profile"); }}
              />
              {isAdmin && (
                <BottomNavTab
                  vertical={viewport === "desktop"}
                  label="Moderation"
                  icon={(a, s) => <ShieldIcon size={s} strokeWidth={1.75} filled={a} />}
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
    </PlainLanguageProvider>
  );
}
