import { useState, useEffect, useRef, useCallback } from "react";
import {
  getAdminStats, getQueueCounts, getAdminReports, reportAction, suspendUser, warnUser, banUser, unbanUser, getPendingAttachments,
  reviewAttachment, getPendingProfilePhotos, reviewProfilePhoto, verifyUser, getAuditLog,
  getAdminFeedback, getVerificationRequests, purgeTestAccounts, getReportContext, safeErrorMessage,
  getTelemetryOverview, getTelemetryGeo, getTelemetryReferrers, getTelemetryUptime,
  getMemberDomains, getMembers, getMemberDetail, setDemoData, getActivityTrends,
  getServerHealth, getPopulation, getTransparency, getQaSample, submitQaReview,
  getMyEntitlement, adminSetEntitlement, adminSetSelfEntitlement, adminClearDemoEntitlements,
  adminSetUserRole, getUserId,
  getPendingProfileAudio, reviewProfileAudio, getAudioPlaybackUrl,
} from "./api.js";
import { t } from "./tokens.js";
import { formatAudioDuration } from "./AudioAnswer.jsx";
import Skeleton from "./Skeleton.jsx";
import ErrorState from "./ErrorState.jsx";
import SectionRule from "./SectionRule.jsx";
import Sparkline from "./Sparkline.jsx";
import RankedBars from "./RankedBars.jsx";
import { formatUptimePct } from "./chartMath.js";
import { useFocusable } from "./useFocusable.js";
import { waitingLabel, oldestLabel, accountAgeLabel, isPastSla, formatDuration, oldestEpoch } from "./adminFormat.js";

// Moderation dashboard — autism-friendly: calm, low-stimulation, clear states.
// Reds reserved for genuinely destructive actions (suspend). Numbers are static,
// grounded, and stamped with an "Updated HH:MM" — never a live ticker.

// `reviewed` is retired as an offered outcome (the atomic Dismiss/Warn/Ban
// actions ARE the resolution). Legacy reviewed rows still surface under "All".
const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

// Moderation redesign v1 — the report card now resolves a case with ONE of three
// atomic actions (each records the outcome AND closes the report in one step, via
// POST /admin/reports/:id/action). The old "Resolve report" dropdown (Reviewed /
// Actioned / Dismissed) is gone — the action IS the resolution. `reviewed` is
// retired as an offered outcome; legacy reviewed rows still render read-only, and
// a moderator who isn't ready uses "Skip for now" (client-side navigation).

function formatTimestamp(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatClock(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Turn any action error into calm, user-safe copy. 409 (a second moderator got
// there first) is special-cased — the caller also refetches, NOT a retry loop.
// A 400 from the note-required guards carries admin-facing copy that's safe to
// show; everything else falls back through safeErrorMessage.
function actionErrorMessage(err, fallback) {
  if (err && err.status === 409) return "This was already handled by another moderator.";
  if (err && err.status === 400 && typeof err.message === "string" && err.message) return err.message;
  return safeErrorMessage(err, fallback);
}

// F-D: reviewed vs actioned are now visually DISTINCT (they shared accentFill).
// actioned = solid green; reviewed = a soft outlined pill; dismissed = neutral
// gray; open = amber. The badge always carries the WORD (never color-only).
function statusBadgeStyle(status) {
  switch (status) {
    case "open": return { background: t.warningFill, color: "#fff", border: `1px solid ${t.warningFill}` };
    case "reviewed": return { background: t.surfaceAlt, color: t.text, border: `1px solid ${t.border}` };
    case "actioned": return { background: t.accentFill, color: "#fff", border: `1px solid ${t.accentFill}` };
    case "dismissed": return { background: t.mutedFill, color: "#fff", border: `1px solid ${t.mutedFill}` };
    default: return { background: t.mutedFill, color: "#fff", border: `1px solid ${t.mutedFill}` };
  }
}

function StatusBadge({ status }) {
  return (
    <span
      style={{
        fontSize: 13, fontWeight: 600, textTransform: "capitalize", borderRadius: 20,
        padding: "3px 10px", letterSpacing: "0.02em", ...statusBadgeStyle(status),
      }}
    >
      {status}
    </span>
  );
}

// Shared queue-list hook — dedups the load/loading/error/reload boilerplate that
// was copy-pasted across every queue. `token` bumps from the parent to force a
// refetch (Refresh button, post-action refresh) so a second moderator's work
// shows instead of an optimistic local remove. The fetcher is held in a ref so
// callers can pass an inline arrow without re-triggering the effect.
function useAdminList(fetcher, token) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload, token]);

  return { items, loading, error, reload };
}

// Object-shaped sibling of useAdminList — same load/loading/error + token-driven
// refetch contract, but keeps the raw response object (telemetry overview /
// uptime, the paginated member listing) instead of coercing to an array. The
// fetcher is held in a ref so callers can pass an inline arrow that closes over
// the current window/demo/query without re-triggering the effect; `token` (a
// string keying those params) drives the refetch.
function useAdminResource(fetcher, token) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload, token]);

  return { data, loading, error, reload };
}

// ─── Collapsible section (used by the Members filters + Insights breakdowns) ─
// Same disclosure pattern the profile screen uses: a real <button> header with
// aria-expanded/aria-controls, a 44px target + focus ring, keyboard toggle, and
// a chevron that rotates (gated on prefers-reduced-motion). Open/closed is owned
// by the caller (local component state) — the v2 areas are the primary nav, so
// there are no more page-level always-open dashboard zones to persist.

// Mirrors ProfileScreen's usePrefersReduced — chevron rotation is the only
// motion here, and it must honor the OS reduce-motion preference.
function useAdminPrefersReduced() {
  const [prefersReduced, setPrefersReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return prefersReduced;
}

// A single collapsible dashboard zone. Flat (no card wrapper) so it drops in for
// the existing `<h2 style={zoneHeading}>` + content pattern without card-in-card
// heaviness. The panel stays MOUNTED and is toggled via the `hidden` attribute
// (keeps child fetch state alive), exactly like profile's CollapsibleSection.
function AdminCollapsible({ id, title, open, onToggle, style, children }) {
  const f = useFocusable();
  const prefersReduced = useAdminPrefersReduced();
  const buttonId = `admin-section-${id}-button`;
  const panelId = `admin-section-${id}-panel`;
  return (
    <div style={style}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        style={{
          width: "100%", minHeight: 44, display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 12, background: "transparent",
          border: "none", padding: "4px 0", textAlign: "left", cursor: "pointer",
          font: "inherit", color: "inherit", ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.textMuted }}>
          {title}
        </span>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0, fontSize: 16, lineHeight: 1, color: t.textMuted,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: prefersReduced ? "none" : "transform 180ms cubic-bezier(0.2,0,0,1)",
          }}
        >
          ⌄
        </span>
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} style={{ marginTop: open ? 10 : 0 }}>
        {children}
      </div>
    </div>
  );
}

// Calm placeholder cards shown while reports load.
function ReportsSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
            padding: "18px 20px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <Skeleton width="35%" height={16} />
          <Skeleton width="80%" height={13} />
          <Skeleton width="60%" height={13} />
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ children }) {
  return (
    <div
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
        padding: "28px 24px", textAlign: "center", color: t.textSoft,
      }}
    >
      {children}
    </div>
  );
}

function SegmentedControl({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Filter reports by status"
      style={{
        display: "flex", gap: 4, background: t.surfaceAlt, border: `1px solid ${t.borderLight}`,
        borderRadius: 12, padding: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "thin",
      }}
    >
      {STATUS_FILTERS.map((f) => (
        <SegmentButton key={f.value} label={f.label} active={value === f.value} onClick={() => onChange(f.value)} />
      ))}
    </div>
  );
}

function SegmentButton({ label, active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        flex: "1 0 auto", whiteSpace: "nowrap", minHeight: 44, padding: "8px 10px", borderRadius: 9,
        border: "none", cursor: "pointer", fontSize: 14, fontWeight: active ? 600 : 500,
        background: active ? t.surface : "transparent", color: active ? t.text : t.textSoft,
        boxShadow: active ? t.shadow.sm : "none", ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {label}
    </button>
  );
}

function PlainButton({ children, onClick, kind = "neutral", disabled, buttonRef, ariaLabel, emphasis }) {
  const f = useFocusable();
  const kinds = {
    neutral: { background: t.surface, color: t.text, border: `1px solid ${t.border}` },
    accent: { background: t.accentFill, color: "#fff", border: `1px solid ${t.accentFill}` },
    danger: { background: t.dangerFill, color: "#fff", border: `1px solid ${t.dangerFill}` },
    quiet: { background: "transparent", color: t.textSoft, border: `1px solid ${t.border}` },
  };
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        minHeight: 44, padding: "9px 16px", borderRadius: 11, fontSize: 14, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
        // `emphasis` marks a pre-selected (suggested) action with a calm ring —
        // boxShadow, not outline, so it never fights the focus outline above.
        ...(emphasis ? { boxShadow: `0 0 0 2px ${t.accentFill}` } : {}),
        ...kinds[kind], ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {children}
    </button>
  );
}

// StatCard — a single grounded number + label. Optional `subtext` (e.g. "oldest
// 3 days"), `tone="amber"` for a past-SLA backlog (never red), `muted` for the
// de-emphasized Community-health zone, and `onClick` to make it a tappable jump
// into a queue/filter (rendered as a real <button> with a focus ring).
function StatCard({ label, value, subtext, tone, onClick, ariaLabel, muted }) {
  const f = useFocusable();
  const amber = tone === "amber";
  const body = (
    <>
      <div style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, color: amber ? t.warningSurfaceText : t.text, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 14, color: t.textMuted, marginTop: 4 }}>{label}</div>
      {subtext ? (
        <div style={{ fontSize: 13, color: amber ? t.warningSurfaceText : t.textMuted, marginTop: 4 }}>{subtext}</div>
      ) : null}
    </>
  );
  const base = {
    background: amber ? t.warningSurface : (muted ? t.surfaceAlt : t.surface),
    border: `1px solid ${amber ? t.warningBorder : t.border}`,
    borderRadius: 14, padding: "14px 16px", minWidth: 96, boxShadow: muted ? "none" : t.shadow.sm,
  };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        style={{ ...base, textAlign: "left", cursor: "pointer", font: "inherit", ...f.style }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        {body}
      </button>
    );
  }
  return <div style={base}>{body}</div>;
}

