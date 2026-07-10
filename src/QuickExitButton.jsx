import { useState, useEffect } from "react";
import { t } from "./tokens.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// QuickExitButton — an OPT-IN "leave now" safety control. Autistic users can
// freeze or shut down under acute stress; a single rehearsed escape action is a
// well-established safety pattern (used across DV-support sites). When enabled
// (Safety Center → "Quick-exit button"), a small, discreet, always-reachable
// button instantly leaves the site via location.replace to a neutral page — using
// replace (not href) so the app is NOT kept in history and the browser Back
// button won't return to it.
//
// Self-gating: reads its own on/off from localStorage and hides itself when off,
// so App can render it unconditionally. Stays in sync live via a custom event
// (same tab, dispatched by the Safety Center toggle) and the storage event
// (other tabs), with no reload.

export const QUICK_EXIT_KEY = "spectrum_quick_exit";
export const QUICK_EXIT_EVENT = "spectrum-quick-exit-change";
// A neutral, unremarkable destination. replace() drops the app from history.
const QUICK_EXIT_URL = "https://www.google.com";

export function readQuickExit() {
  try {
    return localStorage.getItem(QUICK_EXIT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeQuickExit(on) {
  try {
    if (on) localStorage.setItem(QUICK_EXIT_KEY, "1");
    else localStorage.removeItem(QUICK_EXIT_KEY);
  } catch { /* storage unavailable — the in-session toggle still updates via the event */ }
  try {
    window.dispatchEvent(new Event(QUICK_EXIT_EVENT));
  } catch { /* no window (SSR) — nothing to sync */ }
}

export default function QuickExitButton() {
  const plain = usePlainLanguage();
  const [enabled, setEnabled] = useState(() => readQuickExit());

  useEffect(() => {
    const sync = () => setEnabled(readQuickExit());
    // Same-tab: the Safety Center toggle dispatches this. Cross-tab: storage.
    window.addEventListener(QUICK_EXIT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(QUICK_EXIT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!enabled) return null;

  function leaveNow() {
    try {
      window.location.replace(QUICK_EXIT_URL);
    } catch {
      // Last resort if replace is unavailable for any reason.
      window.location.href = QUICK_EXIT_URL;
    }
  }

  return (
    <button
      type="button"
      onClick={leaveNow}
      aria-label={plain ? "Quick exit. Leave this site now." : "Quick exit — leave this site now"}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        left: "calc(env(safe-area-inset-left, 0px) + 10px)",
        zIndex: 2147483000, // above app chrome so it's always reachable in a panic
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        padding: "8px 14px",
        borderRadius: 10,
        border: `1px solid ${t.border}`,
        background: t.surface,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: t.shadow?.sm || "0 1px 4px rgba(0,0,0,0.18)",
      }}
    >
      <span aria-hidden="true">✕</span>
      {plain ? "Leave now" : "Quick exit"}
    </button>
  );
}
