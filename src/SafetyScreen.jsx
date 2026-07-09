import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { getMyReports, getBlockedUsers, unblockUser, withdrawReport } from "./api.js";
import Button from "./Button.jsx";
import { useFocusable } from "./useFocusable.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";

// Safety Center — entirely client-side. No backend calls. A calm, predictable
// place to prepare for the offline transition: meeting tips, ready-to-use
// scripts, a date-plan share, a check-in timer, and a generic help note.

const CHECKIN_KEY = "spectrum_safety_checkin";


// ----- shared style helpers -------------------------------------------------

const cardStyle = {
  background: t.surface,
  border: `1px solid ${t.border}`,
  borderRadius: 16,
  padding: "18px 18px",
  boxShadow: t.shadow.sm,
};

const sectionTitleStyle = {
  fontFamily: t.serif,
  fontSize: 20,
  fontWeight: 700,
  margin: "0 0 4px",
  color: t.text,
};

const sectionNoteStyle = {
  margin: "0 0 14px",
  fontSize: 14,
  color: t.textSoft,
};

function Section({ title, note, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      {note && <p style={sectionNoteStyle}>{note}</p>}
      {children}
    </section>
  );
}

function PrimaryButton({ children, onClick, disabled, full }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: t.accentFill,
        color: "#fff",
        opacity: disabled ? 0.6 : 1,
        width: full ? "100%" : "auto",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled, full }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.formBorder}`,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: t.green100,
        color: t.text,
        opacity: disabled ? 0.6 : 1,
        width: full ? "100%" : "auto",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// ----- 2. Scripts (copyable phrases) ----------------------------------------

const SCRIPTS = [
  { id: "break", label: "Needing a break", text: "I need a few quiet minutes. I'll be back shortly." },
  { id: "clarity", label: "Asking for clarity", text: "I'm not sure what you meant — could you say it directly?" },
  { id: "end-early", label: "Ending early, kindly", text: "I've enjoyed meeting you, and I'd like to head home now. Thank you." },
  { id: "decline", label: "Declining a second meeting", text: "Thank you, but I don't think we're a match. I wish you well." },
  { id: "sensory", label: "Setting a sensory need", text: "Bright/loud places are hard for me — could we sit somewhere quieter?" },
];

function ScriptCard({ script, copied, onCopy }) {
  const f = useFocusable();
  const isCopied = copied === script.id;
  return (
    <li style={{ listStyle: "none", marginBottom: 12 }}>
      <div style={{ ...cardStyle, borderLeft: `3px solid ${t.clay}`, background: t.sand }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, marginBottom: 6 }}>
          {script.label}
        </div>
        <blockquote
          style={{
            margin: "0 0 12px",
            fontSize: 16,
            color: t.text,
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          “{script.text}”
        </blockquote>
        <button
          type="button"
          onClick={() => onCopy(script)}
          {...f}
          style={{
            minHeight: 44,
            padding: "8px 16px",
            borderRadius: 10,
            border: `1px solid ${t.formBorder}`,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            background: isCopied ? t.surfaceAlt : t.surface,
            color: t.text,
            ...f.style,
          }}
        >
          {isCopied ? "Copied" : "Copy"}
        </button>
      </div>
    </li>
  );
}

// ----- helpers --------------------------------------------------------------

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    // writeText can reject with NotAllowedError (insecure context, denied
    // permission, document not focused). Swallow it and fall through to the
    // execCommand fallback so callers get a graceful `false`, never an
    // unhandled rejection (E4 / D2).
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy fallback below
    }
  }
  // Fallback for environments without (or denied) the async clipboard API.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ----- report status pill ---------------------------------------------------

// Map backend status → calm label + token colour.
const REPORT_STATUS = {
  open:      { label: "Open",      color: t.warningFill },
  reviewed:  { label: "Reviewed",  color: t.accentFill },
  actioned:  { label: "Actioned",  color: t.accentFill },
  dismissed: { label: "Dismissed", color: t.mutedFill },
  withdrawn: { label: "Withdrawn", color: t.mutedFill },
};

// Plain-language, shame-free outcome under the pill. Never surfaces the
// internal moderator_note — only reassuring copy keyed off status.
const REPORT_OUTCOME = {
  open: "Our team will take a look. There's nothing else you need to do.",
  reviewed: "Our team has reviewed this.",
  actioned: "Thanks for telling us — we reviewed this and took action.",
  dismissed:
    "We reviewed this and didn't find a policy violation this time. You did the right thing by telling us — and you can always block them.",
  withdrawn:
    "You withdrew this report. That's okay — you can report again anytime if you need to.",
};

function StatusPill({ status }) {
  const meta = REPORT_STATUS[status] || REPORT_STATUS.open;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        background: meta.color,
        letterSpacing: "0.01em",
        flexShrink: 0,
      }}
    >
      {meta.label}
    </span>
  );
}

function formatReportDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ----- main component -------------------------------------------------------

export default function SafetyScreen({ onBack }) {
  const plain = usePlainLanguage();
  const headingRef = useRef(null);

  // copy confirmations (scripts + plan)
  const [copiedScript, setCopiedScript] = useState(null);
  const [liveMessage, setLiveMessage] = useState("");

  // date plan form
  const [planName, setPlanName] = useState("");
  const [planWhere, setPlanWhere] = useState("");
  const [planWhen, setPlanWhen] = useState("");
  const [planCheckBy, setPlanCheckBy] = useState("");
  const [planStatus, setPlanStatus] = useState("");

  // Share-my-location — fully on-device: geolocation → share sheet / clipboard.
  // Nothing is sent to any server.
  const [locNote, setLocNote] = useState("");
  const [locStatus, setLocStatus] = useState("");
  const [locBusy, setLocBusy] = useState(false);

  // check-in timer — { endsAt } persisted in localStorage
  const [endsAt, setEndsAt] = useState(() => {
    try {
      const raw = localStorage.getItem(CHECKIN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.endsAt === "number" ? parsed.endsAt : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(false);

  // "Your reports" (backlog #10) — fetched on mount.
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);

  // Blocked people — fetched on mount; supports unblock.
  const [blocked, setBlocked] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [blockedError, setBlockedError] = useState(false);
  const [unblocking, setUnblocking] = useState(null);

  // --- ALL hooks declared before any early return ---

  useEffect(() => {
    let active = true;
    getMyReports()
      .then((list) => { if (active) setReports(Array.isArray(list) ? list : []); })
      .catch(() => { if (active) setReportsError(true); })
      .finally(() => { if (active) setReportsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getBlockedUsers()
      .then((list) => { if (active) setBlocked(Array.isArray(list) ? list : []); })
      .catch(() => { if (active) setBlockedError(true); })
      .finally(() => { if (active) setBlockedLoading(false); });
    return () => { active = false; };
  }, []);

  const handleUnblock = useCallback(async (userId, name) => {
    setUnblocking(userId);
    try {
      await unblockUser(userId);
      setBlocked((prev) => prev.filter((b) => b.userId !== userId));
      setLiveMessage(`Unblocked ${name}.`);
    } catch {
      setLiveMessage(`Couldn't unblock ${name}. Please try again.`);
    } finally {
      setUnblocking(null);
    }
  }, []);

  const handleWithdraw = useCallback(async (reportId, name) => {
    // Gentle, shame-free confirm — it's okay to change your mind.
    const ok = window.confirm(
      "Withdraw this report? Our team won't review it.\n\nIt's okay to change your mind."
    );
    if (!ok) return;
    setWithdrawing(reportId);
    try {
      await withdrawReport(reportId);
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, status: "withdrawn" } : r))
      );
      setLiveMessage(`Report about ${name} withdrawn.`);
    } catch {
      setLiveMessage("Couldn't withdraw that report. Please try again.");
    } finally {
      setWithdrawing(null);
    }
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Tick once a second while a timer is active.
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  // When the timer elapses: show banner, optionally fire a notification.
  useEffect(() => {
    if (!endsAt) {
      setElapsed(false);
      return;
    }
    if (now >= endsAt) {
      setElapsed(true);
    }
  }, [now, endsAt]);

  useEffect(() => {
    if (!elapsed) return;
    // Only use notifications if permission was ALREADY granted. Never prompt.
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification("Spectrum — time to check in", {
          body: "Your check-in time is here. Open the app when you're ready.",
        });
      } catch {
        // Some browsers require a service worker for notifications; ignore.
      }
    }
  }, [elapsed]);

  const announce = useCallback((msg) => {
    setLiveMessage("");
    // Force the aria-live region to re-announce even if the text repeats.
    requestAnimationFrame(() => setLiveMessage(msg));
  }, []);

  const handleCopyScript = useCallback(
    async (script) => {
      const ok = await copyText(script.text);
      if (ok) {
        setCopiedScript(script.id);
        announce("Copied to clipboard.");
        setTimeout(() => setCopiedScript((c) => (c === script.id ? null : c)), 2500);
      } else {
        announce("Couldn't copy. You can select the text and copy it manually.");
      }
    },
    [announce]
  );

  const buildPlanText = useCallback(() => {
    const lines = ["My date plan:"];
    lines.push(`• Meeting: ${planName.trim() || "(not set)"}`);
    lines.push(`• Where: ${planWhere.trim() || "(not set)"}`);
    lines.push(`• When: ${planWhen ? new Date(planWhen).toLocaleString() : "(not set)"}`);
    if (planCheckBy) {
      lines.push(`• Please check on me by: ${planCheckBy}`);
    }
    lines.push("");
    lines.push("Sent from Spectrum. If you don't hear from me, please reach out.");
    return lines.join("\n");
  }, [planName, planWhere, planWhen, planCheckBy]);

  const handleSharePlan = useCallback(async () => {
    const text = buildPlanText();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setPlanStatus("");
        return;
      } catch (e) {
        // User cancelled the share sheet — say nothing, fall through only on real failure.
        if (e && e.name === "AbortError") {
          setPlanStatus("");
          return;
        }
      }
    }
    const ok = await copyText(text);
    setPlanStatus(
      ok
        ? "Copied — paste it to a trusted person."
        : "Couldn't share or copy. You can write it down manually."
    );
  }, [buildPlanText]);

  const handleShareLocation = useCallback(() => {
    if (!("geolocation" in navigator) || !navigator.geolocation) {
      setLocStatus(
        "Location isn't available on this device. You can share your address manually."
      );
      return;
    }
    setLocBusy(true);
    setLocStatus("");

    const onSuccess = async (pos) => {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      const parts = [];
      const note = locNote.trim();
      if (note) parts.push(note);
      parts.push(`My current location: https://www.google.com/maps?q=${lat},${lng}`);
      parts.push("Sent from Spectrum Dating's Safety Center.");
      const text = parts.join("\n");

      if (navigator.share) {
        try {
          await navigator.share({ text });
          setLocStatus("");
          setLocBusy(false);
          return;
        } catch (e) {
          // User cancelled the share sheet — say nothing. Only fall through on a real failure.
          if (e && e.name === "AbortError") {
            setLocStatus("");
            setLocBusy(false);
            return;
          }
        }
      }
      const ok = await copyText(text);
      setLocStatus(
        ok
          ? "Location copied — paste it to your trusted contact."
          : "Couldn't share or copy. You can share your address manually."
      );
      setLocBusy(false);
    };

    const onError = (err) => {
      if (err && err.code === err.PERMISSION_DENIED) {
        setLocStatus(
          "Location permission is off. You can turn it on in your browser settings, or share your address manually."
        );
      } else {
        setLocStatus(
          "Couldn't get your location just now. Please try again, or share your address manually."
        );
      }
      setLocBusy(false);
    };

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    } catch {
      // Some browsers throw synchronously in insecure contexts.
      setLocStatus(
        "Couldn't get your location just now. Please try again, or share your address manually."
      );
      setLocBusy(false);
    }
  }, [locNote]);

  const startTimer = useCallback((ms) => {
    const target = Date.now() + ms;
    setEndsAt(target);
    setNow(Date.now());
    setElapsed(false);
    try {
      localStorage.setItem(CHECKIN_KEY, JSON.stringify({ endsAt: target }));
    } catch {
      // localStorage may be unavailable (private mode); timer still works this session.
    }
  }, []);

  // Start a timer that ends at a "HH:MM" wall-clock time today (or tomorrow if past).
  const startTimerAtClock = useCallback(
    (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return;
      const target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      startTimer(target.getTime() - Date.now());
    },
    [startTimer]
  );

  const cancelTimer = useCallback(() => {
    setEndsAt(null);
    setElapsed(false);
    try {
      localStorage.removeItem(CHECKIN_KEY);
    } catch {
      // ignore
    }
  }, []);

  const dismissBanner = useCallback(() => {
    cancelTimer();
  }, [cancelTimer]);

  // --- styles ---
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

  const labelStyle = { display: "block", fontSize: 14, fontWeight: 600, color: t.textSoft, marginBottom: 6 };
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 44,
    padding: "10px 12px",
    // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
    fontSize: 16,
    color: t.text,
    background: t.surface,
    border: `1px solid ${t.formBorder}`,
    borderRadius: 10,
    marginBottom: 14,
  };

  const timerActive = !!endsAt;
  const remaining = timerActive ? endsAt - now : 0;
  const showBanner = elapsed && timerActive;

  return (
    <div style={page}>
      {/* aria-live region for copy / share confirmations */}
      <div role="status" aria-live="polite" aria-atomic="true" style={{
        position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
        overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
      }}>
        {liveMessage}
      </div>

      <div style={shell}>
        {/* Back control */}
        <Button variant="secondary" onClick={onBack}>← Back</Button>

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          {plain ? "Safety" : "Safety Center"}
        </h1>
        <p style={{ margin: "0 0 26px", fontSize: 16, color: t.textSoft }}>
          {plain
            ? "A calm place to get ready to meet someone in person. Everything stays on your device unless you choose to share it."
            : "A calm place to prepare for meeting someone offline. Everything here stays on your device — nothing is sent anywhere unless you choose to share it."}
        </p>

        {/* Check-in banner (prominent, calm) when timer elapses */}
        {showBanner && (
          <div
            role="alert"
            style={{
              background: t.warningSurface,
              border: `1px solid ${t.warning}`,
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span style={{ flex: 1, fontSize: 16, color: t.warningSurfaceText, fontWeight: 600 }}>
              {plain ? "Time to check in. Are you safe? Tap to close." : "Time to check in — are you safe? Tap to dismiss."}
            </span>
            <Button variant="secondary" onClick={dismissBanner}>Dismiss</Button>
          </div>
        )}

        {/* 1. Meeting safely */}
        <Section
          title="Meeting safely"
          note={plain ? "A few things that help the first time you meet." : "A few simple things that help the first time you meet."}
        >
          <ul style={{ ...cardStyle, margin: 0, paddingLeft: 36, paddingRight: 18 }}>
            <li style={{ marginBottom: 8 }}>{plain ? "Meet in a public place the first time." : "Meet somewhere public the first time."}</li>
            <li style={{ marginBottom: 8 }}>Tell someone where you'll be and who you're meeting.</li>
            <li style={{ marginBottom: 8 }}>{plain ? "Plan your own way there and back." : "Arrange your own way there and back."}</li>
            <li style={{ marginBottom: 8 }}>{plain ? "You can leave any time. You don't have to explain why." : "You can leave at any time — you don't owe anyone an explanation."}</li>
            <li style={{ marginBottom: 0 }}>{plain ? "Trust yourself. If something feels wrong, it's okay to leave." : "Trust your gut. If something feels off, it's okay to go."}</li>
          </ul>
        </Section>

        {/* 2. What to say */}
        <Section
          title="What to say"
          note={plain ? "Phrases you can use when words are hard. Read them, or copy one to keep." : "Ready-to-use phrases for moments that can be hard to put into words. Read them, or copy one to keep handy."}
        >
          <ul style={{ margin: 0, padding: 0 }}>
            {SCRIPTS.map((s) => (
              <ScriptCard
                key={s.id}
                script={s}
                copied={copiedScript}
                onCopy={handleCopyScript}
              />
            ))}
          </ul>
        </Section>

        {/* 3. Share a date plan */}
        <Section
          title="Share a date plan"
          note={plain ? "Fill this in and share it with someone you trust. It only leaves your device when you share it." : "Fill this in and share it with a trusted person. It only leaves your device through your own share sheet."}
        >
          <div style={cardStyle}>
            <label style={labelStyle} htmlFor="plan-name">Who you're meeting</label>
            <input
              id="plan-name"
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Their name"
              style={inputStyle}
            />

            <label style={labelStyle} htmlFor="plan-where">Where</label>
            <input
              id="plan-where"
              type="text"
              value={planWhere}
              onChange={(e) => setPlanWhere(e.target.value)}
              placeholder="Café, park, address…"
              style={inputStyle}
            />

            <label style={labelStyle} htmlFor="plan-when">Date & time</label>
            <input
              id="plan-when"
              type="datetime-local"
              value={planWhen}
              onChange={(e) => setPlanWhen(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle} htmlFor="plan-checkby">{plain ? "Check I'm okay by" : "Ask me if I'm okay by"}</label>
            <input
              id="plan-checkby"
              type="time"
              value={planCheckBy}
              onChange={(e) => setPlanCheckBy(e.target.value)}
              style={{ ...inputStyle, marginBottom: 18 }}
            />

            <Button variant="primary" onClick={handleSharePlan} style={{ width: "100%" }}>{plain ? "Share this plan" : "Share plan"}</Button>
            {planStatus && (
              <p role="status" aria-live="polite" style={{ margin: "12px 0 0", fontSize: 14, color: t.textSoft }}>
                {planStatus}
              </p>
            )}
          </div>
        </Section>

        {/* Share my location — on-device geolocation → share sheet, nothing stored */}
        <Section
          title="Share my location"
          note={plain ? "If you feel unsafe, share where you are with someone you trust. Your phone reads your location and only shares it when you choose. We never see it or store it." : "If you ever feel unsafe, share where you are with someone you trust. Your location is read on your device and only leaves it through your own share sheet — we never see it or store it."}
        >
          <div style={cardStyle}>
            <label style={labelStyle} htmlFor="loc-note">A note (optional)</label>
            <input
              id="loc-note"
              type="text"
              value={locNote}
              onChange={(e) => setLocNote(e.target.value)}
              placeholder="I'm on a date at…"
              style={{ ...inputStyle, marginBottom: 18 }}
            />

            <Button
              variant="primary"
              onClick={handleShareLocation}
              disabled={locBusy}
              style={{ width: "100%" }}
            >
              {locBusy ? "Getting your location…" : (plain ? "Share where I am" : "Share my current location")}
            </Button>
            {locStatus && (
              <p role="status" aria-live="polite" style={{ margin: "12px 0 0", fontSize: 14, color: t.textSoft }}>
                {locStatus}
              </p>
            )}
          </div>
        </Section>

        {/* 4. Check-in timer */}
        <Section
          title="Check-in timer"
          note={plain ? "Set a quiet reminder to check in with yourself. We'll show a calm banner when the time is up." : "Set a quiet reminder to check in with yourself. We'll show a gentle banner when the time is up."}
        >
          <div style={cardStyle}>
            {timerActive ? (
              <div>
                <div style={{ fontSize: 14, color: t.textSoft, marginBottom: 6 }}>
                  {elapsed ? "Time's up." : "Time remaining:"}
                </div>
                <div
                  aria-live="off"
                  style={{
                    fontFamily: t.serif,
                    fontSize: 34,
                    fontWeight: 700,
                    color: t.text,
                    marginBottom: 16,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatDuration(remaining)}
                </div>
                <SecondaryButton onClick={cancelTimer} full>{plain ? "Stop timer" : "Cancel timer"}</SecondaryButton>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <SecondaryButton onClick={() => startTimer(60 * 60 * 1000)}>1 hour</SecondaryButton>
                <SecondaryButton onClick={() => startTimer(2 * 60 * 60 * 1000)}>2 hours</SecondaryButton>
                <SecondaryButton onClick={() => startTimer(3 * 60 * 60 * 1000)}>3 hours</SecondaryButton>
                {planCheckBy && (
                  <SecondaryButton onClick={() => startTimerAtClock(planCheckBy)}>
                    By {planCheckBy} (from plan)
                  </SecondaryButton>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* Your privacy (backlog #9) — advertises the no-presence design. */}
        <Section title="Your privacy">
          <div style={{ ...cardStyle, color: t.textSoft, fontSize: 16, lineHeight: 1.65 }}>
            {plain
              ? "We never show when you're online, when you were last here, or if you've read a message. You never have to reply fast."
              : "We never show when you're online, when you were last active, or whether you've read a message. You're never put on the spot to reply quickly."}
          </div>
        </Section>

        {/* Your reports (backlog #10) */}
        <Section
          title="Your reports"
          note={plain ? "When you report someone, our team looks at it. You'll see updates here." : "When you report someone, our team reviews it. You'll see the status update here."}
        >
          <div style={cardStyle}>
            {reportsLoading ? (
              <p style={{ margin: 0, fontSize: 16, color: t.textSoft }}>Loading your reports…</p>
            ) : reportsError ? (
              <p role="alert" style={{ margin: 0, fontSize: 16, color: t.textSoft }}>
                {plain ? "Could not load your reports. Please try again later." : "Couldn't load your reports right now. Please try again later."}
              </p>
            ) : reports.length === 0 ? (
              <p style={{ margin: 0, fontSize: 16, color: t.textSoft }}>
                You haven't reported anyone.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {reports.map((r, i) => (
                  <li
                    key={r.id ?? i}
                    style={{
                      padding: "12px 0",
                      borderTop: i === 0 ? "none" : `1px solid ${t.borderLight}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>
                          {r.reportedName || "Someone"}
                        </div>
                        {r.reason && (
                          <div style={{ fontSize: 14, color: t.textSoft, marginTop: 2 }}>
                            {r.reason}
                          </div>
                        )}
                        {formatReportDate(r.createdAt) && (
                          <div style={{ fontSize: 14, color: t.textMuted, marginTop: 2 }}>
                            Reported {formatReportDate(r.createdAt)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                        <StatusPill status={r.status} />
                        {r.status === "open" && (
                          <Button
                            variant="secondary"
                            onClick={() => handleWithdraw(r.id, r.reportedName || "this person")}
                            disabled={withdrawing === r.id}
                          >
                            {withdrawing === r.id ? "Withdrawing…" : (plain ? "Take back" : "Withdraw")}
                          </Button>
                        )}
                      </div>
                    </div>
                    {(REPORT_OUTCOME[r.status] || REPORT_OUTCOME.open) && (
                      <p style={{ margin: "8px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
                        {REPORT_OUTCOME[r.status] || REPORT_OUTCOME.open}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {/* Blocked people — review + undo */}
        <Section
          title="Blocked people"
          note={plain ? "People you block can't see your profile or message you. You can unblock anyone here." : "People you've blocked can't see your profile or message you. You can unblock anyone here."}
        >
          <div style={cardStyle}>
            {blockedLoading ? (
              <p style={{ margin: 0, fontSize: 16, color: t.textSoft }}>Loading your blocked list…</p>
            ) : blockedError ? (
              <p role="alert" style={{ margin: 0, fontSize: 16, color: t.textSoft }}>
                {plain ? "Could not load your blocked list. Please try again later." : "Couldn't load your blocked list right now. Please try again later."}
              </p>
            ) : blocked.length === 0 ? (
              <p style={{ margin: 0, fontSize: 16, color: t.textSoft }}>
                You haven't blocked anyone.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {blocked.map((b, i) => (
                  <li
                    key={b.userId ?? i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 0",
                      borderTop: i === 0 ? "none" : `1px solid ${t.borderLight}`,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.text, minWidth: 0 }}>
                      {b.displayName || "Someone"}
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => handleUnblock(b.userId, b.displayName || "this person")}
                      disabled={unblocking === b.userId}
                      style={{ flexShrink: 0 }}
                    >
                      {unblocking === b.userId ? "Unblocking…" : "Unblock"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {/* 5. If you need help — named, real resources (not boilerplate). A
            staffed safety program points at concrete places to get help. */}
        <Section title="If you need help">
          <div style={{ ...cardStyle, color: t.textSoft, fontSize: 16, lineHeight: 1.65 }}>
            <p style={{ margin: "0 0 12px" }}>
              If you are in immediate danger, call your local emergency services
              (<strong style={{ color: t.text }}>911</strong> in the US).
            </p>
            <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
              <li style={{ marginBottom: 6 }}>
                <strong style={{ color: t.text }}>988 Suicide &amp; Crisis Lifeline</strong> (US) —
                call or text <strong style={{ color: t.text }}>988</strong>, any time, free.
              </li>
              <li style={{ marginBottom: 6 }}>
                <strong style={{ color: t.text }}>Crisis Text Line</strong> — text{" "}
                <strong style={{ color: t.text }}>HOME</strong> to{" "}
                <strong style={{ color: t.text }}>741741</strong> (US) to reach a trained counselor.
              </li>
              <li>
                <strong style={{ color: t.text }}>Love Is Respect</strong> (dating abuse, US) —
                call 1-866-331-9474 or text <strong style={{ color: t.text }}>LOVEIS</strong> to 22522.
              </li>
            </ul>
            <p style={{ margin: 0 }}>
              Inside Spectrum, you can block or report anyone from their profile or
              your conversation — our team reviews every report. For anything else,
              reach us via <strong style={{ color: t.text }}>Settings → Send feedback</strong>.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