// P1-A — read-only reported-conversation view, lazily fetched on reveal.
function ReportedContext({ reportId, reportedName, reportedAudioTranscript }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const f = useFocusable();

  // B1 — the reported voice-note transcript (context value wins once fetched;
  // else the value carried on the report card). Drives the audio-evidence block
  // and suppresses the "no conversation" empty state that would otherwise show
  // for an audio report (which has no conversation by design).
  const transcript = data?.reportedAudioTranscript ?? reportedAudioTranscript ?? null;
  const isAudioReport = !!transcript;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError("");
      getReportContext(reportId)
        .then(setData)
        .catch(() => setError("Couldn't load the conversation. Please try again."))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          minHeight: 44, padding: "9px 14px", borderRadius: 11, fontSize: 14, fontWeight: 600,
          background: "transparent", color: t.accentStrong, border: `1px solid ${t.border}`, cursor: "pointer",
          ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        {isAudioReport
          ? (open ? "Hide reported voice note" : "View reported voice note")
          : (open ? "Hide reported messages" : "View reported messages")}
      </button>

      {open && (
        <div style={{ marginTop: 12, border: `1px solid ${t.borderLight}`, borderRadius: 12, padding: "12px 14px", background: t.bg }}>
          {/* B1 — reported voice-note transcript. An audio report has NO
              conversation, so this snapshotted transcript is the evidence.
              Prefer the freshly-fetched context value; fall back to the value
              carried on the list card so it shows even before the fetch lands.
              Styled like the pinnedMessage evidence block, but calm (not the
              danger-red "flagged" treatment) — it's evidence, not an alarm. */}
          {transcript && (
            <div
              style={{
                background: t.surfaceAlt,
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: t.textSoft, marginBottom: 4, letterSpacing: "0.02em" }}>
                <span aria-hidden="true">🎙 </span>Reported voice note — transcript
              </div>
              <p style={{ margin: 0, fontSize: 16, color: t.text, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {transcript}
              </p>
            </div>
          )}
          {/* Needed #10 — the reporter-pinned message, surfaced prominently at the
              top of the evidence so the moderator sees exactly what was flagged
              even when it fell outside the live-conversation window below. */}
          {!loading && !error && data && data.pinnedMessage && (
            <div
              style={{
                background: t.warningSurface,
                border: `2px solid ${t.dangerFill}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: t.dangerFill, marginBottom: 4, letterSpacing: "0.02em" }}>
                <span aria-hidden="true">⚑ </span>Reporter flagged this message
              </div>
              <p style={{ margin: 0, fontSize: 16, color: t.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {data.pinnedMessage}
              </p>
            </div>
          )}
          {loading ? (
            <div aria-hidden="true"><Skeleton width="70%" height={13} /><div style={{ height: 8 }} /><Skeleton width="55%" height={13} /></div>
          ) : error ? (
            <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{error}</p>
          ) : data && data.live && data.messages.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {data.messages.map((m) => (
                <li
                  key={m.id}
                  style={{
                    listStyle: "none",
                    background: m.fromReported ? t.warningSurface : t.surface,
                    // Needed #10 — the reporter-pinned message gets a distinct,
                    // stronger outline so the moderator sees exactly what was
                    // flagged inside the surrounding context.
                    border: m.pinned
                      ? `2px solid ${t.dangerFill}`
                      : `1px solid ${m.fromReported ? t.warningBorder : t.borderLight}`,
                    borderRadius: 10, padding: "8px 12px",
                  }}
                >
                  {m.pinned && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.dangerFill, marginBottom: 4, letterSpacing: "0.02em" }}>
                      <span aria-hidden="true">⚑ </span>Reporter flagged this message
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.textSoft }}>
                    {m.senderName || m.senderEmail || "Someone"}
                    {m.fromReported && (
                      <span style={{ color: t.warningSurfaceText, fontWeight: 600, marginLeft: 8 }}>· reported member</span>
                    )}
                  </div>
                  {m.deleted ? (
                    <p style={{ margin: "4px 0 0", fontSize: 15, color: t.textMuted, fontStyle: "italic" }}>(message deleted)</p>
                  ) : m.body ? (
                    <p style={{ margin: "4px 0 0", fontSize: 16, color: t.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.body}</p>
                  ) : null}
                  {m.attachments && m.attachments.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {m.attachments.map((a) => (
                        <span key={a.id} style={{ fontSize: 13, color: t.textMuted }}>
                          <span aria-hidden="true">📎 </span>
                          Photo attachment{a.status ? ` (${String(a.status).replace(/_/g, " ")})` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{formatTimestamp(m.createdAt)}</div>
                </li>
              ))}
            </ul>
          ) : isAudioReport ? (
            // Audio report: the transcript block above IS the evidence; there is
            // no conversation to fall back to, so show nothing misleading here.
            null
          ) : data && (data.snapshot || !data.live) ? (
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: t.textMuted, fontStyle: "italic" }}>
                Conversation no longer available — showing saved evidence.
              </p>
              {data.snapshot ? (
                <div style={{ background: t.warningSurface, border: `1px solid ${t.warningBorder}`, borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.textSoft }}>{reportedName || "Reported member"}</div>
                  <p style={{ margin: "4px 0 0", fontSize: 16, color: t.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{data.snapshot}</p>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: t.textSoft }}>No saved message evidence for this report.</p>
              )}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: t.textSoft }}>No conversation is linked to this report.</p>
          )}
        </div>
      )}
    </div>
  );
}

// P1-B — calm, non-alarming repeat-offender line built from the serialized
// per-report counts (no extra fetch). Rendered muted; always present.
function RepeatOffenderLine({ report }) {
  const total = report.reportedReportCount ?? 0;
  const prior = Math.max(0, total - 1); // exclude the current report
  const actioned = report.reportedActionedCount ?? 0;
  const blocked = report.reportedBlockedByCount ?? 0;
  const signals = report.reportedChatSignalCount ?? 0;
  const age = accountAgeLabel(report.reportedCreatedAt);
  const parts = [
    `${prior} prior report${prior === 1 ? "" : "s"} against this member (${actioned} actioned)`,
    `blocked by ${blocked}`,
  ];
  if (age) parts.push(`account age ${age}`);
  return (
    <p style={{ margin: "10px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
      {parts.join(" · ")}
      {signals > 0 && (
        <>
          {" · "}
          {/* Needed #4 — off-platform/money chat signals: calm muted amber, never
              alarm-red. Only shown when present. */}
          <span style={{ color: t.warningFill }}>
            ⚠ {signals} off-platform/money signal{signals === 1 ? "" : "s"} in chats
          </span>
        </>
      )}
    </p>
  );
}

// Needed #7/#11 — enforcement-ladder controls + current state, shared by the
// report card and the member drawer. Renders the member's enforcement state
// (banned / suspended / warned N times) + the latest reason, then Warn and Ban
// (or Unban) actions. `includeSuspend` additionally renders Suspend/Unsuspend
// (the drawer has no other suspend control; the report card keeps its own, so it
// passes includeSuspend={false}). Every action requires a note; Ban/Unban carry
// a danger-styled confirm. All hooks run before any early return (React #310).
function EnforcementActions({
  userId, userName, banned, suspended, warnCount = 0, latestNotice,
  includeSuspend = false, onChanged, onStatus,
}) {
  const [panel, setPanel] = useState(null); // null | 'warn' | 'ban' | 'unban' | 'suspend'
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const fNote = useFocusable();
  const noteRef = useRef(null);
  const name = userName || "this member";

  useEffect(() => { if (panel) noteRef.current?.focus(); }, [panel]);

  function openPanel(which) { setNote(""); setLocalError(""); setPanel(which); }
  function closePanel() { setPanel(null); setNote(""); }

  async function run(fn, successMsg) {
    setBusy(true);
    setLocalError("");
    try {
      await fn();
      onStatus?.(successMsg);
      setPanel(null);
      setNote("");
      onChanged?.();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this account. Please try again."));
      if (err && err.status === 409) onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  const confirmAction = () => {
    if (!note.trim()) return;
    if (panel === "warn") return run(() => warnUser(userId, note.trim()), `${name} has been warned.`);
    if (panel === "ban") return run(() => banUser(userId, note.trim()), `${name} has been permanently removed.`);
    if (panel === "unban") return run(() => unbanUser(userId, note.trim()), `${name}'s removal has been lifted.`);
    if (panel === "suspend") return run(() => suspendUser(userId, true, note.trim()), `${name} has been suspended.`);
  };
  // Unsuspend is a benign, one-click reversal (matches the report card) — no note.
  const doUnsuspend = () => run(() => suspendUser(userId, false), `${name} has been reinstated.`);

  // ── Current enforcement state (calm, muted; danger color only for lockouts) ──
  const stateBits = [];
  if (banned) stateBits.push("Permanently removed");
  else if (suspended) stateBits.push("Suspended");
  if (warnCount > 0) stateBits.push(`warned ${warnCount}×`);
  const stateColor = banned || suspended ? t.danger : t.textMuted;

  const isDanger = panel === "ban" || panel === "unban";

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: stateColor, lineHeight: 1.5, fontWeight: (banned || suspended) ? 600 : 400 }}>
        {stateBits.length ? stateBits.join(" · ") : "No enforcement actions on record"}
        {latestNotice && latestNotice.reason && (
          <span style={{ color: t.textMuted, fontWeight: 400 }}>
            {" · "}latest: {latestNotice.kind} — <span style={{ fontStyle: "italic" }}>“{latestNotice.reason}”</span>
          </span>
        )}
      </p>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "0 0 8px" }}>{localError}</p>
      )}

      {panel ? (
        <div
          role="group"
          aria-label="Confirm enforcement action"
          onKeyDown={(e) => { if (e.key === "Escape") closePanel(); }}
          style={{
            background: isDanger ? t.dangerSurface : t.surfaceAlt,
            border: `1px solid ${isDanger ? t.danger : t.border}`,
            borderRadius: 12, padding: "14px 16px",
          }}
        >
          <p style={{ margin: "0 0 10px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
            {panel === "warn" && `Warn ${name}? They keep access but see this notice with the reason.`}
            {panel === "ban" && `Permanently remove ${name}? They'll be logged out and unable to sign in. This is harder to undo than a suspension.`}
            {panel === "unban" && `Lift the permanent removal on ${name}? They'll be able to sign in again.`}
            {panel === "suspend" && `Suspend ${name}? They'll be logged out and unable to sign in.`}
          </p>
          <label
            htmlFor={`enf-note-${userId}`}
            style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}
          >
            Reason (required, recorded &amp; shown to the member)
          </label>
          <textarea
            id={`enf-note-${userId}`}
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={2}
            style={{
              width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
              fontSize: 16, color: t.text, background: t.surface, resize: "vertical", fontFamily: t.sans,
              lineHeight: 1.5, boxSizing: "border-box", marginBottom: 12, ...fNote.style,
            }}
            onFocus={fNote.onFocus}
            onBlur={fNote.onBlur}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PlainButton kind={isDanger ? "danger" : "accent"} onClick={confirmAction} disabled={busy || !note.trim()}>
              {panel === "warn" ? "Send warning"
                : panel === "ban" ? "Permanently remove"
                : panel === "unban" ? "Lift removal"
                : "Suspend"}
            </PlainButton>
            <PlainButton kind="neutral" onClick={closePanel} disabled={busy}>Cancel</PlainButton>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <PlainButton kind="quiet" onClick={() => openPanel("warn")} disabled={busy}>
            Warn {userName}
          </PlainButton>
          {includeSuspend && (
            suspended ? (
              <PlainButton kind="quiet" onClick={doUnsuspend} disabled={busy}>
                Unsuspend {userName}
              </PlainButton>
            ) : (
              <PlainButton kind="quiet" onClick={() => openPanel("suspend")} disabled={busy}>
                Suspend {userName}
              </PlainButton>
            )
          )}
          {banned ? (
            <PlainButton kind="quiet" onClick={() => openPanel("unban")} disabled={busy}>
              Unban {userName}
            </PlainButton>
          ) : (
            <PlainButton kind="quiet" onClick={() => openPanel("ban")} disabled={busy}>
              Ban {userName}
            </PlainButton>
          )}
        </div>
      )}
    </div>
  );
}

// P8(b) — session-scoped "Skip for now" dismissals. Skipping a report is a
// client-only triage gesture (no server state); without persistence a Refresh
// re-fetches the report and resurfaces it as a full card. We remember skipped
// report ids in sessionStorage so they stay collapsed to the compact "Skipped"
// strip for the rest of the browser session (cleared on tab close). A real
// server-side skip is out of scope; this just stops the immediate resurface.
const SKIPPED_REPORTS_KEY = "spectrum_admin_skipped_reports";

function readSkippedReports() {
  try {
    const raw = sessionStorage.getItem(SKIPPED_REPORTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function isReportSkipped(id) {
  return readSkippedReports().has(id);
}

function setReportSkipped(id, skipped) {
  try {
    const set = readSkippedReports();
    if (skipped) set.add(id); else set.delete(id);
    sessionStorage.setItem(SKIPPED_REPORTS_KEY, JSON.stringify([...set]));
  } catch { /* storage unavailable — the card's own state still hides it this render */ }
}

// Suggested-action → button label, for the compact "Suggested: …" summary.
const REPORT_ACTION_LABEL = { dismiss: "Dismiss", warn: "Warn", ban: "Ban" };

function ReportCard({ report, onRefresh, onStatus, onDone }) {
  // Moderation redesign v1 — one calm decision. `panel` is which atomic action's
  // reason box is open (null = the three-button chooser). dismiss/warn/ban close
  // the report atomically (POST /reports/:id/action); suspend (under "More") uses
  // the reversible enforcement endpoint. All hooks run before any early return.
  // TOS-driven moderation auto-fill. The backend maps the report's reason to a
  // Community Standard and returns a `suggested` packet (default action + a
  // prepared, editable notice). We keep that action PRE-SELECTED (a compact
  // "Suggested: …" summary + a ring on its button) and PRE-FILL its notice, but
  // P7 — we no longer auto-EXPAND the decision panel on mount. A page of open
  // reports each rendering its full reason form read as a wall of alarm-styled
  // forms; instead each card is a calm summary and its panel opens on tap
  // (accordion). openPanel(suggested.action) re-fills the prepared notice, so the
  // common case is still one tap → review → confirm. requiresHumanReason
  // (§4.7 / "other") ships notice "" so Warn/Ban/Dismiss stay disabled until a
  // reason is typed. Reports without a packet keep the plain three-button chooser.
  const suggested = report.suggested || null;
  const suggestedAction = suggested && ["dismiss", "warn", "ban"].includes(suggested.action) ? suggested.action : null;
  const [panel, setPanel] = useState(null); // null | 'dismiss' | 'warn' | 'ban' | 'suspend' — opens on tap, never on mount
  const [reason, setReason] = useState(() => (suggested ? suggested.notice || "" : ""));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  // Client-side skip — no server state — but persisted for the session (P8b) so a
  // Refresh doesn't immediately resurface a skipped card as a full form again.
  const [skipped, setSkipped] = useState(() => isReportSkipped(report.id));
  const [verified, setVerified] = useState(!!report.reportedVerified);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const fReason = useFocusable();
  const fMore = useFocusable();
  const reasonRef = useRef(null);

  const isOpen = report.status === "open";
  const suspended = !!report.reportedSuspended;
  const banned = !!report.reportedBanned;
  const name = report.reportedName || "this member";
  const isDanger = panel === "ban";

  // Move focus into the reason box when a decision panel is OPENED by the
  // moderator (a11y). Guarded on autoFocusPanel so the auto-fill pre-open on mount
  // doesn't steal focus/scroll across a list of cards — only an explicit openPanel
  // focuses.
  const autoFocusPanel = useRef(false);
  useEffect(() => { if (panel && autoFocusPanel.current) reasonRef.current?.focus(); }, [panel]);

  function openPanel(which) {
    setLocalError("");
    // Pre-fill the prepared member-facing notice for WHICHEVER action is opened.
    // The backend now ships a per-action `notices` map ({ warn, ban, dismiss })
    // so opening Warn fills the warn wording and Ban fills the ban wording, even
    // when it isn't the suggested action. requiresHumanReason ('other') clauses
    // ship empty notices, so those correctly stay blank (moderator must type).
    // Fallback preserves the old behaviour when no notices map is present.
    const perAction = suggested?.notices?.[which];
    setReason(
      perAction != null
        ? perAction
        : (suggested && which === suggested.action ? (suggested.notice || "") : "")
    );
    autoFocusPanel.current = true;
    setPanel(which);
  }
  function closePanel() { setPanel(null); setReason(""); }

  // Shared runner: on success the card refetches and unmounts, so busy is only
  // reset on error (mirrors the prior card). `closesReport` decides whether to
  // return focus to the section heading before the card disappears.
  async function runAction(fn, successMsg, { closesReport = true } = {}) {
    setBusy(true);
    setLocalError("");
    try {
      await fn();
      onStatus(successMsg);
      setPanel(null);
      setReason("");
      if (closesReport) onDone();
      onRefresh();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this report. Please try again."));
      if (err && err.status === 409) onRefresh();
      setBusy(false);
    }
  }

  function confirmPanel() {
    const r = reason.trim();
    if (!r) return;
    if (panel === "dismiss") return runAction(() => reportAction(report.id, "dismiss", r), `Report dismissed — no action taken against ${name}.`);
    if (panel === "warn") return runAction(() => reportAction(report.id, "warn", r), `${name} has been warned. Report closed.`);
    if (panel === "ban") return runAction(() => reportAction(report.id, "ban", r), `${name} has been permanently removed. Report closed.`);
    // Suspend is the reversible middle rung (under "More"); it auto-closes the
    // member's open reports server-side, so it also refreshes this card away.
    if (panel === "suspend") return runAction(() => suspendUser(report.reportedId, true, r), `${name} has been suspended.`);
  }

  async function handleVerifyToggle(nextVerified) {
    setVerifyBusy(true);
    setLocalError("");
    try {
      const res = await verifyUser(report.reportedId, nextVerified);
      const applied = res?.verified ?? nextVerified;
      setVerified(!!applied);
      onStatus(applied ? `${name} is now verified.` : `Verification removed from ${name}.`);
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update verification. Please try again."));
      if (err && err.status === 409) onRefresh();
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleUnsuspend() {
    setBusy(true);
    setLocalError("");
    try {
      await suspendUser(report.reportedId, false);
      onStatus(`${name} has been reinstated.`);
      onRefresh();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this account. Please try again."));
      if (err && err.status === 409) onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const resolver = report.resolvedBy;
  const resolverName = resolver ? (resolver.displayName || resolver.email || "a moderator") : "a moderator";

  // Compact enforcement-state summary (replaces the card's old EnforcementActions
  // cluster; the drawer keeps the full ladder). Preserves the audit context —
  // banned/suspended + warning tally + the latest due-process reason.
  const enfBits = [];
  if (banned) enfBits.push("Permanently removed");
  else if (suspended) enfBits.push("Suspended");
  if ((report.reportedWarnCount ?? 0) > 0) enfBits.push(`warned ${report.reportedWarnCount}×`);
  const latestNotice = report.reportedLatestNotice;

  // Per-action confirm copy (states the consequence in a sentence before confirm).
  const consequence =
    panel === "dismiss" ? `Close this report with no action against ${name}. The reason is recorded in the audit log.`
    : panel === "warn" ? `Send ${name} a warning. They keep access and will see this reason. Recorded in the audit log.`
    : panel === "ban" ? `Permanently remove ${name}? They'll be logged out and can't sign in — harder to undo than a suspension. The reason is recorded and shown to them.`
    : panel === "suspend" ? `Suspend ${name} temporarily? They'll be logged out and unable to sign in until reinstated. The reason is recorded and shown to them.`
    : "";
  const confirmLabel =
    panel === "dismiss" ? "Dismiss report"
    : panel === "warn" ? "Warn & close report"
    : panel === "ban" ? "Ban & close report"
    : panel === "suspend" ? "Suspend"
    : "";
  const reasonLabel = panel === "dismiss"
    ? "Reason (recorded in the audit log)"
    : "Reason (recorded & shown to the member)";

  // "Skip for now" — advance past the case with NO state change (client-side).
  if (skipped && isOpen) {
    return (
      <li
        style={{
          background: t.surfaceAlt, border: `1px solid ${t.borderLight}`, borderRadius: 16,
          padding: "14px 20px", marginBottom: 14, listStyle: "none",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, color: t.textMuted, minWidth: 0 }}>
          Skipped for now — {report.reporterName || "Someone"} <span aria-hidden="true">→</span> {name}
        </span>
        <PlainButton kind="quiet" onClick={() => { setReportSkipped(report.id, false); setSkipped(false); }}>Show again</PlainButton>
      </li>
    );
  }

  return (
    <li
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16,
        padding: "20px 20px", marginBottom: 14, listStyle: "none", boxShadow: t.shadow.sm,
      }}
    >
      {/* Header row: who reported whom + status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, color: t.text, fontWeight: 600, minWidth: 0 }}>
          <span>{report.reporterName || "Someone"}</span>
          <span aria-hidden="true" style={{ color: t.textMuted, margin: "0 8px" }}>→</span>
          <span>{report.reportedName || "a member"}</span>
        </div>
        <StatusBadge status={report.status} />
      </div>

      {(report.reportedEmail || verified) && (
        <div style={{ fontSize: 14, color: t.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {report.reportedEmail && <span>{report.reportedEmail}</span>}
          {verified && <span style={{ color: t.positiveText, fontWeight: 600 }}><span aria-hidden="true">✓ </span>Verified</span>}
        </div>
      )}

      {/* Reason + details */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, color: t.textSoft }}>
          <strong style={{ color: t.text, fontWeight: 600 }}>Reason: </strong>
          <span style={{ textTransform: "capitalize" }}>{report.reason || "—"}</span>
        </div>
        {report.details && (
          <p style={{ margin: "8px 0 0", fontSize: 16, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {report.details}
          </p>
        )}
        {/* Needed #10 — the specific message the reporter pinned, shown on the
            card itself so triage sees the actual evidence up front, distinct
            from the free-text details above. */}
        {report.reportedPinnedMessage && (
          <div
            style={{
              marginTop: 10,
              background: t.warningSurface,
              border: `2px solid ${t.dangerFill}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: t.dangerFill, marginBottom: 4, letterSpacing: "0.02em" }}>
              <span aria-hidden="true">⚑ </span>Reporter flagged this message
            </div>
            <p style={{ margin: 0, fontSize: 16, color: t.text, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {report.reportedPinnedMessage}
            </p>
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, color: t.textMuted, marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span>{formatTimestamp(report.createdAt)}</span>
        {isOpen && waitingLabel(report.createdAt) && (
          <span style={{ color: t.textMuted }}>· {waitingLabel(report.createdAt)}</span>
        )}
        {suspended && (
          <span style={{ color: t.danger, fontWeight: 600 }}>· Account suspended</span>
        )}
      </div>

      {/* P1-B repeat-offender signal (muted, always present) */}
      <RepeatOffenderLine report={report} />

      {/* Enforcement-state summary (banned/suspended/warned N + latest reason) —
          the audit context kept from the old EnforcementActions cluster. The
          Warn/Ban actions now live in the atomic Decision block below; the full
          reversible ladder stays in the Member drawer. */}
      <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: (banned || suspended) ? t.danger : t.textMuted, fontWeight: (banned || suspended) ? 600 : 400 }}>
        {enfBits.length ? enfBits.join(" · ") : "No enforcement actions on record"}
        {latestNotice && latestNotice.reason && (
          <span style={{ color: t.textMuted, fontWeight: 400 }}>
            {" · "}latest: {latestNotice.kind} — <span style={{ fontStyle: "italic" }}>“{latestNotice.reason}”</span>
          </span>
        )}
      </p>

      {/* P1-A reported-conversation view (read-only) */}
      <ReportedContext reportId={report.id} reportedName={report.reportedName} reportedAudioTranscript={report.reportedAudioTranscript} />

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "12px 0 0" }}>{localError}</p>
      )}

      {/* Resolved reports show a read-only receipt; OPEN reports get the atomic
          Decision block (Dismiss · Warn · Ban) + More + Skip. */}
      {!isOpen ? (
        <div style={{ borderTop: `1px solid ${t.borderLight}`, marginTop: 16, paddingTop: 16 }}>
          <div style={{ fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
            <span style={{ textTransform: "capitalize", fontWeight: 600, color: t.text }}>{report.status}</span>
            {" by "}{resolverName}
            {report.resolvedAt ? ` · ${formatTimestamp(report.resolvedAt)}` : ""}
            {report.moderatorNote ? (
              <span> · <span style={{ fontStyle: "italic" }}>“{report.moderatorNote}”</span></span>
            ) : ""}
          </div>
        </div>
      ) : (
        <div style={{ borderTop: `1px solid ${t.borderLight}`, marginTop: 16, paddingTop: 16 }}>
          {panel ? (
            /* One calm reason box — states the consequence, then confirm/cancel. */
            <div
              role="group"
              aria-label="Confirm decision"
              onKeyDown={(e) => { if (e.key === "Escape") closePanel(); }}
              style={{
                background: isDanger ? t.dangerSurface : t.surfaceAlt,
                border: `1px solid ${isDanger ? t.danger : t.border}`,
                borderRadius: 12, padding: "14px 16px",
              }}
            >
              <p style={{ margin: "0 0 10px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>{consequence}</p>
              {/* TOS auto-fill provenance — cite the standard the prepared notice
                  came from, so the moderator can see (and trust) the baseline. */}
              {suggested && panel === suggested.action && (suggested.tosSection || suggested.title) && (
                <p style={{ margin: "0 0 10px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
                  Auto-filled from Terms {suggested.tosSection}
                  {suggested.title ? ` — ${suggested.title}` : ""}
                </p>
              )}
              {/* §4.5 legal-referral escalation — calm high-severity note (warm
                  amber surface, not alarm-red), matching the pinned-evidence style. */}
              {suggested && panel === suggested.action && suggested.legalReferral && (
                <div
                  style={{
                    background: t.warningSurface,
                    border: `2px solid ${t.dangerFill}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    marginBottom: 12,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 14, color: t.warningSurfaceText, fontWeight: 600, lineHeight: 1.5 }}>
                    <span aria-hidden="true">⚠ </span>This standard requires a legal referral (CSAM/NCMEC) — escalate per runbook.
                  </p>
                </div>
              )}
              <label
                htmlFor={`decision-reason-${report.id}`}
                style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}
              >
                {reasonLabel}
              </label>
              <textarea
                id={`decision-reason-${report.id}`}
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={2}
                style={{
                  width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
                  // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
                  fontSize: 16, color: t.text, background: t.surface, resize: "vertical", fontFamily: t.sans,
                  lineHeight: 1.5, boxSizing: "border-box", marginBottom: 12, ...fReason.style,
                }}
                onFocus={fReason.onFocus}
                onBlur={fReason.onBlur}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <PlainButton kind={isDanger ? "danger" : "accent"} onClick={confirmPanel} disabled={busy || !reason.trim()}>
                  {confirmLabel}
                </PlainButton>
                <PlainButton kind="neutral" onClick={closePanel} disabled={busy}>Cancel</PlainButton>
              </div>
            </div>
          ) : (
            /* The atomic actions — one vocabulary, one decision. The suggested
               action stays PRE-SELECTED (summary line + ring) but its panel only
               opens on tap (P7 — no wall of expanded forms). */
            (() => {
              // Don't suggest (or offer) Ban for a member who is already removed.
              const showBan = !banned;
              const chooserSuggested = suggestedAction === "ban" && banned ? null : suggestedAction;
              return (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, marginBottom: 10 }}>Decision</div>
                  {chooserSuggested && (
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: t.textSoft, lineHeight: 1.5 }}>
                      Suggested: <strong style={{ color: t.text }}>{REPORT_ACTION_LABEL[chooserSuggested]}</strong>
                      {suggested && suggested.notice ? " — a reply is prepared. Tap to review before it's sent." : " — tap to review."}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <PlainButton kind="neutral" emphasis={chooserSuggested === "dismiss"} onClick={() => openPanel("dismiss")} disabled={busy}>Dismiss</PlainButton>
                    <PlainButton kind="accent" emphasis={chooserSuggested === "warn"} onClick={() => openPanel("warn")} disabled={busy}>Warn</PlainButton>
                    {showBan ? (
                      <PlainButton kind="danger" emphasis={chooserSuggested === "ban"} onClick={() => openPanel("ban")} disabled={busy}>Ban</PlainButton>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 4px", fontSize: 13, color: t.danger, fontWeight: 600 }}>
                        Already permanently removed
                      </span>
                    )}
                    <PlainButton kind="quiet" onClick={() => { setReportSkipped(report.id, true); setSkipped(true); }} disabled={busy}>Skip for now</PlainButton>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
                    Dismiss = no action · Warn = keeps access, on notice{showBan ? " · Ban = permanent removal" : ""}
                  </p>

              {/* Advanced, tucked away: Suspend (reversible) + Verify. */}
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  style={{
                    background: "none", border: "none", color: t.textMuted, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", padding: "4px 2px", borderRadius: 8, ...fMore.style,
                  }}
                  onFocus={fMore.onFocus}
                  onBlur={fMore.onBlur}
                >
                  More <span aria-hidden="true">{moreOpen ? "▴" : "▾"}</span>
                </button>
                {moreOpen && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                    {suspended ? (
                      <PlainButton kind="quiet" onClick={handleUnsuspend} disabled={busy}>
                        Unsuspend {report.reportedName}
                      </PlainButton>
                    ) : (
                      <PlainButton kind="quiet" onClick={() => openPanel("suspend")} disabled={busy}>
                        Suspend temporarily
                      </PlainButton>
                    )}
                    {verified ? (
                      <PlainButton kind="quiet" onClick={() => handleVerifyToggle(false)} disabled={verifyBusy}>
                        Remove verification
                      </PlainButton>
                    ) : (
                      <PlainButton kind="quiet" onClick={() => handleVerifyToggle(true)} disabled={verifyBusy}>
                        Mark verified
                      </PlainButton>
                    )}
                  </div>
                )}
              </div>
                </>
              );
            })()
          )}
        </div>
      )}
    </li>
  );
}

