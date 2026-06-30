import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import SuggestionScreen from "./SuggestionScreen.jsx";
import MessagingApp from "./messaging/MessagingApp.jsx";
import ProfileScreen from "./ProfileScreen.jsx";
import MatchesScreen from "./MatchesScreen.jsx";
import SafetyScreen from "./SafetyScreen.jsx";
import AdminScreen from "./AdminScreen.jsx";
import AuthScreen from "./AuthScreen.jsx";
import OnboardingScreen from "./OnboardingScreen.jsx";
import { isLoggedIn, clearAuth, getToken, signOut, getProfile, getPushVapidKey, savePushSubscription, removePushSubscription, verifyEmail, resendVerification } from "./api.js";
import { t } from "./tokens.js";

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

function NavTab({ label, active, onClick, badgeCount }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 8px",
        background: "transparent",
        border: "none",
        borderBottom: active ? `2px solid ${t.accent}` : "2px solid transparent",
        color: active ? t.accent : t.textMuted,
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
            background: t.accent,
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
      <span aria-hidden="true">🛡</span> Safety
    </button>
  );
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
  const bg = isSuccess ? "#EEF5ED" : "#FDF2F2";
  const borderColor = isSuccess ? t.positive : t.danger;
  const textColor = isSuccess ? "#2F5D2B" : t.danger;
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
          maxWidth: 540,
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
        background: "#FBF6E9",
        borderBottom: `1px solid ${t.warning}`,
        padding: "12px 20px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 540,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 14,
          color: "#6E5206",
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
              color: "#6E5206",
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
            color: "#6E5206",
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
  const [authed, setAuthed] = useState(() => isLoggedIn());
  const [authMessage, setAuthMessage] = useState("");
  const [onboarding, setOnboarding] = useState(false);
  // 'suggestions' | 'matches' | 'messages' | 'profile' | 'admin' | 'safety'
  const [activeTab, setActiveTab] = useState("suggestions");
  const [prevTab, setPrevTab] = useState("suggestions");
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
      {verifyResult && (
        <VerifyResultBanner result={verifyResult} onDismiss={() => setVerifyResult(null)} />
      )}
      {!authed
        ? <AuthScreen onAuth={handleAuthed} />
        : onboarding
        ? <OnboardingScreen onComplete={() => setOnboarding(false)} />
        : (
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              background: t.bg,
              fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
              color: t.text,
            }}
          >
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
                  maxWidth: 540,
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
                  <SafetyLink
                    active={activeTab === "safety"}
                    onClick={() => {
                      if (activeTab !== "safety") setPrevTab(activeTab);
                      setActiveTab("safety");
                    }}
                  />
                </div>

                {/* Tab bar */}
                <div
                  role="tablist"
                  aria-label="Main navigation"
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
                      label="⚙ Moderation"
                      active={activeTab === "admin"}
                      onClick={() => { setPrevTab(activeTab); setActiveTab("admin"); }}
                    />
                  )}
                </div>
              </div>
            </header>

            {/* Main content — grows to fill viewport */}
            <main
              role="tabpanel"
              aria-label={
                activeTab === "suggestions" ? "Discover" :
                activeTab === "matches" ? "Matches" :
                activeTab === "messages" ? "Messages" :
                activeTab === "admin" ? "Moderation" :
                activeTab === "safety" ? "Safety Center" : "Profile"
              }
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: activeTab === "messages" ? "hidden" : "auto",
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
            </main>
          </div>
        )
      }
    </>
  );
}