// --- Photo review queue (Error Log E2) ---
function PhotoReviewSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 12,
            width: 220, display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <Skeleton width="100%" height={140} />
          <Skeleton width="70%" height={13} />
          <Skeleton width="40%" height={13} />
        </div>
      ))}
    </div>
  );
}

// Shared reject-with-required-note panel for the photo queues (B-E: a rejection
// must carry a reason). Escape cancels; focus moves into the textarea on reveal.
function RejectPanel({ label, note, setNote, onConfirm, onCancel, busy }) {
  const f = useFocusable();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div
      role="group"
      aria-label="Reject with a reason"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      style={{ background: t.dangerSurface, border: `1px solid ${t.danger}`, borderRadius: 12, padding: "12px 14px", marginTop: 2 }}
    >
      <label style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}>
        {label}
      </label>
      <textarea
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        maxLength={500}
        rows={2}
        style={{
          width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
          fontSize: 16, color: t.text, background: t.surface, resize: "vertical", fontFamily: t.sans,
          lineHeight: 1.5, boxSizing: "border-box", marginBottom: 10, ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PlainButton kind="danger" onClick={onConfirm} disabled={busy || !note.trim()}>Reject</PlainButton>
        <PlainButton kind="neutral" onClick={onCancel} disabled={busy}>Cancel</PlainButton>
      </div>
    </div>
  );
}

function PhotoReviewCard({ item, onActed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const owner = item.uploaderEmail || "a member";

  async function approve() {
    setBusy(true);
    setLocalError("");
    try {
      await reviewAttachment(item.id, "approved");
      onStatus("Photo approved.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this photo. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  async function reject() {
    if (!note.trim()) return;
    setBusy(true);
    setLocalError("");
    try {
      await reviewAttachment(item.id, "rejected", note.trim());
      onStatus("Photo rejected.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this photo. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 12, width: 240,
        listStyle: "none", display: "flex", flexDirection: "column", gap: 10, boxShadow: t.shadow.sm,
      }}
    >
      <img
        src={item.publicUrl}
        alt={`Photo submitted by ${owner}, awaiting review`}
        loading="lazy"
        decoding="async"
        style={{
          display: "block", width: "100%", height: 180, objectFit: "cover", borderRadius: 10,
          border: `1px solid ${t.borderLight}`, background: t.surfaceAlt,
        }}
      />
      <div style={{ fontSize: 14, color: t.text, fontWeight: 600, wordBreak: "break-word" }}>
        {item.uploaderEmail || "Unknown member"}
      </div>
      <div style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</div>
      {waitingLabel(item.createdAt) && (
        <div style={{ fontSize: 13, color: t.textMuted }}>{waitingLabel(item.createdAt)}</div>
      )}

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{localError}</p>
      )}

      {rejecting ? (
        <RejectPanel
          label={`Why reject this photo from ${owner}?`}
          note={note}
          setNote={setNote}
          onConfirm={reject}
          onCancel={() => { setRejecting(false); setNote(""); }}
          busy={busy}
        />
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <PlainButton kind="accent" onClick={approve} disabled={busy} ariaLabel={`Approve photo from ${owner}`}>Approve</PlainButton>
          <PlainButton kind="quiet" onClick={() => setRejecting(true)} disabled={busy} ariaLabel={`Reject photo from ${owner}`}>Reject</PlainButton>
        </div>
      )}
    </li>
  );
}

function PhotoReviewQueue({ onStatus, reloadToken, onAfterAction }) {
  const { items, loading, error, reload } = useAdminList(() => getPendingAttachments("pending_review"), reloadToken);
  const handleActed = useCallback(() => { reload(); onAfterAction?.(); }, [reload, onAfterAction]);

  if (loading) return <PhotoReviewSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load photos" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (items.length === 0) return <EmptyCard>No photos awaiting review.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <PhotoReviewCard key={item.id} item={item} onActed={handleActed} onStatus={onStatus} />
      ))}
    </ul>
  );
}

// --- Profile-photo review queue (SAFETY-2) ---
function ProfilePhotoReviewCard({ item, onActed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const owner = item.ownerDisplayName || item.ownerEmail || "a member";

  async function approve() {
    setBusy(true);
    setLocalError("");
    try {
      await reviewProfilePhoto(item.id, "approve");
      onStatus("Profile photo approved.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this photo. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  async function reject() {
    if (!note.trim()) return;
    setBusy(true);
    setLocalError("");
    try {
      await reviewProfilePhoto(item.id, "reject", note.trim());
      onStatus("Profile photo rejected.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this photo. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 12, width: 240,
        listStyle: "none", display: "flex", flexDirection: "column", gap: 10, boxShadow: t.shadow.sm,
      }}
    >
      <img
        src={item.url}
        alt={`Profile photo submitted by ${owner}, awaiting review`}
        loading="lazy"
        decoding="async"
        style={{
          display: "block", width: "100%", height: 180, objectFit: "cover", borderRadius: 10,
          border: `1px solid ${t.borderLight}`, background: t.surfaceAlt,
        }}
      />
      <div style={{ fontSize: 14, color: t.text, fontWeight: 600, wordBreak: "break-word" }}>{owner}</div>
      {item.ownerDisplayName && item.ownerEmail && (
        <div style={{ fontSize: 13, color: t.textMuted, wordBreak: "break-word" }}>{item.ownerEmail}</div>
      )}
      <div style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</div>
      {waitingLabel(item.createdAt) && (
        <div style={{ fontSize: 13, color: t.textMuted }}>{waitingLabel(item.createdAt)}</div>
      )}

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{localError}</p>
      )}

      {rejecting ? (
        <RejectPanel
          label={`Why reject this profile photo from ${owner}?`}
          note={note}
          setNote={setNote}
          onConfirm={reject}
          onCancel={() => { setRejecting(false); setNote(""); }}
          busy={busy}
        />
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <PlainButton kind="accent" onClick={approve} disabled={busy} ariaLabel={`Approve profile photo from ${owner}`}>Approve</PlainButton>
          <PlainButton kind="quiet" onClick={() => setRejecting(true)} disabled={busy} ariaLabel={`Reject profile photo from ${owner}`}>Reject</PlainButton>
        </div>
      )}
    </li>
  );
}

function ProfilePhotoReviewQueue({ onStatus, reloadToken, onAfterAction }) {
  const { items, loading, error, reload } = useAdminList(() => getPendingProfilePhotos(), reloadToken);
  const handleActed = useCallback(() => { reload(); onAfterAction?.(); }, [reload, onAfterAction]);

  if (loading) return <PhotoReviewSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load profile photos" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (items.length === 0) return <EmptyCard>No profile photos awaiting review.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <ProfilePhotoReviewCard key={item.id} item={item} onActed={handleActed} onStatus={onStatus} />
      ))}
    </ul>
  );
}

// --- Profile-audio review queue (audio prompt answers) ---
// The photo card rhythm, with an <audio> player and the member-typed transcript
// shown PROMINENTLY. The transcript speeds triage but is member-provided and
// UNTRUSTED — the moderator must listen to confirm it matches (caption says so).
// preload="none" + load-on-demand so opening the queue never autoloads every clip
// and a pending clip is played via a short-lived presigned URL (admin-allowed),
// never a stable public link. Never autoplay; one clip plays at a time (native).
function AudioReviewCard({ item, onActed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [src, setSrc] = useState("");
  const [loadingSrc, setLoadingSrc] = useState(false);
  const fLoad = useFocusable();
  const owner = item.ownerDisplayName || item.ownerEmail || "a member";
  const durLabel = formatAudioDuration(item.durationMs);

  async function loadPlayback() {
    setLoadingSrc(true);
    setLocalError("");
    try {
      const url = await getAudioPlaybackUrl(item.id);
      if (url) setSrc(url);
      else setLocalError("Couldn't load this clip. Please try again.");
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't load this clip. Please try again."));
    } finally {
      setLoadingSrc(false);
    }
  }

  async function approve() {
    setBusy(true);
    setLocalError("");
    try {
      await reviewProfileAudio(item.id, "approve");
      onStatus("Audio answer approved.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this clip. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  async function reject() {
    if (!note.trim()) return;
    setBusy(true);
    setLocalError("");
    try {
      await reviewProfileAudio(item.id, "reject", note.trim());
      onStatus("Audio answer rejected.");
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this clip. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 14, width: 320,
        maxWidth: "100%", listStyle: "none", display: "flex", flexDirection: "column", gap: 10, boxShadow: t.shadow.sm,
      }}
    >
      <div style={{ fontSize: 14, color: t.text, fontWeight: 600, wordBreak: "break-word" }}>{owner}</div>
      {item.ownerDisplayName && item.ownerEmail && (
        <div style={{ fontSize: 13, color: t.textMuted, wordBreak: "break-word" }}>{item.ownerEmail}</div>
      )}
      {item.promptKey && (
        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Prompt: {item.promptKey}
        </div>
      )}
      <div style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</div>
      {waitingLabel(item.createdAt) && (
        <div style={{ fontSize: 13, color: t.textMuted }}>{waitingLabel(item.createdAt)}</div>
      )}

      {/* Player — loaded on demand via a presigned URL (admin-allowed). */}
      {src ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <audio preload="none" controls src={src} aria-label={`Voice answer from ${owner}, awaiting review`} style={{ maxWidth: "100%", minWidth: 0 }} />
          {durLabel && <span style={{ fontSize: 13, color: t.textMuted, flexShrink: 0 }}>{durLabel}</span>}
        </div>
      ) : (
        <button
          type="button"
          onClick={loadPlayback}
          disabled={loadingSrc}
          onFocus={fLoad.onFocus}
          onBlur={fLoad.onBlur}
          style={{
            alignSelf: "flex-start", minHeight: 44, padding: "8px 14px", borderRadius: 10,
            border: `1px solid ${t.formBorder}`, background: t.surface, color: t.accentStrong,
            fontSize: 15, fontWeight: 600, cursor: loadingSrc ? "wait" : "pointer", ...fLoad.style,
          }}
        >
          {loadingSrc ? "Loading…" : "Load audio to review"}
        </button>
      )}

      {/* Transcript — prominent, with the honesty caption. */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.textSoft, marginBottom: 4 }}>Transcript</div>
        <p style={{ margin: 0, fontSize: 15, color: t.text, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {item.transcript}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
          Member-provided — listen to confirm it matches.
        </p>
      </div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{localError}</p>
      )}

      {rejecting ? (
        <RejectPanel
          label={`Why reject this voice answer from ${owner}?`}
          note={note}
          setNote={setNote}
          onConfirm={reject}
          onCancel={() => { setRejecting(false); setNote(""); }}
          busy={busy}
        />
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <PlainButton kind="accent" onClick={approve} disabled={busy} ariaLabel={`Approve voice answer from ${owner}`}>Approve</PlainButton>
          <PlainButton kind="quiet" onClick={() => setRejecting(true)} disabled={busy} ariaLabel={`Reject voice answer from ${owner}`}>Reject</PlainButton>
        </div>
      )}
    </li>
  );
}

function AudioReviewQueue({ onStatus, reloadToken, onAfterAction }) {
  const { items, loading, error, reload } = useAdminList(() => getPendingProfileAudio(), reloadToken);
  const handleActed = useCallback(() => { reload(); onAfterAction?.(); }, [reload, onAfterAction]);

  if (loading) return <PhotoReviewSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load audio answers" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (items.length === 0) return <EmptyCard>No voice answers awaiting review.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <AudioReviewCard key={item.id} item={item} onActed={handleActed} onStatus={onStatus} />
      ))}
    </ul>
  );
}

// --- Activity log (F2 / P1-C) ---
function AuditLogSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px",
            marginBottom: 10, display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <Skeleton width="45%" height={15} />
          <Skeleton width="70%" height={13} />
        </div>
      ))}
    </div>
  );
}

// Client-side filter over the already-fetched audit rows, bucketed by action.
// No backend change — the log is small and fully loaded, so this is a pure
// in-memory partition. "other" (e.g. maintenance/purge) only surfaces under All.
const AUDIT_FILTERS = [
  { value: "all", label: "All" },
  { value: "enforcement", label: "Enforcement" },
  { value: "reports", label: "Reports" },
  { value: "verification", label: "Verification" },
  { value: "roles", label: "Roles" },
];
function auditActionBucket(action) {
  const a = String(action || "");
  if (a === "resolve_report") return "reports";
  if (a === "grant_admin" || a === "revoke_admin") return "roles";
  if (a === "verify" || a === "unverify" || a.startsWith("approve_") || a.startsWith("reject_")) return "verification";
  if (a === "warn" || a === "ban" || a === "unban" || a === "suspend" || a === "unsuspend" || a === "nuke_intros") return "enforcement";
  return "other";
}

function AuditLogView({ reloadToken }) {
  const { items: log, loading, error, reload } = useAdminList(() => getAuditLog(), reloadToken);
  // Hook before any early return (React #310).
  const [filter, setFilter] = useState("all");

  if (loading) return <AuditLogSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load the audit log" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (log.length === 0) return <EmptyCard>No moderation activity yet.</EmptyCard>;
  const filtered = filter === "all" ? log : log.filter((e) => auditActionBucket(e.action) === filter);
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Segmented options={AUDIT_FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter the audit log by action" />
      </div>
      {filtered.length === 0 ? (
        <EmptyCard>No matching activity in the audit log.</EmptyCard>
      ) : (
      <ul style={{ margin: 0, padding: 0 }}>
      {filtered.map((entry) => {
        // P1-C: prefer the backend-resolved human name over the raw target id.
        const target = entry.targetName || entry.targetEmail || (entry.targetId != null && entry.targetId !== "" ? `target ${entry.targetId}` : "");
        return (
          <li
            key={entry.id}
            style={{
              background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px",
              marginBottom: 10, listStyle: "none", boxShadow: t.shadow.sm,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: t.text, textTransform: "capitalize" }}>
                {String(entry.action || "action").replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(entry.createdAt)}</span>
            </div>
            <div style={{ fontSize: 14, color: t.textSoft, marginTop: 6, lineHeight: 1.5 }}>
              <span>{entry.actor || "Unknown admin"}</span>
              {target && (
                <>
                  <span aria-hidden="true" style={{ color: t.textMuted, margin: "0 8px" }}>·</span>
                  <span>{target}</span>
                </>
              )}
            </div>
            {entry.detail && (
              <p style={{ margin: "8px 0 0", fontSize: 14, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {entry.detail}
              </p>
            )}
          </li>
        );
      })}
      </ul>
      )}
    </div>
  );
}

// --- Feedback inbox (F3) ---
function FeedbackInbox({ reloadToken }) {
  const { items: feedback, loading, error, reload } = useAdminList(() => getAdminFeedback(), reloadToken);

  if (loading) return <AuditLogSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load feedback" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (feedback.length === 0) return <EmptyCard>No feedback yet.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {feedback.map((item) => (
        <li
          key={item.id}
          style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px",
            marginBottom: 12, listStyle: "none", boxShadow: t.shadow.sm,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: t.text, wordBreak: "break-word" }}>
              {item.userEmail || "Anonymous member"}
            </span>
            <span style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</span>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 16, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {item.message}
          </p>
        </li>
      ))}
    </ul>
  );
}

// --- Verification queue (F1) ---
function VerificationCard({ item, onActed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const who = item.displayName || item.email || "this member";

  async function decide(approved) {
    setBusy(true);
    setLocalError("");
    try {
      await verifyUser(item.userId, approved);
      onStatus(approved ? `${item.displayName || "This member"} is now verified.` : `Verification declined for ${item.displayName || "this member"}.`);
      onActed();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this request. Please try again."));
      if (err && err.status === 409) onActed();
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px",
        marginBottom: 12, listStyle: "none", boxShadow: t.shadow.sm,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {item.photoUrl ? (
          <img
            src={item.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: `1px solid ${t.borderLight}`, background: t.surfaceAlt, flexShrink: 0 }}
          />
        ) : (
          <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: "50%", background: t.surfaceAlt, border: `1px solid ${t.borderLight}`, flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.text, wordBreak: "break-word" }}>{item.displayName || "Unnamed member"}</div>
          {item.email && <div style={{ fontSize: 14, color: t.textMuted, wordBreak: "break-word" }}>{item.email}</div>}
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
            Requested {formatTimestamp(item.requestedAt)}
            {waitingLabel(item.requestedAt) && <span> · {waitingLabel(item.requestedAt)}</span>}
          </div>
        </div>
      </div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "12px 0 0" }}>{localError}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <PlainButton kind="accent" onClick={() => decide(true)} disabled={busy} ariaLabel={`Approve verification for ${who}`}>Approve</PlainButton>
        <PlainButton kind="quiet" onClick={() => decide(false)} disabled={busy} ariaLabel={`Reject verification for ${who}`}>Reject</PlainButton>
      </div>
    </li>
  );
}

function VerificationQueue({ onStatus, reloadToken, onAfterAction }) {
  const { items, loading, error, reload } = useAdminList(() => getVerificationRequests("pending"), reloadToken);
  const handleActed = useCallback(() => { reload(); onAfterAction?.(); }, [reload, onAfterAction]);

  if (loading) return <ReportsSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load verification requests" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (items.length === 0) return <EmptyCard>No pending verification requests.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {items.map((item) => (
        <VerificationCard key={item.userId} item={item} onActed={handleActed} onStatus={onStatus} />
      ))}
    </ul>
  );
}

// --- Maintenance: purge automated-test accounts (A+B) ---
// De-emphasized: lives in a collapsed "Maintenance" disclosure at the bottom,
// not in prime dashboard position. Keeps its internal confirm design.
function PurgeTestAccountsPanel({ onStatus, onRefresh }) {
  const [confirming, setConfirming] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [result, setResult] = useState("");

  async function handlePurge() {
    setBusy(true);
    setLocalError("");
    try {
      const deleted = await purgeTestAccounts(includeDemo);
      const msg = `Removed ${deleted} test ${deleted === 1 ? "account" : "accounts"}${includeDemo ? " (including demo)" : ""}.`;
      setResult(msg);
      onStatus?.(msg);
      setConfirming(false);
      setIncludeDemo(false);
      onRefresh?.();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't purge test accounts. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px", boxShadow: t.shadow.sm }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>Purge test accounts</div>
      <p style={{ margin: "6px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
        Permanently deletes automated-test accounts (<code style={{ fontSize: 13 }}>@spectrum-test.dev</code>)
        and all their data. Real member accounts are never touched.
      </p>

      {result && !confirming && (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: t.textMuted }}>{result}</p>
      )}
      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "10px 0 0" }}>{localError}</p>
      )}

      {confirming ? (
        <div style={{ background: t.dangerSurface, border: `1px solid ${t.danger}`, borderRadius: 12, padding: "14px 16px", marginTop: 14 }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
            This deletes every <code style={{ fontSize: 13 }}>@spectrum-test.dev</code> account and
            their profiles, matches, and conversations. This can't be undone.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: t.textSoft, marginBottom: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} style={{ width: 18, height: 18, cursor: "pointer" }} />
            Also delete demo accounts (<code style={{ fontSize: 13 }}>@sample.spectrum-dating.app</code>)
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <PlainButton kind="danger" onClick={handlePurge} disabled={busy}>{busy ? "Purging…" : "Purge accounts"}</PlainButton>
            <PlainButton kind="neutral" onClick={() => { setConfirming(false); setIncludeDemo(false); }} disabled={busy}>Cancel</PlainButton>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <PlainButton kind="quiet" onClick={() => { setResult(""); setConfirming(true); }}>Purge test accounts</PlainButton>
        </div>
      )}
    </div>
  );
}

// Low-emphasis collapsed "Maintenance" section housing the purge panel.
function MaintenanceSection({ onStatus, onRefresh }) {
  const [open, setOpen] = useState(false);
  const f = useFocusable();
  return (
    <div style={{ marginTop: 32 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          minHeight: 44, padding: "8px 12px", borderRadius: 10, border: "none", background: "transparent",
          color: t.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 8, ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        Maintenance
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <PurgeTestAccountsPanel onStatus={onStatus} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}

// ─── Telemetry Overview + Member management (admin dashboard) ───────────────
// Shared, calm styling for the telemetry sections. Numbers are grounded and
// stamped with an "Updated HH:MM" — never a live ticker/animated counter. All
// charts are static (Sparkline / RankedBars).

const zoneHeadingStyle = { fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.textMuted, margin: "0 0 10px" };
const sectionCardStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 16, boxShadow: t.shadow.sm };
const telemetryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 };

const WINDOW_OPTIONS = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

// Generic segmented control (reuses SegmentButton's pill look) for the window
// selector and the member status/sort filters.
function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: "flex", gap: 4, background: t.surfaceAlt, border: `1px solid ${t.borderLight}`,
        borderRadius: 12, padding: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "thin",
      }}
    >
      {options.map((o) => (
        <SegmentButton key={o.value} label={o.label} active={value === o.value} onClick={() => onChange(o.value)} />
      ))}
    </div>
  );
}

// Admin-only "Demo data" switch — flips the telemetry queries to the seeded
// demo dataset (?demo=1) so the live demo view is populated without polluting
// real counts. Plain checkbox semantics (accessible), styled small.
function DemoToggle({ value, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: t.textSoft, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, cursor: "pointer" }}
      />
      Demo data
    </label>
  );
}

// Moderation redesign v3 — "Live counts" opt-in. A plain labeled checkbox (real
// control, keyboard/SR-accessible, carries the word — never color-only). When
// ON, the triage "Needs attention" numbers refresh quietly every ~60s (counts
// only; it never moves the case you're reading). Default OFF (opt-in — calmest);
// the choice persists in localStorage so it stays put across visits. No motion,
// no badge, no sound — a quiet number change, nothing more.
function LiveCountsToggle({ value, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: t.textSoft, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, cursor: "pointer" }}
      />
      Live counts
    </label>
  );
}

// Admin-only "Load demo data" / "Clear demo data" controls — furnish (or clear)
// the live-demo dashboard from inside the panel, since the CLI seed script can't
// reach the prod DB on Railway's volume. Each action is behind a calm inline
// confirm. Everything it loads is clearly-flagged demo/sample data (is_demo=1
// telemetry + telemetry-demo- members), never real counts. On success the parent
// refetches and — for Load — flips the "Demo data" view toggle ON.
function DemoDataControls({ onLoaded, onCleared }) {
  const [confirming, setConfirming] = useState(null); // 'load' | 'clear' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      const res = await setDemoData(action);
      setConfirming(null);
      if (action === "load") onLoaded?.(res);
      else onCleared?.(res);
    } catch (err) {
      setError(safeErrorMessage(
        err,
        action === "load" ? "Couldn't load demo data. Please try again." : "Couldn't clear demo data. Please try again."
      ));
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    const isLoad = confirming === "load";
    return (
      <div
        role="group"
        aria-label={isLoad ? "Confirm load demo data" : "Confirm clear demo data"}
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}
      >
        <span style={{ fontSize: 14, color: t.textSoft, lineHeight: 1.5, maxWidth: 340 }}>
          {isLoad
            ? "Load sample data for the demo? This adds ~500 clearly-flagged demo members plus moderation activity (reports, blocks, verification requests, feedback) you can clear anytime."
            : "Remove all demo data?"}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PlainButton kind={isLoad ? "accent" : "danger"} onClick={() => run(confirming)} disabled={busy}>
            {busy ? (isLoad ? "Loading…" : "Clearing…") : (isLoad ? "Load demo data" : "Clear demo data")}
          </PlainButton>
          <PlainButton kind="neutral" onClick={() => { setConfirming(null); setError(""); }} disabled={busy}>
            Cancel
          </PlainButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <PlainButton kind="quiet" onClick={() => { setError(""); setConfirming("load"); }}>Load demo data</PlainButton>
      <PlainButton kind="quiet" onClick={() => { setError(""); setConfirming("clear"); }}>Clear demo data</PlainButton>
      {error && <span role="alert" style={{ fontSize: 13, color: t.danger }}>{error}</span>}
    </div>
  );
}

// Uptime board — current process uptime, the three window %s, an "application
// layer" honesty label (so 100% never reads as fabricated edge/network uptime),
// and the incident list. Percentages are floored (formatUptimePct), never
// rounded up past measured downtime.
function UptimeBoard({ data, loading, error, onRetry, demo }) {
  return (
    <div style={sectionCardStyle}>
      <h2 style={zoneHeadingStyle}>Service uptime</h2>
      {loading ? (
        <div aria-hidden="true"><Skeleton width="40%" height={22} /><div style={{ height: 10 }} /><Skeleton width="70%" height={14} /></div>
      ) : error || !data ? (
        <ErrorState title="Couldn't load uptime" message="Something went wrong on our end. Please try again." onRetry={onRetry} />
      ) : (
        <>
          <div style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1 }}>
            {data.currentUptimeMs > 0 ? `Up for ${formatDuration(data.currentUptimeMs)}` : "Uptime not yet recorded"}
          </div>
          <div style={{ ...telemetryGrid, marginTop: 14 }}>
            {["24h", "7d", "30d"].map((w) => (
              <div key={w} style={{ background: t.surfaceAlt, border: `1px solid ${t.borderLight}`, borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text }}>
                  {formatUptimePct(data.windows?.[w])}
                </div>
                <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>last {w}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
            Measured at the application layer — app + database liveness, not edge/network.
            {demo ? " Showing demo data." : ""}
          </p>

          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "0 0 8px" }}>Recent incidents</h3>
            {data.incidents.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>No downtime recorded in the last 30 days.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {data.incidents.map((inc) => (
                  <li key={inc.id} style={{ border: `1px solid ${t.borderLight}`, borderRadius: 10, padding: "10px 12px", background: t.bg }}>
                    <div style={{ fontSize: 14, color: t.text, fontWeight: 600, textTransform: "capitalize" }}>
                      {String(inc.kind || "gap").replace(/_/g, " ")} · {formatDuration(inc.durationMs)}
                    </div>
                    <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
                      {formatTimestamp(inc.startedAt)} → {formatTimestamp(inc.endedAt)}
                    </div>
                    {inc.note && <div style={{ fontSize: 13, color: t.textSoft, marginTop: 4 }}>{inc.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Calm live-status row for the Site-health panel: a small dot + label. NEVER
// alarm-red — "ok" reads positive/green, any degraded/unreachable state reads
// amber (t.warningFill), matching the calm-by-design rule. Carries the WORD, so
// it's never color-only.
function HealthIndicator({ label, state, okText, downText }) {
  const ok = state === "ok";
  const color = ok ? t.positiveFill : t.warningFill;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 15, color: t.text, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{label}:</span> {ok ? okText : downText}
      </span>
    </div>
  );
}

// Site health — always-visible summary near the top of the dashboard. Live
// service status (GET /health, public), current process uptime + 24h/7d %
// (from the already-built /admin/telemetry/uptime), and the most recent
// incident. Reuses the "Updated HH:MM" + Refresh pattern; NO live ticker. It
// degrades gracefully: /health never throws (getServerHealth normalizes a dead
// probe to reachable:false → calm "Unreachable"), and if uptime has little data
// it shows the short real uptime, never an error. All hooks run before any
// early return (React #310). The detailed uptime board stays on the Overview
// tab untouched.
function SiteHealthPanel() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const health = useAdminResource(() => getServerHealth(), `sh-health-${refreshToken}`);
  const uptime = useAdminResource(() => getTelemetryUptime(false), `sh-uptime-${refreshToken}`);

  const settled = !health.loading && !uptime.loading;
  useEffect(() => { if (settled) setUpdatedAt(Date.now()); }, [settled]);

  const h = health.data;                    // { reachable, status, db, sha } — never throws
  const reachable = !!h?.reachable;
  const dbState = h?.db;                     // 'up' | 'down' | null (older build omits it)
  const up = uptime.data;
  const uptimeReady = !uptime.error && !!up; // little data is still "ready" — render it
  const lastIncident = uptimeReady && up.incidents.length > 0 ? up.incidents[0] : null;

  return (
    <div style={sectionCardStyle}>
      {/* Freshness + Refresh — grounded stamp, never a live ticker */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: t.textMuted }}>
          {updatedAt ? `Updated ${formatClock(updatedAt)}` : "Loading…"}
        </span>
        <PlainButton kind="neutral" onClick={() => setRefreshToken((x) => x + 1)}>Refresh</PlainButton>
      </div>

      {/* Live service status */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {health.loading ? (
          <div aria-hidden="true"><Skeleton width="55%" height={16} /></div>
        ) : (
          <>
            <HealthIndicator label="Server" state={reachable ? "ok" : "down"} okText="Operational" downText="Unreachable" />
            {dbState && (
              <HealthIndicator label="Database" state={dbState === "up" ? "ok" : "down"} okText="Operational" downText="Degraded" />
            )}
          </>
        )}
      </div>

      {/* Uptime */}
      <div style={{ marginTop: 16 }}>
        {uptime.loading ? (
          <div aria-hidden="true"><Skeleton width="40%" height={22} /></div>
        ) : !uptimeReady ? (
          <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>Uptime not recorded yet.</p>
        ) : (
          <>
            <div style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text, lineHeight: 1.1 }}>
              {up.currentUptimeMs > 0 ? `Up for ${formatDuration(up.currentUptimeMs)}` : "Uptime not yet recorded"}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {["24h", "7d"].map((w) => (
                <div key={w} style={{ background: t.surfaceAlt, border: `1px solid ${t.borderLight}`, borderRadius: 12, padding: "10px 14px", minWidth: 96 }}>
                  <div style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text }}>{formatUptimePct(up.windows?.[w])}</div>
                  <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>last {w}</div>
                </div>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
              Measured at the application layer — app + database liveness, not edge/network.
            </p>
          </>
        )}
      </div>

      {/* Last incident */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "0 0 6px" }}>Last incident</h3>
        {uptime.loading ? (
          <div aria-hidden="true"><Skeleton width="50%" height={13} /></div>
        ) : uptimeReady && lastIncident ? (
          <div style={{ fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
            <span style={{ textTransform: "capitalize", fontWeight: 600, color: t.text }}>
              {String(lastIncident.kind || "gap").replace(/_/g, " ")}
            </span>
            {" · "}{formatDuration(lastIncident.durationMs)}
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{formatTimestamp(lastIncident.startedAt)}</div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>No incidents recorded.</p>
        )}
      </div>
    </div>
  );
}

// One ranked-bars section card (geo / referrers / member email-domains).
function RankedSection({ title, res, emptyLabel, note }) {
  return (
    <div style={sectionCardStyle}>
      <h2 style={zoneHeadingStyle}>{title}</h2>
      {note && <p style={{ margin: "0 0 10px", fontSize: 13, color: t.textMuted }}>{note}</p>}
      {res.loading ? (
        <div aria-hidden="true"><Skeleton width="90%" height={12} /><div style={{ height: 8 }} /><Skeleton width="70%" height={12} /><div style={{ height: 8 }} /><Skeleton width="50%" height={12} /></div>
      ) : res.error ? (
        <ErrorState title={`Couldn't load ${title.toLowerCase()}`} message="Something went wrong on our end. Please try again." onRetry={res.reload} />
      ) : (
        <RankedBars rows={res.items} emptyLabel={emptyLabel} />
      )}
    </div>
  );
}

function OverviewTab({ demo, setDemo, onDataChanged }) {
  const [win, setWin] = useState("7d");
  const [refreshToken, setRefreshToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [demoStatus, setDemoStatus] = useState("");

  // After loading demo data: flip the shared view toggle ON so the whole
  // dashboard (telemetry + population + member counts + listing) shows the demo
  // data, refetch every telemetry resource, refresh the parent stats, and note
  // it. After clearing: refetch + refresh stats + note. (Both keep the window.)
  const handleDemoLoaded = useCallback(() => {
    setDemo(true);
    setRefreshToken((x) => x + 1);
    setDemoStatus("Sample data loaded — showing the demo view.");
    onDataChanged?.();
  }, [setDemo, onDataChanged]);
  const handleDemoCleared = useCallback(() => {
    setRefreshToken((x) => x + 1);
    setDemoStatus("Demo data cleared.");
    onDataChanged?.();
  }, [onDataChanged]);

  // Telemetry queries key off window+demo+refresh; member-domains ignores both
  // (it's member data, not visitor telemetry) so it only refetches on refresh.
  const telemetryKey = `${win}|${demo ? 1 : 0}|${refreshToken}`;
  const overview = useAdminResource(() => getTelemetryOverview(win, demo), telemetryKey);
  const uptime = useAdminResource(() => getTelemetryUptime(demo), `${demo ? 1 : 0}|${refreshToken}`);
  const geo = useAdminList(() => getTelemetryGeo(win, demo), telemetryKey);
  const referrers = useAdminList(() => getTelemetryReferrers(win, demo), telemetryKey);
  const domains = useAdminList(() => getMemberDomains(), `dom-${refreshToken}`);

  // Stamp "Updated HH:MM" whenever the primary (overview) resource settles.
  useEffect(() => { if (!overview.loading) setUpdatedAt(Date.now()); }, [overview.loading]);

  const visitsSeries = Array.isArray(overview.data?.series) ? overview.data.series.map((s) => s.views || 0) : [];

  return (
    <div>
      {/* Header: window + demo toggle on the left; freshness + refresh right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
          <Segmented options={WINDOW_OPTIONS} value={win} onChange={setWin} ariaLabel="Telemetry time window" />
          <DemoToggle value={demo} onChange={setDemo} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: t.textMuted }}>
            {updatedAt ? `Updated ${formatClock(updatedAt)}` : "Loading…"}
          </span>
          <PlainButton kind="neutral" onClick={() => setRefreshToken((x) => x + 1)}>Refresh</PlainButton>
        </div>
      </div>

      {/* Demo-data controls (admin) + calm status. Loading furnishes the demo
          dashboard from clearly-flagged sample data; clearing removes it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0, marginBottom: 16 }}>
        <DemoDataControls onLoaded={handleDemoLoaded} onCleared={handleDemoCleared} />
        {demoStatus && (
          <span role="status" style={{ fontSize: 13, color: t.textMuted }}>{demoStatus}</span>
        )}
      </div>

      <UptimeBoard data={uptime.data} loading={uptime.loading} error={uptime.error} onRetry={uptime.reload} demo={demo} />

      {/* Visits */}
      <div style={sectionCardStyle}>
        <h2 style={zoneHeadingStyle}>Visits{demo ? " · demo data" : ""}</h2>
        {overview.loading ? (
          <div aria-hidden="true"><Skeleton width="100%" height={56} /><div style={{ height: 12 }} /><Skeleton width="60%" height={14} /></div>
        ) : overview.error ? (
          <ErrorState title="Couldn't load visits" message="Something went wrong on our end. Please try again." onRetry={overview.reload} />
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <Sparkline values={visitsSeries} ariaLabel={`Visits over the last ${win}`} />
            </div>
            <div style={telemetryGrid}>
              <StatCard label="Total views" value={overview.data.totalViews} />
              <StatCard label="Unique visitors" value={overview.data.uniqueVisitors} />
            </div>
          </>
        )}
      </div>

      <RankedSection title="Top locations" res={geo} emptyLabel="No location data in this window yet." />
      <RankedSection title="Traffic sources" res={referrers} emptyLabel="No referrers in this window yet." />
      <RankedSection
        title="Member email domains"
        res={domains}
        emptyLabel="No members yet."
        note="Real members only — excludes test and demo accounts."
      />
    </div>
  );
}

// ─── Population / Demographics tab ──────────────────────────────────────────
// Real-member aggregate breakdowns (test/demo excluded server side) of the
// CHOSEN profile fields, for marketing/reporting. This is REAL member data
// (existing profile fields) — DISTINCT from the anonymous visitor telemetry in
// the Overview tab. Each breakdown is a static RankedBars (calm, no live
// ticker). Buckets of 1–4 arrive ALREADY masked ("<5") from the backend
// (k-anonymity, k=5) — the exact small count never reaches the client. Tapping a
// bar drills into the Members tab pre-filtered to that value.
const MULTI_SELECT_NOTE = "Members can choose more than one, so these can add up to more than the member count.";
const POPULATION_SECTIONS_KEY = "spectrum_admin_population_sections";
const POP_BREAKDOWNS = [
  { id: "gender", title: "Gender", filterKey: "gender" },
  { id: "orientation", title: "Sexual orientation", filterKey: "orientation", note: MULTI_SELECT_NOTE },
  { id: "seeking", title: "Seeking", filterKey: "seeking", note: MULTI_SELECT_NOTE },
  { id: "relationshipStructure", title: "Relationship structure", filterKey: "relationshipStructure", note: MULTI_SELECT_NOTE },
  { id: "relationshipGoal", title: "Relationship goal", filterKey: "relationshipGoal" },
  { id: "ageBands", title: "Age", filterKey: "age" },
  { id: "location", title: "Location", filterKey: "city" },
  // Interests are not a member-list filter, so this breakdown is display-only.
  { id: "interests", title: "Top interests", filterKey: null },
];

function PopulationTab({ onDrill, demo = false }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [openSections, setOpenSections] = useState(() => {
    const base = Object.fromEntries(POP_BREAKDOWNS.map((b) => [b.id, true]));
    try {
      const raw = localStorage.getItem(POPULATION_SECTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? { ...base, ...parsed } : base;
    } catch { return base; }
  });

  const pop = useAdminResource(() => getPopulation(demo), `pop-${demo ? 1 : 0}-${refreshToken}`);
  useEffect(() => { if (!pop.loading) setUpdatedAt(Date.now()); }, [pop.loading]);

  const toggle = useCallback((id) => {
    setOpenSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(POPULATION_SECTIONS_KEY, JSON.stringify(next)); } catch { /* private-mode/quota — non-fatal */ }
      return next;
    });
  }, []);

  // Turn a tapped bar into a member-list filter payload. Empty-valued buckets
  // ("Not specified" / "Open to everyone" / "Other") carry no `value` and never
  // reach here (RankedBars renders them non-interactive).
  const drill = useCallback((bd, row) => {
    const v = row?.value;
    if (v === undefined || v === null || v === "") return;
    if (bd.filterKey === "age") onDrill?.({ ageMin: v.ageMin, ageMax: v.ageMax ?? null });
    else if (bd.filterKey) onDrill?.({ [bd.filterKey]: v });
  }, [onDrill]);

  const total = pop.data?.totalMembers ?? 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1 }}>
            {pop.loading ? "…" : total.toLocaleString()}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted }}>
            {demo ? "members · demo view (includes sample members)" : "members · real accounts only (excludes test & demo)"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: t.textMuted }}>
            {updatedAt ? `Updated ${formatClock(updatedAt)}` : "Loading…"}
          </span>
          <PlainButton kind="neutral" onClick={() => setRefreshToken((x) => x + 1)}>Refresh</PlainButton>
        </div>
      </div>

      <p style={{ margin: "0 0 16px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
        A small count (fewer than 5) shows as “&lt;5” to protect members’ privacy. Tap a bar to open those members.
      </p>

      {pop.error ? (
        <ErrorState title="Couldn't load the population report" message="Something went wrong on our end. Please try again." onRetry={pop.reload} />
      ) : (
        POP_BREAKDOWNS.map((bd) => (
          <AdminCollapsible
            key={bd.id}
            id={`pop-${bd.id}`}
            title={bd.title}
            open={openSections[bd.id]}
            onToggle={() => toggle(bd.id)}
            style={sectionCardStyle}
          >
            {bd.note && <p style={{ margin: "0 0 10px", fontSize: 13, color: t.textMuted }}>{bd.note}</p>}
            {pop.loading ? (
              <div aria-hidden="true"><Skeleton width="90%" height={12} /><div style={{ height: 8 }} /><Skeleton width="70%" height={12} /><div style={{ height: 8 }} /><Skeleton width="50%" height={12} /></div>
            ) : (
              <RankedBars
                rows={pop.data?.[bd.id] || []}
                emptyLabel="No members yet."
                onSelect={bd.filterKey ? (row) => drill(bd, row) : undefined}
                ariaAction={bd.filterKey ? `Filter members by ${bd.title.toLowerCase()}` : undefined}
              />
            )}
          </AdminCollapsible>
        ))
      )}
    </div>
  );
}

// ─── Transparency tab ───────────────────────────────────────────────────────
// Aggregate enforcement report over a period — the internal analog of a public
// "Safe Dating Report". COUNTS ONLY: the backend returns enum labels + counts +
// anonymous resolution durations, never ids/names/message content, so nothing
// here can reveal who was actioned or what was said. Calm-by-design: static
// RankedBars + StatCards, an "Updated HH:MM" stamp, no live ticker. Mirrors the
// Population tab's collapsible-section + RankedBars pattern. All hooks run before
// any early return (React #310).
const TRANSPARENCY_PERIOD_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];
const TRANSPARENCY_SECTIONS_KEY = "spectrum_admin_transparency_sections";
const TRANSPARENCY_BREAKDOWNS = [
  { id: "byAction", title: "Enforcement actions by type", pick: (d) => d.enforcement.byAction },
  { id: "byNoticeKind", title: "Due-process notices by kind", pick: (d) => d.enforcement.byNoticeKind },
  { id: "byReason", title: "Reports by reason", pick: (d) => d.reports.byReason },
  { id: "byOutcome", title: "Reports by outcome", pick: (d) => d.reports.byOutcome },
  { id: "safetyByKind", title: "Chat safety signals by kind", pick: (d) => d.safetySignals.byKind },
];

// Enum label → human-friendly ("resolve_report" → "Resolve report"). Labels are
// bounded server-side enums (action/kind/reason/status/signal_kind) — never PII.
function humanizeLabel(s) {
  const str = String(s || "").replace(/_/g, " ").trim();
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "—";
}
const humanizeRows = (rows) =>
  (Array.isArray(rows) ? rows : []).map((r) => ({ label: humanizeLabel(r.label), count: r.count }));

function TransparencyTab() {
  const [period, setPeriod] = useState("30d");
  const [refreshToken, setRefreshToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [openSections, setOpenSections] = useState(() => {
    // Breakdowns default open; the interactive QA-review section starts collapsed
    // (calm-by-design — it's a deliberate action, not passive context).
    const base = { ...Object.fromEntries(TRANSPARENCY_BREAKDOWNS.map((b) => [b.id, true])), qaReview: false };
    try {
      const raw = localStorage.getItem(TRANSPARENCY_SECTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? { ...base, ...parsed } : base;
    } catch { return base; }
  });

  const res = useAdminResource(() => getTransparency(period), `transp-${period}-${refreshToken}`);
  useEffect(() => { if (!res.loading) setUpdatedAt(Date.now()); }, [res.loading]);

  const toggle = useCallback((id) => {
    setOpenSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(TRANSPARENCY_SECTIONS_KEY, JSON.stringify(next)); } catch { /* private-mode/quota — non-fatal */ }
      return next;
    });
  }, []);

  const d = res.data;
  const median = d?.reports?.medianResolutionMs;
  const avg = d?.reports?.avgResolutionMs;

  return (
    <div>
      {/* Header: period selector left; freshness + refresh right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Segmented options={TRANSPARENCY_PERIOD_OPTIONS} value={period} onChange={setPeriod} ariaLabel="Transparency report period" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: t.textMuted }}>
            {updatedAt ? `Updated ${formatClock(updatedAt)}` : "Loading…"}
          </span>
          <PlainButton kind="neutral" onClick={() => setRefreshToken((x) => x + 1)}>Refresh</PlainButton>
        </div>
      </div>

      <p style={{ margin: "0 0 16px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
        Aggregate enforcement activity over the selected period — counts only, never who was
        actioned or what was said. Platform-wide (includes test &amp; demo activity).
      </p>

      {res.error ? (
        <ErrorState title="Couldn't load the transparency report" message="Something went wrong on our end. Please try again." onRetry={res.reload} />
      ) : (
        <>
          {/* Key totals */}
          <div style={{ ...telemetryGrid, marginBottom: 16 }}>
            <StatCard label="Reports filed" value={res.loading ? "…" : (d?.reports?.filed ?? 0)} />
            <StatCard label="Enforcement actions" value={res.loading ? "…" : (d?.enforcement?.totalActions ?? 0)} />
            <StatCard
              label="Reports resolved"
              value={res.loading ? "…" : (d?.reports?.resolvedCount ?? 0)}
              subtext={!res.loading && avg != null ? `avg ${formatDuration(avg)}` : undefined}
            />
            <StatCard
              label="Median time to resolve"
              value={res.loading ? "…" : (median != null ? formatDuration(median) : "—")}
            />
            <StatCard label="Safety signals" value={res.loading ? "…" : (d?.safetySignals?.total ?? 0)} />
          </div>

          {/* Breakdowns — one collapsible RankedBars each */}
          {TRANSPARENCY_BREAKDOWNS.map((bd) => (
            <AdminCollapsible
              key={bd.id}
              id={`transp-${bd.id}`}
              title={bd.title}
              open={openSections[bd.id]}
              onToggle={() => toggle(bd.id)}
              style={sectionCardStyle}
            >
              {res.loading ? (
                <div aria-hidden="true"><Skeleton width="90%" height={12} /><div style={{ height: 8 }} /><Skeleton width="70%" height={12} /><div style={{ height: 8 }} /><Skeleton width="50%" height={12} /></div>
              ) : (
                <RankedBars rows={humanizeRows(bd.pick(d))} emptyLabel="Nothing in this period yet." />
              )}
            </AdminCollapsible>
          ))}

          {/* Moderator QA / decision re-review — calibration only, no punitive
              action. Summary reads from the same transparency payload; the
              sample fetch + verdicts live in QaReviewContent. */}
          <AdminCollapsible
            id="transp-qaReview"
            title="Moderator QA (calibration)"
            open={openSections.qaReview}
            onToggle={() => toggle("qaReview")}
            style={sectionCardStyle}
          >
            <QaReviewContent qa={d?.qa} loading={res.loading} onReviewed={() => setRefreshToken((x) => x + 1)} />
          </AdminCollapsible>
        </>
      )}
    </div>
  );
}

// Moderator QA / decision re-review sampling — calibration-only (no punitive
// action, no per-moderator scoreboard). Shows the aggregate agreement rate from
// the transparency payload, then lets an admin pull a small random sample of
// resolved decisions they did NOT make and mark each Agree/Disagree with an
// optional note. Calm-by-design: neither verdict is red, a muted amber tone
// appears ONLY when disagreement is notably high on a meaningful sample (never
// color-shaming a tiny one). All hooks run before any early return (React #310).
function QaReviewContent({ qa, loading, onReviewed }) {
  const [sample, setSample] = useState(null); // null = not pulled yet; [] = empty
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState("");
  const [notes, setNotes] = useState({}); // reportId → note text
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState({}); // reportId → error message

  const loadSample = useCallback(async () => {
    setSampleLoading(true);
    setSampleError("");
    try {
      setSample(await getQaSample(5));
    } catch (err) {
      setSampleError(safeErrorMessage(err, "Couldn't pull a sample. Please try again."));
    } finally {
      setSampleLoading(false);
    }
  }, []);

  const submit = useCallback(async (reportId, verdict) => {
    setBusyId(reportId);
    setRowError((p) => ({ ...p, [reportId]: "" }));
    try {
      await submitQaReview(reportId, verdict, notes[reportId] || "");
      setSample((prev) => (prev || []).filter((r) => r.id !== reportId));
      if (onReviewed) onReviewed(); // refresh the aggregate summary
    } catch (err) {
      setRowError((p) => ({ ...p, [reportId]: safeErrorMessage(err, "Couldn't record that. Please try again.") }));
    } finally {
      setBusyId(null);
    }
  }, [notes, onReviewed]);

  const total = qa?.totalReviews ?? 0;
  const pct = Math.round((qa?.agreementRate ?? 0) * 100);
  // Muted amber only when disagreement is notably high AND the sample is big
  // enough to mean something — never a scarlet letter on 1–2 reviews.
  const concern = total >= 5 && pct < 70;

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
        Re-review a random sample of resolved decisions you didn't make, to check consistency between
        moderators. Calibration only — recording a verdict takes no action against anyone.
      </p>

      {/* Aggregate calibration health (from the transparency payload) */}
      <div
        style={{
          display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
          background: concern ? t.warningSurface : t.surfaceAlt,
          border: `1px solid ${concern ? t.warningBorder : t.border}`,
          borderRadius: 12, padding: "12px 14px", marginBottom: 14,
        }}
      >
        {loading ? (
          <span style={{ fontSize: 14, color: t.textMuted }}>Loading calibration health…</span>
        ) : total > 0 ? (
          <>
            <span style={{ fontSize: 20, fontWeight: 700, fontFamily: t.serif, color: concern ? t.warningSurfaceText : t.text, lineHeight: 1.1 }}>
              Agreement {pct}%
            </span>
            <span style={{ fontSize: 13, color: concern ? t.warningSurfaceText : t.textMuted }}>
              · {total} review{total === 1 ? "" : "s"} this period
            </span>
          </>
        ) : (
          <span style={{ fontSize: 14, color: t.textMuted }}>No calibration reviews in this period yet.</span>
        )}
      </div>

      {/* Sample controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: sample ? 14 : 0 }}>
        <PlainButton kind="neutral" onClick={loadSample} disabled={sampleLoading}>
          {sampleLoading ? "Pulling a sample…" : (sample ? "Pull another sample" : "Review a sample")}
        </PlainButton>
      </div>

      {sampleError && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: t.warningSurfaceText }}>{sampleError}</p>
      )}

      {/* Sampled decisions */}
      {sample && !sampleLoading && sample.length === 0 && (
        <p style={{ margin: "6px 0 0", fontSize: 14, color: t.textMuted }}>No decisions to review right now.</p>
      )}

      {sample && sample.map((r) => (
        <div
          key={r.id}
          style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 16px", background: t.surface, marginBottom: 12 }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{humanizeLabel(r.reason)}</span>
            <span style={{ fontSize: 13, color: t.textMuted }}>· {r.status ? humanizeLabel(r.status) : "Resolved"}</span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
            Reported member: <span style={{ color: t.text }}>{r.reportedName || "—"}</span>
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
            Resolved by: <span style={{ color: t.text }}>{r.resolvedBy?.displayName || r.resolvedBy?.email || "—"}</span>
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
            <span style={{ color: t.textMuted }}>Action / note: </span>
            {r.moderatorNote ? r.moderatorNote : <span style={{ color: t.textMuted, fontStyle: "italic" }}>none recorded</span>}
          </p>

          <label
            htmlFor={`qa-note-${r.id}`}
            style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "12px 0 6px" }}
          >
            Note (optional)
          </label>
          <textarea
            id={`qa-note-${r.id}`}
            value={notes[r.id] || ""}
            onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value.slice(0, 500) }))}
            maxLength={500}
            rows={2}
            style={{
              width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
              fontSize: 16, color: t.text, background: t.bg, resize: "vertical", fontFamily: t.sans,
              lineHeight: 1.5, boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <PlainButton kind="accent" onClick={() => submit(r.id, "agree")} disabled={busyId === r.id}>
              Agree
            </PlainButton>
            <PlainButton kind="neutral" onClick={() => submit(r.id, "disagree")} disabled={busyId === r.id}>
              Disagree
            </PlainButton>
          </div>

          {rowError[r.id] && (
            <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: t.warningSurfaceText }}>{rowError[r.id]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Members tab ────────────────────────────────────────────────────────────
const MEMBER_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "removed", label: "Removed" },
  { value: "verified", label: "Verified" },
];
const MEMBER_SORT_OPTIONS = [
  { value: "joined", label: "Newest" },
  { value: "reports", label: "Most reported" },
];
const MEMBER_PAGE_SIZE = 25;

// Demographic filter options for the Members tab (mirror the backend VALID_*
// enums in server/src/routes/profile.js). Used both for direct filtering and as
// the drill-in target from a Population-tab bar tap.
const GENDER_FILTER_OPTIONS = [
  "woman", "man", "nonbinary", "other", "agender", "genderfluid", "genderqueer",
  "trans-man", "trans-woman", "two-spirit", "bigender", "intersex", "questioning",
];
const ORIENTATION_FILTER_OPTIONS = [
  "straight", "gay", "lesbian", "bisexual", "pansexual", "asexual", "demisexual", "queer", "questioning",
];
const SEEKING_FILTER_OPTIONS = ["woman", "man", "nonbinary"];
const REL_STRUCTURE_FILTER_OPTIONS = ["monogamous", "open", "polyamorous", "queerplatonic", "figuring-it-out"];
const REL_GOAL_FILTER_OPTIONS = ["long-term", "friendship", "open"];

// A single labelled <select> for a demographic filter. "" = Any (no filter).
function FilterSelect({ label, value, onChange, options }) {
  const f = useFocusable();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: t.textSoft, minWidth: 0 }}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          minHeight: 40, padding: "8px 10px", borderRadius: 10, border: `1px solid ${t.formBorder}`,
          background: t.surface, color: t.text, fontSize: 16, fontFamily: t.sans, minWidth: 0, ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

// Coarse status badge for a member row (active/suspended/removed). Reuses the
// report StatusBadge palette semantics: banned/suspended = danger, active =
// neutral. A permanent ban ('Removed') outranks a suspension in the label.
function MemberStatusBadge({ suspended, verified, banned }) {
  const label = banned ? "Removed" : suspended ? "Suspended" : "Active";
  const enforced = banned || suspended;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 13, fontWeight: 600, borderRadius: 20, padding: "3px 10px",
          ...(enforced
            ? { background: t.dangerFill, color: "#fff", border: `1px solid ${t.dangerFill}` }
            : { background: t.surfaceAlt, color: t.text, border: `1px solid ${t.border}` }),
        }}
      >
        {label}
      </span>
      {verified && (
        <span style={{ fontSize: 13, color: t.positiveText, fontWeight: 600 }}>
          <span aria-hidden="true">✓ </span>Verified
        </span>
      )}
    </span>
  );
}

// Membership-tier pill for a member row — Companion reads as a calm accent-
// outlined pill, Free as a neutral muted pill. The WORD is always present (never
// color-only) and neither uses an alarm color, so both themes stay low-stimulation.
function TierBadge({ tier }) {
  const companion = tier === "companion";
  return (
    <span
      style={{
        display: "inline-block", fontSize: 13, fontWeight: 600, borderRadius: 20,
        padding: "3px 10px", whiteSpace: "nowrap",
        ...(companion
          ? { background: t.surface, color: t.accentStrong, border: `1px solid ${t.accent}` }
          : { background: t.surfaceAlt, color: t.textMuted, border: `1px solid ${t.border}` }),
      }}
    >
      {companion ? "Companion" : "Free"}
    </span>
  );
}

// "YYYY-MM-DD" (or a date-ish value) → a short calm date. Empty → "".
function formatDate(value) {
  if (!value) return "";
  const d = new Date(typeof value === "number" ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function MembersTableSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "12px 8px", borderBottom: `1px solid ${t.borderLight}` }}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="20%" height={14} />
          <Skeleton width="15%" height={14} />
        </div>
      ))}
    </div>
  );
}

// `initialStatus` seeds the status filter and `initialFilters` seeds the
// demographic filters so a stat-card OR Population-tab-bar jump lands
// pre-filtered. The parent remounts this tab (via a key) on each jump, so the
// initial values always reflect the latest request without fighting the user's
// manual filtering.
function MembersTab({ initialStatus = "all", initialFilters = {}, includeDemo = false }) {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [sort, setSort] = useState("joined");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  // Independent opt-in to also list the @spectrum-test.dev QA accounts. Separate
  // from the demo view (includeDemo, driven by the shared Demo toggle) — both
  // default OFF so the real-member listing stays clean.
  const [includeTest, setIncludeTest] = useState(false);
  // Membership-tier segment (All / Free / Companion). "" = All (no filter).
  const [tier, setTier] = useState("");
  // Demographic filters (seeded from a drill-in; "" / "" number = inactive).
  const [gender, setGender] = useState(initialFilters.gender || "");
  const [orientation, setOrientation] = useState(initialFilters.orientation || "");
  const [seeking, setSeeking] = useState(initialFilters.seeking || "");
  const [relationshipStructure, setRelationshipStructure] = useState(initialFilters.relationshipStructure || "");
  const [relationshipGoal, setRelationshipGoal] = useState(initialFilters.relationshipGoal || "");
  const [city, setCity] = useState(initialFilters.city || "");
  const [ageMin, setAgeMin] = useState(initialFilters.ageMin != null ? String(initialFilters.ageMin) : "");
  const [ageMax, setAgeMax] = useState(initialFilters.ageMax != null ? String(initialFilters.ageMax) : "");
  // Open the demographic-filter panel automatically when arriving pre-filtered.
  const anyInitialFilter = Object.keys(initialFilters).length > 0;
  const [filtersOpen, setFiltersOpen] = useState(anyInitialFilter);
  const fSearch = useFocusable();

  // Debounce the free-text search (350ms) so we don't fire a request per key.
  useEffect(() => {
    const id = setTimeout(() => { setQuery(queryInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [queryInput]);

  // Any demographic filter change resets to page 1.
  const onFilter = useCallback((setter) => (v) => { setter(v); setPage(1); }, []);
  const activeFilterCount = [gender, orientation, seeking, relationshipStructure, relationshipGoal, city, ageMin, ageMax].filter((v) => v !== "").length;
  const clearFilters = useCallback(() => {
    setGender(""); setOrientation(""); setSeeking(""); setRelationshipStructure("");
    setRelationshipGoal(""); setCity(""); setAgeMin(""); setAgeMax(""); setPage(1);
  }, []);

  const listKey = `${query}|${status}|${sort}|${page}|${gender}|${orientation}|${seeking}|${relationshipStructure}|${relationshipGoal}|${city}|${ageMin}|${ageMax}|${tier}|${includeDemo ? 1 : 0}|${includeTest ? 1 : 0}|${refreshToken}`;
  const res = useAdminResource(
    () => getMembers({
      query, status, page, pageSize: MEMBER_PAGE_SIZE, sort,
      gender, orientation, seeking, relationshipStructure, relationshipGoal, city,
      ageMin: ageMin === "" ? null : parseInt(ageMin, 10),
      ageMax: ageMax === "" ? null : parseInt(ageMax, 10),
      tier, includeDemo, includeTest,
    }),
    listKey
  );

  useEffect(() => { if (!res.loading) setUpdatedAt(Date.now()); }, [res.loading]);

  const total = res.data?.total ?? 0;
  const members = res.data?.members ?? [];
  const totalPages = Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE));

  // Per-tier counts (faceted — reflect the current query/status/demographic
  // filters, ignoring which tier segment is selected). Labelled into the segment.
  const tierCounts = res.data?.tierCounts ?? { free: 0, companion: 0 };
  const tierOptions = [
    { value: "", label: `All · ${tierCounts.free + tierCounts.companion}` },
    { value: "free", label: `Free · ${tierCounts.free}` },
    { value: "companion", label: `Companion · ${tierCounts.companion}` },
  ];

  const changeStatus = useCallback((v) => { setStatus(v); setPage(1); }, []);
  const changeSort = useCallback((v) => { setSort(v); setPage(1); }, []);
  const changeTier = useCallback((v) => { setTier(v); setPage(1); }, []);

  const cellHead = { textAlign: "left", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.textMuted, padding: "8px 10px", whiteSpace: "nowrap", borderBottom: `1px solid ${t.border}` };
  const cell = { fontSize: 14, color: t.text, padding: "12px 10px", borderBottom: `1px solid ${t.borderLight}`, verticalAlign: "top" };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <input
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search members by name or email"
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", borderRadius: 11,
            border: `1px solid ${t.formBorder}`, background: t.surface, color: t.text, fontSize: 16, fontFamily: t.sans,
            ...fSearch.style,
          }}
          onFocus={fSearch.onFocus}
          onBlur={fSearch.onBlur}
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
            <Segmented options={MEMBER_STATUS_OPTIONS} value={status} onChange={changeStatus} ariaLabel="Filter members by status" />
            <Segmented options={MEMBER_SORT_OPTIONS} value={sort} onChange={changeSort} ariaLabel="Sort members" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: t.textMuted }}>
              {updatedAt ? `Updated ${formatClock(updatedAt)}` : "Loading…"}
            </span>
            <PlainButton kind="neutral" onClick={() => setRefreshToken((x) => x + 1)}>Refresh</PlainButton>
          </div>
        </div>

        {/* Membership tier breakout — segment members by Free vs Companion, with
            per-tier counts (faceted to the current filters). A calm, scannable
            row; the count lives in each segment's label so it's never a wall. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: t.textMuted }}>Membership tier</span>
          <Segmented options={tierOptions} value={tier} onChange={changeTier} ariaLabel="Filter members by membership tier" />
        </div>

        {/* Demographic filters — collapsible so they don't overwhelm by default.
            Drill-ins from the Population tab open this pre-filtered. */}
        <AdminCollapsible
          id="memberFilters"
          title={activeFilterCount > 0 ? `Filters · ${activeFilterCount} active` : "Filters"}
          open={filtersOpen}
          onToggle={() => setFiltersOpen((v) => !v)}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            <FilterSelect label="Gender" value={gender} onChange={onFilter(setGender)} options={GENDER_FILTER_OPTIONS} />
            <FilterSelect label="Orientation" value={orientation} onChange={onFilter(setOrientation)} options={ORIENTATION_FILTER_OPTIONS} />
            <FilterSelect label="Seeking" value={seeking} onChange={onFilter(setSeeking)} options={SEEKING_FILTER_OPTIONS} />
            <FilterSelect label="Relationship structure" value={relationshipStructure} onChange={onFilter(setRelationshipStructure)} options={REL_STRUCTURE_FILTER_OPTIONS} />
            <FilterSelect label="Relationship goal" value={relationshipGoal} onChange={onFilter(setRelationshipGoal)} options={REL_GOAL_FILTER_OPTIONS} />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: t.textSoft, minWidth: 0 }}>
              <span>City</span>
              <input
                type="text"
                value={city}
                onChange={(e) => onFilter(setCity)(e.target.value)}
                placeholder="Exact city"
                aria-label="Filter members by city"
                style={{ minHeight: 40, padding: "8px 10px", borderRadius: 10, border: `1px solid ${t.formBorder}`, background: t.surface, color: t.text, fontSize: 16, fontFamily: t.sans, minWidth: 0, boxSizing: "border-box" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: t.textSoft, minWidth: 0 }}>
              <span>Age min</span>
              <input
                type="number" inputMode="numeric" min={18} max={99}
                value={ageMin}
                onChange={(e) => onFilter(setAgeMin)(e.target.value)}
                aria-label="Minimum age"
                style={{ minHeight: 40, padding: "8px 10px", borderRadius: 10, border: `1px solid ${t.formBorder}`, background: t.surface, color: t.text, fontSize: 16, fontFamily: t.sans, minWidth: 0, boxSizing: "border-box" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: t.textSoft, minWidth: 0 }}>
              <span>Age max</span>
              <input
                type="number" inputMode="numeric" min={18} max={99}
                value={ageMax}
                onChange={(e) => onFilter(setAgeMax)(e.target.value)}
                aria-label="Maximum age"
                style={{ minHeight: 40, padding: "8px 10px", borderRadius: 10, border: `1px solid ${t.formBorder}`, background: t.surface, color: t.text, fontSize: 16, fontFamily: t.sans, minWidth: 0, boxSizing: "border-box" }}
              />
            </label>
          </div>
          {/* Independent account-visibility opt-ins. Demo members follow the
              shared "Demo data" toggle in Overview; test accounts have their own
              switch here. Both default OFF so the real-member view stays clean. */}
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer", fontSize: 14, color: t.textSoft }}>
              <input
                type="checkbox"
                checked={includeTest}
                onChange={(e) => { setIncludeTest(e.target.checked); setPage(1); }}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              Show test accounts (<code style={{ fontSize: 13 }}>@spectrum-test.dev</code>)
            </label>
            {includeDemo && (
              <p style={{ margin: 0, fontSize: 13, color: t.textMuted }}>
                Demo members are included — controlled by the “Demo data” toggle in Overview.
              </p>
            )}
          </div>
          {activeFilterCount > 0 && (
            <div style={{ marginTop: 12 }}>
              <PlainButton kind="quiet" onClick={clearFilters}>Clear filters</PlainButton>
            </div>
          )}
        </AdminCollapsible>
      </div>

      {res.loading ? (
        <MembersTableSkeleton />
      ) : res.error ? (
        <ErrorState title="Couldn't load members" message="Something went wrong on our end. Please try again." onRetry={res.reload} />
      ) : members.length === 0 ? (
        <EmptyCard>No members match these filters.</EmptyCard>
      ) : (
        <>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${t.border}`, borderRadius: 14, background: t.surface, boxShadow: t.shadow.sm }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={cellHead}>Member</th>
                  <th style={cellHead}>Status</th>
                  <th style={cellHead}>Tier</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>Reports</th>
                  <th style={cellHead}>Joined</th>
                  <th style={cellHead}>City</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setOpenId(m.id)}
                    // Subtle calm hover so the whole-row target is discoverable.
                    // A plain background swap (no motion/transition) mutated on the
                    // row element itself — no extra state, no table-wide re-render.
                    // The Name-cell button still owns the keyboard path (no new tab stop).
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.surfaceAlt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    style={{ cursor: "pointer", background: "transparent" }}
                  >
                    <td style={cell}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenId(m.id); }}
                        style={{ display: "block", textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: t.text, maxWidth: 260 }}
                        aria-label={`Open details for ${m.displayName || m.email}`}
                      >
                        <span style={{ display: "block", fontWeight: 600, color: t.accentStrong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.displayName || "Unnamed member"}
                        </span>
                        <span style={{ display: "block", fontSize: 13, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.email}
                        </span>
                      </button>
                    </td>
                    <td style={cell}><MemberStatusBadge suspended={m.suspended} verified={m.verified} banned={m.banned} /></td>
                    <td style={cell}><TierBadge tier={m.tier} /></td>
                    <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {m.reportCount}
                      {m.reportCount > 0 && m.actionedCount > 0 && (
                        <span style={{ color: t.textMuted }}> ({m.actionedCount} actioned)</span>
                      )}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap", color: t.textSoft }}>{formatDate(m.createdAt)}</td>
                    <td style={{ ...cell, color: t.textSoft }}>{m.distCity || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            <span style={{ fontSize: 13, color: t.textMuted }}>
              {total} member{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <PlainButton kind="neutral" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</PlainButton>
              <PlainButton kind="neutral" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</PlainButton>
            </div>
          </div>
        </>
      )}

      {openId && <MemberDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// Member detail drawer — full status, verification, report history, block
// count, account age, and the admin-only "Last active" date. Focus management
// per the moderation-console a11y conventions: focus moves in on open, Escape
// closes, Tab is trapped inside, and focus is restored to the trigger on close.
function MemberDrawer({ id, onClose }) {
  const { data, loading, error, reload } = useAdminResource(() => getMemberDetail(id), id);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    // Remember what was focused so we can restore it on close.
    returnFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
    // Move focus into the drawer (close button) on open.
    const id2 = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      clearTimeout(id2);
      const el = returnFocusRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    // Basic focus trap — keep Tab inside the panel.
    const focusables = panelRef.current?.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const c = data?.userContext || {};
  const lastActive = data?.lastActiveAt ? formatDate(data.lastActiveAt) : "";

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,51,45,0.45)", display: "flex", justifyContent: "flex-end", zIndex: 1000 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Member details"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: "min(440px, 100%)", height: "100%", background: t.bg, boxShadow: t.shadow.lg,
          padding: "20px 20px 40px", overflowY: "auto", boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text, margin: 0, minWidth: 0 }}>Member details</h2>
          <PlainButton kind="quiet" onClick={onClose} buttonRef={closeRef} ariaLabel="Close member details">Close</PlainButton>
        </div>

        {loading ? (
          <div aria-hidden="true"><Skeleton width="60%" height={20} /><div style={{ height: 12 }} /><Skeleton width="90%" height={14} /><div style={{ height: 8 }} /><Skeleton width="70%" height={14} /></div>
        ) : error || !data ? (
          <ErrorState title="Couldn't load this member" message="Something went wrong on our end. Please try again." onRetry={reload} />
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: t.text, wordBreak: "break-word" }}>{c.displayName || "Unnamed member"}</div>
            {c.email && <div style={{ fontSize: 14, color: t.textMuted, wordBreak: "break-word", marginTop: 2 }}>{c.email}</div>}
            <div style={{ marginTop: 10 }}>
              <MemberStatusBadge suspended={data.suspended} verified={data.verified} banned={data.banned} />
            </div>

            {/* Key facts */}
            <dl style={{ margin: "16px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", fontSize: 14 }}>
              <dt style={{ color: t.textMuted }}>City</dt>
              <dd style={{ margin: 0, color: t.text }}>{c.distCity || "—"}</dd>
              <dt style={{ color: t.textMuted }}>Joined</dt>
              <dd style={{ margin: 0, color: t.text }}>{formatTimestamp(data.accountCreatedAt)}</dd>
              <dt style={{ color: t.textMuted }}>Account age</dt>
              <dd style={{ margin: 0, color: t.text }}>{formatDuration(data.accountAgeMs) || "—"}</dd>
              <dt style={{ color: t.textMuted }}>Last active</dt>
              <dd style={{ margin: 0, color: lastActive ? t.text : t.textMuted }}>{lastActive || "Not recorded yet"}</dd>
              <dt style={{ color: t.textMuted }}>Reports against</dt>
              <dd style={{ margin: 0, color: t.text }}>{data.reportsAgainst} ({data.reportsActioned} actioned)</dd>
              <dt style={{ color: t.textMuted }}>Blocked by</dt>
              <dd style={{ margin: 0, color: t.text }}>{data.distinctBlockers} member{data.distinctBlockers === 1 ? "" : "s"}</dd>
            </dl>

            {/* Needed #7/#11 — enforcement ladder (state + Warn/Suspend/Ban) */}
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "0 0 4px" }}>Enforcement</h3>
              <EnforcementActions
                userId={data.userContext?.userId || id}
                userName={c.displayName || "this member"}
                banned={!!data.banned}
                suspended={!!data.suspended}
                warnCount={data.warnCount ?? 0}
                latestNotice={data.latestNotice}
                includeSuspend={true}
                onChanged={reload}
              />
            </div>

            {/* Manual access — admin role + Companion subscription, granted
                directly. Serious/deliberate (a privilege-escalation surface) but
                calm. Every admin-role change is audit-logged server-side. */}
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "0 0 8px" }}>Manual access</h3>
              <MemberManualAccess
                userId={data.userContext?.userId || id}
                userName={c.displayName}
                isEnvAdmin={!!data.isEnvAdmin}
                isDbAdmin={!!data.isDbAdmin}
                tier={data.tier || "free"}
                onRoleChanged={reload}
              />
            </div>

            {/* Report history */}
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: t.textSoft, margin: "0 0 8px" }}>Report history</h3>
              {(!data.reportsAgainstList || data.reportsAgainstList.length === 0) ? (
                <p style={{ margin: 0, fontSize: 14, color: t.textMuted }}>No reports filed against this member.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.reportsAgainstList.map((r) => (
                    <li key={r.id} style={{ border: `1px solid ${t.borderLight}`, borderRadius: 12, padding: "12px 14px", background: t.surface }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: t.text, textTransform: "capitalize" }}>{r.reason || "—"}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
                        {r.reporterName ? `From ${r.reporterName} · ` : ""}{formatTimestamp(r.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Privacy-safe activity drill-in for the Matches / Messages cards. Reuses the
// MemberDrawer overlay + focus conventions (focus in on open, Escape closes,
// Tab trapped, focus restored on close) and the static Sparkline. Shows a
// per-UTC-day COUNT trend + the all-time total for one metric — COUNTS ONLY.
// It never fetches or renders identities, match pairs, or message content
// (the backend can't return them), so who-matched-whom / message bodies are
// impossible to surface here. Calm-by-design: no live ticker, the chart is the
// static Sparkline. All hooks run before any early return (React #310).
const ACTIVITY_WINDOWS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function ActivityDrawer({ metric, onClose }) {
  const [win, setWin] = useState("7d");
  const { data, loading, error, reload } = useAdminResource(() => getActivityTrends(win), `${metric}|${win}`);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
    const id = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      clearTimeout(id);
      const el = returnFocusRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const isMatches = metric === "matches";
  const title = isMatches ? "Match activity" : "Message activity";
  const daily = (isMatches ? data?.matchesDaily : data?.messagesDaily) || [];
  const total = (isMatches ? data?.totalMatches : data?.totalMessages) ?? 0;
  const values = daily.map((d) => d.count || 0);
  const windowed = values.reduce((a, b) => a + b, 0);
  const winLabel = win === "30d" ? "30 days" : "7 days";
  const noun = isMatches ? "matches" : "messages";

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,51,45,0.45)", display: "flex", justifyContent: "flex-end", zIndex: 1000 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — aggregate counts`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: "min(440px, 100%)", height: "100%", background: t.bg, boxShadow: t.shadow.lg,
          padding: "20px 20px 40px", overflowY: "auto", boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text, margin: 0, minWidth: 0 }}>{title}</h2>
          <PlainButton kind="quiet" onClick={onClose} buttonRef={closeRef} ariaLabel={`Close ${title.toLowerCase()}`}>Close</PlainButton>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
          Aggregate counts only — never who matched whom or any message content.
        </p>

        <div style={{ marginBottom: 16 }}>
          <Segmented options={ACTIVITY_WINDOWS} value={win} onChange={setWin} ariaLabel={`${title} time window`} />
        </div>

        {loading ? (
          <div aria-hidden="true"><Skeleton width="100%" height={56} /><div style={{ height: 12 }} /><Skeleton width="60%" height={14} /></div>
        ) : error || !data ? (
          <ErrorState title={`Couldn't load ${title.toLowerCase()}`} message="Something went wrong on our end. Please try again." onRetry={reload} />
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              {values.length > 0 ? (
                <Sparkline values={values} ariaLabel={`${noun} per day over the last ${winLabel}`} />
              ) : (
                <div style={{ fontSize: 14, color: t.textMuted }}>No {noun} in this window yet.</div>
              )}
            </div>
            <div style={telemetryGrid}>
              <StatCard label={`Total ${noun}`} value={total} />
              <StatCard label={`Last ${winLabel}`} value={windowed} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Moderation console v2: four calm areas ─────────────────────────────────
// The old 10-tab strip + 5 always-open dashboard zones collapse into four
// progressively-disclosed AREAS. Only the chosen area renders (one focus of
// attention at a time — the neurodivergent-admin ask). Casework-first: QUEUE is
// the default landing.
//   • QUEUE    — reports · merged photo review · verification (+ triage row)
//   • MEMBERS  — member directory + tier breakout + drawer + demo toggle
//   • INSIGHTS — overview · population · transparency (+QA) · activity · feedback · health
//   • SYSTEM   — billing demo (tagged DEMO) · maintenance/purge
const CONSOLE_AREAS = [
  { value: "queue", label: "Queue" },
  { value: "members", label: "Members" },
  { value: "insights", label: "Insights" },
  { value: "system", label: "System" },
];

// Queue sub-views (the daily casework). Reports is default.
const QUEUE_VIEWS = [
  { value: "reports", label: "Reports" },
  { value: "photos", label: "Media review" },
  { value: "verification", label: "Verification" },
];

// Insights sub-views (all the "numbers", one at a time — never a wall).
const INSIGHTS_VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "population", label: "Population" },
  { value: "transparency", label: "Transparency" },
  { value: "activity", label: "Audit log" },
  { value: "feedback", label: "Feedback" },
  { value: "health", label: "Service health" },
];

// The merged photo-review source filter (was two near-identical tabs).
const PHOTO_SOURCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "messages", label: "Message photos" },
  { value: "profiles", label: "Profile photos" },
  { value: "audio", label: "Audio" },
];

// Top-level AREA tab — a real tab (role="tab" + aria-selected + aria-controls),
// larger and calmer than the old dense strip. Carries a word, never color-only.
// Roving tabindex (only the active tab is in the tab order). Focus ring via
// useFocusable.
function AreaTab({ id, panelId, label, active, onClick, btnRef }) {
  const f = useFocusable();
  return (
    <button
      ref={btnRef}
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      style={{
        flex: "1 1 auto", minHeight: 48, padding: "10px 16px", borderRadius: 12, border: "none",
        cursor: "pointer", fontSize: 15, whiteSpace: "nowrap", fontWeight: active ? 700 : 500,
        background: active ? t.surface : "transparent", color: active ? t.text : t.textSoft,
        boxShadow: active ? t.shadow.sm : "none", ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {label}
    </button>
  );
}

// Photo review — ONE queue with a source filter, merging the two near-identical
// photo queues (message attachments + profile photos). Each source keeps its own
// review card + required-reason reject; the filter just chooses which render.
// When "All", both render under quiet subheadings. Preserves every action.
const photoGroupHeading = { fontSize: 14, fontWeight: 700, color: t.textSoft, margin: "0 0 10px" };
function MergedPhotoQueue({ onStatus, reloadToken, onAfterAction }) {
  const [source, setSource] = useState("all");
  const showMessages = source === "all" || source === "messages";
  const showProfiles = source === "all" || source === "profiles";
  const showAudio = source === "all" || source === "audio";
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Segmented options={PHOTO_SOURCE_OPTIONS} value={source} onChange={setSource} ariaLabel="Filter media review by source" />
      </div>
      {showMessages && (
        <section aria-label="Message photos" style={{ marginBottom: source === "all" ? 24 : 0 }}>
          {source === "all" && <h3 style={photoGroupHeading}>Message photos</h3>}
          <PhotoReviewQueue onStatus={onStatus} reloadToken={reloadToken} onAfterAction={onAfterAction} />
        </section>
      )}
      {showProfiles && (
        <section aria-label="Profile photos" style={{ marginBottom: source === "all" ? 24 : 0 }}>
          {source === "all" && <h3 style={photoGroupHeading}>Profile photos</h3>}
          <ProfilePhotoReviewQueue onStatus={onStatus} reloadToken={reloadToken} onAfterAction={onAfterAction} />
        </section>
      )}
      {showAudio && (
        <section aria-label="Audio answers">
          {source === "all" && <h3 style={photoGroupHeading}>Audio answers</h3>}
          <AudioReviewQueue onStatus={onStatus} reloadToken={reloadToken} onAfterAction={onAfterAction} />
        </section>
      )}
    </div>
  );
}

// ─── Billing demo (paid-tier walkthrough) ─────────────────────────────────────
// A clearly-labeled DEMO surface — NEVER real billing. The self-toggle flips the
// CALLING admin's OWN tier free↔companion (source='admin_demo') so they can walk
// a client through the paid experience live; "Reset demo tiers" clears ALL
// admin_demo grants after a demo. Per-member grants live in the member drawer.
const TIER_VIEW_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "companion", label: "Companion" },
];

function BillingDemoSection({ onTierChange }) {
  const [tier, setTier] = useState(null); // 'free' | 'companion' | null (loading)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  const load = useCallback(() => {
    getMyEntitlement()
      .then((e) => {
        setTier(e.tier);
        // B19 — the calling admin IS the signed-in user, so keep the app-level
        // tier in sync with their real entitlement (covers mount + after a demo
        // reset, which clears their admin_demo grant back to free).
        onTierChange?.(e.tier);
      })
      .catch(() => setError("Couldn't load your current tier."));
  }, [onTierChange]);
  useEffect(() => { load(); }, [load]);

  const setSelf = useCallback(async (next) => {
    if (busy || next === tier) return;
    setBusy(true); setError(""); setStatus(""); setResetMsg("");
    try {
      const e = await adminSetSelfEntitlement(next);
      setTier(e.tier);
      // B19 — propagate immediately so the app's tier state (Membership marker,
      // Discover advanced filters, etc.) reflects the demo tier without a reload
      // or a trip to Membership. Demo/admin affordance only — same backend grant.
      onTierChange?.(e.tier);
      setStatus(
        e.tier === "companion"
          ? "You're now viewing as Companion (demo). Open Settings › Membership to walk through the paid experience."
          : "You're now viewing as Free (demo)."
      );
    } catch (err) {
      setError(safeErrorMessage(err, "Couldn't change the demo tier. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [busy, tier, onTierChange]);

  const runReset = useCallback(async () => {
    setResetBusy(true); setError(""); setStatus("");
    try {
      const res = await adminClearDemoEntitlements();
      setConfirmReset(false);
      const n = res?.cleared ?? 0;
      setResetMsg(`Cleared ${n} demo tier grant${n === 1 ? "" : "s"}.`);
      load();
    } catch (err) {
      setError(safeErrorMessage(err, "Couldn't reset demo tiers. Please try again."));
    } finally {
      setResetBusy(false);
    }
  }, [load]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: t.textSoft, lineHeight: 1.55 }}>
        Demo controls for the paid tier — <strong>not real billing</strong>. Flip your
        own view to walk a client through the Companion experience, or set a specific
        member below (in their details). Every grant here is a clearly-separable demo
        grant you can clear anytime.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>View as (demo):</span>
        <Segmented
          options={TIER_VIEW_OPTIONS}
          value={tier || ""}
          onChange={setSelf}
          ariaLabel="View the app as this tier (demo)"
        />
        {tier && (
          <span style={{ fontSize: 13, color: t.textMuted }}>
            You are on <strong style={{ color: t.text }}>{tier === "companion" ? "Companion" : "Free"}</strong>
          </span>
        )}
      </div>

      {status && (
        <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: t.accentStrong, lineHeight: 1.5 }}>
          {status}
        </p>
      )}

      <div style={{ marginTop: 16, borderTop: `1px solid ${t.borderLight}`, paddingTop: 14 }}>
        {confirmReset ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{ fontSize: 14, color: t.textSoft, lineHeight: 1.5, maxWidth: 360 }}>
              Clear ALL demo tier grants (yours and every member's)? Real subscriptions
              are never touched — there are none in this phase.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PlainButton kind="danger" onClick={runReset} disabled={resetBusy}>
                {resetBusy ? "Clearing…" : "Reset demo tiers"}
              </PlainButton>
              <PlainButton kind="neutral" onClick={() => setConfirmReset(false)} disabled={resetBusy}>Cancel</PlainButton>
            </div>
          </div>
        ) : (
          <PlainButton kind="quiet" onClick={() => { setResetMsg(""); setError(""); setConfirmReset(true); }}>
            Reset demo tiers
          </PlainButton>
        )}
        {resetMsg && <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: t.textMuted }}>{resetMsg}</p>}
      </div>

      {error && <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: t.danger }}>{error}</p>}
    </div>
  );
}

// ─── Manual access (member drawer) ─────────────────────────────────────────────
// Small, calm status pills (no fill — an accent border marks the "on" state so
// both themes stay low-stimulation).
const rolePill = {
  fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 999,
  background: t.surface, color: t.textMuted, border: `1px solid ${t.borderLight}`,
};
const rolePillActive = {
  ...rolePill, color: t.accentStrong, border: `1px solid ${t.accent}`,
};
const rolePillLocked = {
  ...rolePill, color: t.textSoft,
};

// Two direct-grant controls for one member: the DB-based ADMIN ROLE (POST
// /admin/roles — audit-logged, env-root immutable, no self-lockout; the backend
// requireAdmin check is the real security boundary) and their COMPANION
// SUBSCRIPTION (adminSetEntitlement; source stays the machine-stable
// 'admin_demo'). Serious/deliberate without being alarmist; all hooks live in the
// child components before any early return.
function MemberManualAccess({ userId, userName, isEnvAdmin, isDbAdmin, tier, onRoleChanged }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <MemberAdminRoleControl
        userId={userId}
        userName={userName}
        isEnvAdmin={isEnvAdmin}
        isDbAdmin={isDbAdmin}
        onChanged={onRoleChanged}
      />
      <div style={{ borderTop: `1px solid ${t.borderLight}`, paddingTop: 14 }}>
        <MemberTierControl userId={userId} userName={userName} initialTier={tier} />
      </div>
    </div>
  );
}

// Admin-role grant/revoke. Grant AND revoke go through a confirm step (this is
// powerful). Env-root admins render as a locked "Owner / root" state with no
// toggle (they're managed in ADMIN_EMAILS, immutable via the UI). A caller can't
// remove their OWN admin here (the backend blocks self-lockout; the UI says so).
function MemberAdminRoleControl({ userId, userName, isEnvAdmin, isDbAdmin, onChanged }) {
  const [admin, setAdmin] = useState(!!isDbAdmin); // current DB admin state
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  // MED-1 (frontend): a grant/revoke must carry a justification. The backend is
  // authoritative (400s without a non-empty reason) — this mirrors it so the
  // moderator writes the audit note before submitting, not after a bounced call.
  const [reason, setReason] = useState("");
  const fReason = useFocusable();
  const reasonRef = useRef(null);
  const name = userName || "this member";
  const isSelf = userId === getUserId();

  // Move focus into the reason box when the confirm step opens (a11y). All hooks
  // run before the isEnvAdmin early return below (React #310).
  useEffect(() => { if (confirming) reasonRef.current?.focus(); }, [confirming]);

  const apply = useCallback(async () => {
    const next = !admin;
    const r = reason.trim();
    if (!r) return; // required — the backend also enforces this (MED-1)
    setBusy(true); setError(""); setStatus("");
    try {
      await adminSetUserRole(userId, next, r);
      setAdmin(next);
      setConfirming(false);
      setReason("");
      setStatus(next
        ? `${name} is now an admin. Recorded in the audit log.`
        : `Admin access removed from ${name}. Recorded in the audit log.`);
      onChanged?.();
    } catch (err) {
      setError(safeErrorMessage(err, "Couldn't change admin access. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [admin, reason, userId, name, onChanged]);

  // Env-root admins are managed in server configuration — immutable here. (Hooks
  // above run unconditionally; this early return is safe — React #310.)
  if (isEnvAdmin) {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Admin role</span>
          <span style={rolePillLocked}>Owner / root · locked</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
          This account is a root admin set in the server configuration. It can’t be changed here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Admin role</span>
        <span style={admin ? rolePillActive : rolePill}>{admin ? "Admin" : "Not admin"}</span>
      </div>
      <p style={{ margin: "6px 0 8px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
        Admins can review reports and take enforcement action. Every change is recorded in the audit log.
      </p>

      {isSelf && admin ? (
        <p style={{ margin: 0, fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
          This is your own account — you can’t remove your own admin access here.
        </p>
      ) : confirming ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 14, color: t.textSoft, lineHeight: 1.5 }}>
            {admin
              ? `Revoke admin access from ${name}? They’ll immediately lose access to the moderation console.`
              : `Grant admin access to ${name}? They’ll be able to review reports and take enforcement action.`}
          </span>
          <div>
            <label
              htmlFor={`role-reason-${userId}`}
              style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}
            >
              Reason (required, recorded in the audit log)
            </label>
            <textarea
              id={`role-reason-${userId}`}
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              style={{
                width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
                fontSize: 16, color: t.text, background: t.surface, resize: "vertical", fontFamily: t.sans,
                lineHeight: 1.5, boxSizing: "border-box", ...fReason.style,
              }}
              onFocus={fReason.onFocus}
              onBlur={fReason.onBlur}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PlainButton kind={admin ? "danger" : "accent"} onClick={apply} disabled={busy || !reason.trim()}>
              {busy ? "Saving…" : admin ? "Revoke admin" : "Grant admin"}
            </PlainButton>
            <PlainButton kind="neutral" onClick={() => { setConfirming(false); setReason(""); }} disabled={busy}>Cancel</PlainButton>
          </div>
        </div>
      ) : (
        <PlainButton kind={admin ? "quiet" : "neutral"} onClick={() => { setError(""); setStatus(""); setReason(""); setConfirming(true); }}>
          {admin ? "Revoke admin" : "Grant admin"}
        </PlainButton>
      )}

      {status && <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: t.accentStrong }}>{status}</p>}
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: t.danger }}>{error}</p>}
    </div>
  );
}

// Per-member Companion subscription — Free ↔ Companion. Reuses adminSetEntitlement
// (source stays the machine-stable 'admin_demo'); member-facing copy is a calm
// "manual grant — no charge", not "demo". Seeded from the member detail's `tier`.
function MemberTierControl({ userId, userName, initialTier = "free" }) {
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState(initialTier); // current tier (seeded from detail)
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const name = userName || "this member";

  const setTierTo = useCallback(async (next) => {
    if (busy || next === tier) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const e = await adminSetEntitlement(userId, next);
      setTier(e.tier);
      setStatus(`${name} is now on ${e.tier === "companion" ? "Companion" : "Free"}.`);
    } catch (err) {
      setError(safeErrorMessage(err, "Couldn't change the subscription. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [busy, tier, userId, name]);

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Companion subscription</span>
        <span style={tier === "companion" ? rolePillActive : rolePill}>{tier === "companion" ? "Companion" : "Free"}</span>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
        Comp this member to Companion, or return them to Free. This is a manual grant — no charge.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <PlainButton kind={tier === "companion" ? "accent" : "neutral"} onClick={() => setTierTo("companion")} disabled={busy || tier === "companion"}>
          Companion
        </PlainButton>
        <PlainButton kind={tier === "free" ? "accent" : "neutral"} onClick={() => setTierTo("free")} disabled={busy || tier === "free"}>
          Free
        </PlainButton>
      </div>
      {status && <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: t.accentStrong }}>{status}</p>}
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: t.danger }}>{error}</p>}
    </div>
  );
}

export default function AdminScreen({ onTierChange }) {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  // Shared "Demo data" view toggle (owned here so Overview's switch also drives
  // the Population tab, the community-health member counts, and the Members
  // listing). OFF = real-member view only ("597" discipline); ON = the seeded
  // @sample demo dataset is included everywhere.
  const [demo, setDemo] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  // Moderation redesign v3 — the optional "Live counts" background poll. OFF by
  // default (opt-in is calmest); the admin's choice persists so the console stays
  // predictable across visits. Read once, lazily, from localStorage.
  const [liveCounts, setLiveCounts] = useState(() => {
    try { return typeof localStorage !== "undefined" && localStorage.getItem("spectrum-admin-live-counts") === "on"; }
    catch { return false; }
  });
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loadingReports, setLoadingReports] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  // v2 four-area shell. `area` is the top-level destination (Queue default —
  // casework-first). `queueView`/`insightsView` are the in-area sub-nav choices;
  // only the selected area (and sub-view) renders — progressive disclosure.
  const [area, setArea] = useState("queue");
  const [queueView, setQueueView] = useState("reports"); // reports | photos | verification
  const [insightsView, setInsightsView] = useState("overview");
  const [queueToken, setQueueToken] = useState(0); // bump to refetch the active queue
  // Members-tab jump state: the requested initial status filter + a token that
  // bumps on each stat-card jump so the tab remounts pre-filtered (a Suspended
  // card lands on status=suspended even if Members is already open).
  const [membersInitialStatus, setMembersInitialStatus] = useState("all");
  const [membersInitialFilters, setMembersInitialFilters] = useState({});
  const [membersNavToken, setMembersNavToken] = useState(0);
  // Which activity drill-in (Matches/Messages) is open, if any.
  const [activityMetric, setActivityMetric] = useState(null);
  const headingRef = useRef(null);
  const areaHeadingRef = useRef(null);
  const areaMountedRef = useRef(false);
  // Roving-tabindex tablist plumbing: a ref per area button (for focus
  // management) and a flag so the area-switch focus effect knows a keyboard
  // arrow moved us (leave focus on the tab) vs a click (move it to the heading).
  const areaTabRefs = useRef({});
  const areaViaKeyboardRef = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Focus management on area switch: move focus to the chosen area's heading so
  // keyboard + screen-reader users land in the panel they picked. Skip the first
  // render (the H1 already takes focus on mount).
  useEffect(() => {
    if (!areaMountedRef.current) { areaMountedRef.current = true; return; }
    // Keyboard arrow switches keep focus on the tab itself (standard tablist
    // behaviour); only click/programmatic switches move focus into the panel.
    if (areaViaKeyboardRef.current) { areaViaKeyboardRef.current = false; return; }
    areaHeadingRef.current?.focus();
  }, [area]);

  // Arrow-key nav for the area tablist (WCAG 2.1.1 — was keyboard-unreachable).
  // Mirrors the AudienceToggle radiogroup pattern: move selection AND focus to
  // the newly selected tab. Roving tabindex is unchanged; this just wires keys.
  const onAreaTabsKeyDown = useCallback((e) => {
    const i = CONSOLE_AREAS.findIndex((a) => a.value === area);
    let nextIdx;
    if (e.key === "ArrowRight") nextIdx = (i + 1) % CONSOLE_AREAS.length;
    else if (e.key === "ArrowLeft") nextIdx = (i - 1 + CONSOLE_AREAS.length) % CONSOLE_AREAS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = CONSOLE_AREAS.length - 1;
    else return;
    e.preventDefault();
    const next = CONSOLE_AREAS[nextIdx].value;
    areaViaKeyboardRef.current = true;
    setArea(next);
    areaTabRefs.current[next]?.focus();
  }, [area]);

  const focusHeading = useCallback(() => { headingRef.current?.focus(); }, []);

  // loadStats stamps lastUpdatedAt in .finally, surfaces its own error, and —
  // when `announce` — sets ONE calm summary in the polite status region.
  const loadStats = useCallback((announce = false) => {
    return getAdminStats(demo)
      .then((s) => {
        setStats(s);
        setStatsError(false);
        if (announce) {
          const open = s?.reports?.open ?? 0;
          setStatusMsg(`Updated. ${open} open report${open === 1 ? "" : "s"}.`);
        }
      })
      .catch(() => { setStatsError(true); })
      .finally(() => { setLastUpdatedAt(Date.now()); });
  }, [demo]);

  const loadReports = useCallback((filter) => {
    setLoadingReports(true);
    setError("");
    getAdminReports(filter)
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load reports. Please try again."))
      .finally(() => setLoadingReports(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadReports(statusFilter); }, [statusFilter, loadReports]);

  // After a reports-tab mutation: refetch the reports queue AND stats.
  const refresh = useCallback(() => {
    loadReports(statusFilter);
    loadStats();
  }, [loadReports, loadStats, statusFilter]);

  // After a non-reports-queue mutation: refetch stats (the queue refetches
  // itself) and move focus off the unmounted card to the heading.
  const afterQueueAction = useCallback(() => {
    loadStats();
    focusHeading();
  }, [loadStats, focusHeading]);

  // v3 — merge ONLY the four triage depths + their oldest-pending epochs into
  // `stats`. A functional update that spreads `prev`, so members/matches/messages
  // and every other field are untouched. Crucially it never touches the `reports`
  // list state or any open ReportCard, so the poll can't move the case the admin
  // is reading. No-op until the first full stats load has populated `prev`.
  const applyQueueCounts = useCallback((c) => {
    setStats((prev) => (prev ? {
      ...prev,
      reports: { ...prev.reports, open: c.reports?.open ?? prev.reports?.open ?? 0 },
      pendingAttachments: c.pendingAttachments,
      pendingProfilePhotos: c.pendingProfilePhotos,
      pendingProfileAudio: c.pendingProfileAudio,
      pendingVerifications: c.pendingVerifications,
      oldestOpenReportAt: c.oldestOpenReportAt,
      oldestPendingAttachmentAt: c.oldestPendingAttachmentAt,
      oldestPendingProfilePhotoAt: c.oldestPendingProfilePhotoAt,
      oldestPendingProfileAudioAt: c.oldestPendingProfileAudioAt,
      oldestPendingVerificationAt: c.oldestPendingVerificationAt,
    } : prev));
    // B14 — stamp the freshness time so the live poll's counts don't move under a
    // frozen "Updated HH:MM". Mirrors loadStats's .finally stamp.
    setLastUpdatedAt(Date.now());
  }, []);

  // Persist the "Live counts" choice so the console opens the same way next time.
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem("spectrum-admin-live-counts", liveCounts ? "on" : "off");
    } catch { /* private mode / storage disabled — the toggle still works in-session */ }
  }, [liveCounts]);

  // The gentle counts-only poll (v3). Runs ONLY while "Live counts" is on. Every
  // 60s it refetches the cheap /admin/queue-counts and quietly merges the depths
  // — no motion, no sound, no badge, no announce; just the numbers change. It
  // PAUSES when the tab is hidden (document.hidden) to avoid pointless polling,
  // and catches up once on return-to-visible. A single-flight guard prevents
  // overlapping requests; a failed poll stays silent and keeps the last-known
  // counts (manual Refresh remains primary). Cleanup clears the interval and the
  // visibility listener on unmount / when the toggle flips off — no leak, no
  // orphaned timer. It never calls loadReports, so the open case never moves.
  useEffect(() => {
    if (!liveCounts) return undefined;
    let cancelled = false;
    let inFlight = false;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return; // paused while hidden
      if (inFlight) return; // no overlapping polls
      inFlight = true;
      getQueueCounts()
        .then((c) => { if (!cancelled) applyQueueCounts(c); })
        .catch(() => { /* stay calm — keep last-known counts, surface nothing */ })
        .finally(() => { inFlight = false; });
    };
    const intervalId = setInterval(tick, 60000);
    const onVisibility = () => { if (typeof document !== "undefined" && !document.hidden) tick(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [liveCounts, applyQueueCounts]);

  // One refresh truth (F-C): refetch the stamped counts + the reports queue and
  // bump the active queue token (the photo/verification queues refetch on the
  // bump). No per-panel refresh chrome competes with this at the page level.
  const handleRefresh = useCallback(() => {
    loadStats(true);
    loadReports(statusFilter);
    setQueueToken((x) => x + 1);
  }, [loadStats, loadReports, statusFilter]);

  // Triage-card jumps into the Queue sub-views (reports / merged photos / verify).
  const jumpToQueue = useCallback((view) => { setArea("queue"); setQueueView(view); }, []);
  const pickBreakdown = useCallback((filter) => { setStatusFilter(filter); setArea("queue"); setQueueView("reports"); }, []);
  // Jump to the Members area, optionally pre-filtered by status and/or a set of
  // demographic filters (from a Population bar tap). Bumping the nav token forces
  // a fresh MembersTab mount so the initial filters always apply.
  const jumpToMembers = useCallback((status = "all", filters = {}) => {
    setMembersInitialStatus(status);
    setMembersInitialFilters(filters);
    setMembersNavToken((x) => x + 1);
    setArea("members");
  }, []);
  // Population breakdown bar → Members area pre-filtered to that demographic.
  const drillToMembers = useCallback((filters) => { jumpToMembers("all", filters); }, [jumpToMembers]);

  const page = {
    minHeight: "100%", background: t.bgGradient, color: t.text, fontFamily: t.sans, fontSize: 16,
    lineHeight: 1.6, padding: "20px 16px 48px", boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };
  const now = Date.now();

  // The three media queues (message attachments · profile photos · profile
  // audio) triage as ONE "Media review" card: summed depth + the OLDEST of the
  // three oldest-pending epochs drives the "oldest N days" subtext and amber SLA
  // tone. Audio was previously omitted entirely — a whole safety queue with no
  // triage signal. Clicking the card lands on the merged Media review sub-view.
  const mediaPending = stats
    ? (stats.pendingAttachments ?? 0) + (stats.pendingProfilePhotos ?? 0) + (stats.pendingProfileAudio ?? 0)
    : 0;
  const mediaOldestAt = oldestEpoch([
    stats?.oldestPendingAttachmentAt,
    stats?.oldestPendingProfilePhotoAt,
    stats?.oldestPendingProfileAudioAt,
  ]);

  const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 };

  return (
    <div style={page}>
      <div style={shell}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "0 0 4px", color: t.text, outline: "none" }}
        >
          Moderation
        </h1>
        <SectionRule style={{ marginTop: 8, marginBottom: 16 }} />

        {/* Polite live region for action feedback + the one calm refresh summary */}
        <div role="status" aria-live="polite" aria-atomic="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          {statusMsg}
        </div>

        {/* Freshness bar (F-C): grounded "Updated HH:MM" + a real Refresh button.
            v3 adds the opt-in "Live counts" toggle — manual Refresh stays primary;
            Live counts only refreshes the triage numbers quietly in the background. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: t.textMuted, minWidth: 0 }}>
            {lastUpdatedAt ? `Updated ${formatClock(lastUpdatedAt)}` : "Loading…"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
            <LiveCountsToggle value={liveCounts} onChange={setLiveCounts} />
            <PlainButton kind="neutral" onClick={handleRefresh}>Refresh</PlainButton>
          </div>
        </div>
        {liveCounts && (
          <p style={{ margin: "-8px 0 16px", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
            The “Needs attention” counts refresh quietly about once a minute. Pauses when this tab is in the background. The case you’re reading never moves — turn off any time.
          </p>
        )}

        {statsError && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "0 0 16px" }}>
            Couldn't load the latest counts. The figures below may be out of date — try Refresh.
          </p>
        )}

        {/* Four calm areas — a real tablist. Only the chosen area renders
            (progressive disclosure); focus moves to its heading on switch. */}
        <div
          role="tablist"
          aria-label="Console areas"
          onKeyDown={onAreaTabsKeyDown}
          style={{
            display: "flex", gap: 6, background: t.surfaceAlt, border: `1px solid ${t.borderLight}`,
            borderRadius: 14, padding: 5, marginBottom: 20, flexWrap: "wrap",
          }}
        >
          {CONSOLE_AREAS.map((a) => (
            <AreaTab
              key={a.value}
              btnRef={(el) => { areaTabRefs.current[a.value] = el; }}
              id={`area-tab-${a.value}`}
              panelId={`area-panel-${a.value}`}
              label={a.label}
              active={area === a.value}
              onClick={() => setArea(a.value)}
            />
          ))}
        </div>

        <div role="tabpanel" id={`area-panel-${area}`} aria-labelledby={`area-tab-${area}`}>
          <h2
            ref={areaHeadingRef}
            tabIndex={-1}
            style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text, margin: "0 0 4px", outline: "none" }}
          >
            {CONSOLE_AREAS.find((a) => a.value === area)?.label}
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: t.textMuted, lineHeight: 1.5 }}>
            {area === "queue" ? "The casework queue — reports, photo review, and verification."
              : area === "members" ? "The member directory, membership tiers, and per-member controls."
                : area === "insights" ? "Dashboards and analytics — pick one at a time."
                  : "Service health, billing demo tools, and maintenance."}
          </p>

          {/* ── QUEUE ─────────────────────────────────────────────────────── */}
          {area === "queue" && (
            <>
              {/* Kept triage row — what needs attention, oldest-first, amber past SLA */}
              {stats && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.textMuted, marginBottom: 10 }}>
                    Needs attention
                  </div>
                  <div style={gridStyle}>
                    <StatCard
                      label="Open reports"
                      value={stats.reports?.open ?? 0}
                      subtext={(stats.reports?.open ?? 0) > 0 ? oldestLabel(stats.oldestOpenReportAt, now) : "All clear"}
                      tone={(stats.reports?.open ?? 0) > 0 && isPastSla(stats.oldestOpenReportAt, now) ? "amber" : undefined}
                      onClick={() => pickBreakdown("open")}
                      ariaLabel={`Open reports: ${stats.reports?.open ?? 0}. View open reports.`}
                    />
                    <StatCard
                      label="Media review"
                      value={mediaPending}
                      subtext={mediaPending > 0 ? oldestLabel(mediaOldestAt, now) : "All clear"}
                      tone={mediaPending > 0 && isPastSla(mediaOldestAt, now) ? "amber" : undefined}
                      onClick={() => jumpToQueue("photos")}
                      ariaLabel={`Media awaiting review (message photos, profile photos, and audio): ${mediaPending}. View media review.`}
                    />
                    <StatCard
                      label="Verification"
                      value={stats.pendingVerifications ?? 0}
                      subtext={(stats.pendingVerifications ?? 0) > 0 ? oldestLabel(stats.oldestPendingVerificationAt, now) : "All clear"}
                      tone={(stats.pendingVerifications ?? 0) > 0 && isPastSla(stats.oldestPendingVerificationAt, now) ? "amber" : undefined}
                      onClick={() => jumpToQueue("verification")}
                      ariaLabel={`Verification requests: ${stats.pendingVerifications ?? 0}. View verification queue.`}
                    />
                  </div>
                </div>
              )}

              {/* Queue sub-nav — one casework queue at a time */}
              <div style={{ marginBottom: 20 }}>
                <Segmented options={QUEUE_VIEWS} value={queueView} onChange={setQueueView} ariaLabel="Choose a queue" />
              </div>

              {queueView === "reports" ? (
                <>
                  {/* Report status filter (also absorbs the old "Report breakdown" zone) */}
                  <div style={{ marginBottom: 20 }}>
                    <SegmentedControl value={statusFilter} onChange={setStatusFilter} />
                  </div>
                  {loadingReports ? (
                    <ReportsSkeleton />
                  ) : error ? (
                    <ErrorState title="Couldn't load reports" message="Something went wrong on our end. Please try again." onRetry={refresh} />
                  ) : reports.length === 0 ? (
                    <EmptyCard>
                      {statusFilter === "open" ? "No open reports — all clear." : "No reports to show here."}
                    </EmptyCard>
                  ) : (
                    <>
                      {/* Calm, factual count of the currently-rendered filtered
                          list — no color, no urgency. */}
                      <div style={{ fontSize: 14, color: t.textMuted, marginBottom: 12 }}>
                        {reports.length} {statusFilter === "all" ? "" : `${statusFilter} `}report{reports.length === 1 ? "" : "s"}
                      </div>
                      <ul style={{ margin: 0, padding: 0 }}>
                        {reports.map((report) => (
                          <ReportCard key={report.id} report={report} onRefresh={refresh} onStatus={setStatusMsg} onDone={focusHeading} />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : queueView === "photos" ? (
                <MergedPhotoQueue onStatus={setStatusMsg} reloadToken={queueToken} onAfterAction={afterQueueAction} />
              ) : (
                <VerificationQueue onStatus={setStatusMsg} reloadToken={queueToken} onAfterAction={afterQueueAction} />
              )}
            </>
          )}

          {/* ── MEMBERS ───────────────────────────────────────────────────── */}
          {area === "members" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <DemoToggle value={demo} onChange={setDemo} />
                <span style={{ fontSize: 13, color: t.textMuted }}>
                  Include the seeded sample members in the listing and counts.
                </span>
              </div>
              <MembersTab key={`members-${membersNavToken}`} initialStatus={membersInitialStatus} initialFilters={membersInitialFilters} includeDemo={demo} />
            </>
          )}

          {/* ── INSIGHTS ──────────────────────────────────────────────────── */}
          {area === "insights" && (
            <>
              {/* Community health — de-emphasized cross-cutting context */}
              {stats && (
                <div style={{ ...gridStyle, marginBottom: 20 }}>
                  <StatCard
                    label="Members"
                    value={stats.members ?? 0}
                    subtext={demo ? "Demo view — includes sample members" : `Excludes test accounts${(stats.testAccounts ?? 0) > 0 ? ` (+${stats.testAccounts} test)` : ""}`}
                    muted
                    onClick={() => jumpToMembers("all")}
                    ariaLabel={`Members: ${stats.members ?? 0}. View member list.`}
                  />
                  <StatCard label="Suspended" value={stats.suspended ?? 0} muted onClick={() => jumpToMembers("suspended")} ariaLabel={`Suspended members: ${stats.suspended ?? 0}. View suspended members.`} />
                  <StatCard label="Matches" value={stats.matches ?? 0} muted onClick={() => setActivityMetric("matches")} ariaLabel={`Matches: ${stats.matches ?? 0}. View match activity trends.`} />
                  <StatCard label="Messages" value={stats.messages ?? 0} muted onClick={() => setActivityMetric("messages")} ariaLabel={`Messages: ${stats.messages ?? 0}. View message activity trends.`} />
                </div>
              )}

              {/* Insights sub-nav — one dashboard at a time (progressive disclosure) */}
              <div style={{ marginBottom: 20 }}>
                <Segmented options={INSIGHTS_VIEWS} value={insightsView} onChange={setInsightsView} ariaLabel="Choose an insight" />
              </div>

              {insightsView === "overview" ? (
                <OverviewTab demo={demo} setDemo={setDemo} onDataChanged={loadStats} />
              ) : insightsView === "population" ? (
                <PopulationTab onDrill={drillToMembers} demo={demo} />
              ) : insightsView === "transparency" ? (
                <TransparencyTab />
              ) : insightsView === "activity" ? (
                <AuditLogView reloadToken={queueToken} />
              ) : insightsView === "feedback" ? (
                <FeedbackInbox reloadToken={queueToken} />
              ) : (
                <SiteHealthPanel />
              )}
            </>
          )}

          {/* ── SYSTEM ────────────────────────────────────────────────────── */}
          {area === "system" && (
            <>
              {/* Billing demo — moved OUT of the T&S casework view. Clearly tagged
                  DEMO (never real billing); per-member grants live in the drawer. */}
              <div style={sectionCardStyle}>
                <h3 style={zoneHeadingStyle}>Billing demo (paid tier)</h3>
                <BillingDemoSection onTierChange={onTierChange} />
              </div>
              {/* Maintenance — purge test/demo accounts (low-emphasis, collapsed) */}
              <MaintenanceSection onStatus={setStatusMsg} onRefresh={() => { loadStats(); }} />
            </>
          )}
        </div>

        {/* Matches / Messages aggregate drill-in (privacy-safe, counts only) */}
        {activityMetric && (
          <ActivityDrawer metric={activityMetric} onClose={() => setActivityMetric(null)} />
        )}
      </div>
    </div>
  );
}
