import { useState, useEffect, useRef, useCallback } from "react";
import {
  getAdminStats, getAdminReports, resolveReport, suspendUser, getPendingAttachments,
  reviewAttachment, getPendingProfilePhotos, reviewProfilePhoto, verifyUser, getAuditLog,
  getAdminFeedback, getVerificationRequests, purgeTestAccounts, getReportContext, safeErrorMessage,
} from "./api.js";
import { t } from "./tokens.js";
import Skeleton from "./Skeleton.jsx";
import ErrorState from "./ErrorState.jsx";
import SectionRule from "./SectionRule.jsx";
import { useFocusable } from "./useFocusable.js";
import { waitingLabel, oldestLabel, accountAgeLabel, isPastSla } from "./adminFormat.js";

// Moderation dashboard — autism-friendly: calm, low-stimulation, clear states.
// Reds reserved for genuinely destructive actions (suspend). Numbers are static,
// grounded, and stamped with an "Updated HH:MM" — never a live ticker.

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const RESOLVE_ACTIONS = [
  { value: "reviewed", label: "Reviewed" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
];

// Outcomes that demand a note (accountability trail). 'reviewed' is a noteless
// triage mark. Mirrors the backend's TERMINAL_REPORT_STATUSES note rule.
const NOTE_REQUIRED = new Set(["actioned", "dismissed"]);

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

function PlainButton({ children, onClick, kind = "neutral", disabled, buttonRef, ariaLabel }) {
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

// Report-breakdown strip (F-A) — Open · Reviewed · Actioned · Dismissed, each a
// tappable segment that sets the status filter (and jumps to the Reports tab).
function BreakdownStrip({ reports, active, onPick }) {
  const segs = [["open", "Open"], ["reviewed", "Reviewed"], ["actioned", "Actioned"], ["dismissed", "Dismissed"]];
  return (
    <div role="group" aria-label="Report breakdown — tap to filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {segs.map(([val, label]) => (
        <BreakdownSegment
          key={val}
          label={label}
          count={reports?.[val] ?? 0}
          active={active === val}
          onClick={() => onPick(val)}
        />
      ))}
    </div>
  );
}

function BreakdownSegment({ label, count, active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}: ${count}. Filter reports.`}
      onClick={onClick}
      style={{
        flex: "1 1 120px", minWidth: 0, minHeight: 44, padding: "10px 12px", borderRadius: 12,
        border: `1px solid ${active ? t.accentFill : t.border}`,
        background: active ? t.surfaceAlt : t.surface, cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      <span style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text }}>{count}</span>
      <span style={{ fontSize: 13, color: t.textMuted }}>{label}</span>
    </button>
  );
}

// P1-A — read-only reported-conversation view, lazily fetched on reveal.
function ReportedContext({ reportId, reportedName }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const f = useFocusable();

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
        {open ? "Hide reported messages" : "View reported messages"}
      </button>

      {open && (
        <div style={{ marginTop: 12, border: `1px solid ${t.borderLight}`, borderRadius: 12, padding: "12px 14px", background: t.bg }}>
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
                    border: `1px solid ${m.fromReported ? t.warningBorder : t.borderLight}`,
                    borderRadius: 10, padding: "8px 12px",
                  }}
                >
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
  const age = accountAgeLabel(report.reportedCreatedAt);
  const parts = [
    `${prior} prior report${prior === 1 ? "" : "s"} against this member (${actioned} actioned)`,
    `blocked by ${blocked}`,
  ];
  if (age) parts.push(`account age ${age}`);
  return (
    <p style={{ margin: "10px 0 0", fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>
      {parts.join(" · ")}
    </p>
  );
}

function ReportCard({ report, onRefresh, onStatus, onDone }) {
  const [resolveAction, setResolveAction] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [suspendNote, setSuspendNote] = useState("");
  const [localError, setLocalError] = useState("");
  const [verified, setVerified] = useState(!!report.reportedVerified);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const fNote = useFocusable();
  const fSelect = useFocusable();
  const fSuspendNote = useFocusable();
  const confirmResolveRef = useRef(null);
  const confirmSuspendRef = useRef(null);

  const isOpen = report.status === "open";
  const suspended = !!report.reportedSuspended;
  const noteRequired = NOTE_REQUIRED.has(resolveAction);

  // Move focus into a confirm panel on reveal (a11y).
  useEffect(() => { if (confirmResolve) confirmResolveRef.current?.focus(); }, [confirmResolve]);
  useEffect(() => { if (confirmSuspend) confirmSuspendRef.current?.focus(); }, [confirmSuspend]);

  async function doResolve() {
    setBusy(true);
    setLocalError("");
    try {
      await resolveReport(report.id, resolveAction, note.trim() || undefined);
      onStatus(`Report marked ${resolveAction}.`);
      setConfirmResolve(false);
      onDone(); // restore focus to the section heading before this card unmounts
      onRefresh();
    } catch (err) {
      setConfirmResolve(false);
      setLocalError(actionErrorMessage(err, "Couldn't update this report. Please try again."));
      if (err && err.status === 409) onRefresh();
      setBusy(false);
    }
  }

  function handleApply() {
    if (!resolveAction) return;
    if (noteRequired && !note.trim()) return;
    // Confirm step for the destructive 'actioned' outcome (reuse the suspend
    // confirm shape). Reviewed/dismissed apply directly.
    if (resolveAction === "actioned") { setConfirmResolve(true); return; }
    doResolve();
  }

  async function handleVerifyToggle(nextVerified) {
    setVerifyBusy(true);
    setLocalError("");
    try {
      const res = await verifyUser(report.reportedId, nextVerified);
      const applied = res?.verified ?? nextVerified;
      setVerified(!!applied);
      onStatus(
        applied
          ? `${report.reportedName || "This member"} is now verified.`
          : `Verification removed from ${report.reportedName || "this member"}.`
      );
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update verification. Please try again."));
      if (err && err.status === 409) onRefresh();
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleSuspend() {
    if (!suspendNote.trim()) return;
    setBusy(true);
    setLocalError("");
    try {
      await suspendUser(report.reportedId, true, suspendNote.trim());
      onStatus(`${report.reportedName || "This member"} has been suspended.`);
      setConfirmSuspend(false);
      onDone();
      onRefresh();
    } catch (err) {
      setLocalError(actionErrorMessage(err, "Couldn't update this account. Please try again."));
      if (err && err.status === 409) onRefresh();
      setBusy(false);
    }
  }

  async function handleUnsuspend() {
    setBusy(true);
    setLocalError("");
    try {
      await suspendUser(report.reportedId, false);
      onStatus(`${report.reportedName || "This member"} has been reinstated.`);
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

      {/* P1-A reported-conversation view (read-only) */}
      <ReportedContext reportId={report.id} reportedName={report.reportedName} />

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "12px 0 0" }}>{localError}</p>
      )}

      {/* F-B: resolved reports show a read-only receipt; only OPEN reports keep
          the live resolve/suspend/verify controls. */}
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
        <>
          {/* Resolve controls */}
          <div style={{ borderTop: `1px solid ${t.borderLight}`, marginTop: 16, paddingTop: 16 }}>
            <label
              htmlFor={`resolve-${report.id}`}
              style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.textSoft, marginBottom: 8 }}
            >
              Resolve report
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select
                id={`resolve-${report.id}`}
                value={resolveAction}
                onChange={(e) => setResolveAction(e.target.value)}
                style={{
                  minHeight: 44, padding: "8px 12px", borderRadius: 11, border: `1px solid ${t.formBorder}`,
                  background: t.surface, color: t.text,
                  // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
                  fontSize: 16, ...fSelect.style,
                }}
                onFocus={fSelect.onFocus}
                onBlur={fSelect.onBlur}
              >
                <option value="">Choose outcome…</option>
                {RESOLVE_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              <PlainButton kind="accent" onClick={handleApply} disabled={busy || !resolveAction || (noteRequired && !note.trim())}>
                Apply
              </PlainButton>
            </div>

            <label
              htmlFor={`resolve-note-${report.id}`}
              style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.textSoft, margin: "12px 0 6px" }}
            >
              {noteRequired ? "Why? (recorded in the audit log)" : "Note (optional)"}
            </label>
            <textarea
              id={`resolve-note-${report.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              style={{
                width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
                // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
                fontSize: 16, color: t.text, background: t.bg, resize: "vertical", fontFamily: t.sans,
                lineHeight: 1.5, boxSizing: "border-box", ...fNote.style,
              }}
              onFocus={fNote.onFocus}
              onBlur={fNote.onBlur}
            />

            {confirmResolve && (
              <div
                role="group"
                aria-label="Confirm action"
                onKeyDown={(e) => { if (e.key === "Escape") setConfirmResolve(false); }}
                style={{ background: t.dangerSurface, border: `1px solid ${t.danger}`, borderRadius: 12, padding: "14px 16px", marginTop: 12 }}
              >
                <p style={{ margin: "0 0 12px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
                  Action this report against {report.reportedName || "this member"}? This decision is final and recorded in the audit log.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <PlainButton kind="danger" onClick={doResolve} disabled={busy} buttonRef={confirmResolveRef}>
                    Confirm — mark actioned
                  </PlainButton>
                  <PlainButton kind="neutral" onClick={() => setConfirmResolve(false)} disabled={busy}>
                    Cancel
                  </PlainButton>
                </div>
              </div>
            )}
          </div>

          {/* Suspend / unsuspend */}
          <div style={{ marginTop: 14 }}>
            {suspended ? (
              <PlainButton kind="quiet" onClick={handleUnsuspend} disabled={busy}>
                Unsuspend {report.reportedName}
              </PlainButton>
            ) : confirmSuspend ? (
              <div
                role="group"
                aria-label="Confirm suspension"
                onKeyDown={(e) => { if (e.key === "Escape") setConfirmSuspend(false); }}
                style={{ background: t.dangerSurface, border: `1px solid ${t.danger}`, borderRadius: 12, padding: "14px 16px" }}
              >
                <p style={{ margin: "0 0 12px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
                  Suspend {report.reportedName || "this member"}? They'll be logged out and unable to sign in.
                </p>
                <label
                  htmlFor={`suspend-note-${report.id}`}
                  style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}
                >
                  Reason (required, recorded in the audit log)
                </label>
                <textarea
                  id={`suspend-note-${report.id}`}
                  value={suspendNote}
                  onChange={(e) => setSuspendNote(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={2}
                  ref={confirmSuspendRef}
                  style={{
                    width: "100%", border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "10px 12px",
                    fontSize: 16, color: t.text, background: t.surface, resize: "vertical", fontFamily: t.sans,
                    lineHeight: 1.5, boxSizing: "border-box", marginBottom: 12, ...fSuspendNote.style,
                  }}
                  onFocus={fSuspendNote.onFocus}
                  onBlur={fSuspendNote.onBlur}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <PlainButton kind="danger" onClick={handleSuspend} disabled={busy || !suspendNote.trim()}>
                    Suspend
                  </PlainButton>
                  <PlainButton kind="neutral" onClick={() => setConfirmSuspend(false)} disabled={busy}>
                    Cancel
                  </PlainButton>
                </div>
              </div>
            ) : (
              <PlainButton kind="quiet" onClick={() => setConfirmSuspend(true)} disabled={busy}>
                Suspend {report.reportedName}
              </PlainButton>
            )}
          </div>

          {/* Identity verification (F1) — acts on the reported member in-context */}
          <div style={{ marginTop: 12 }}>
            {verified ? (
              <PlainButton kind="quiet" onClick={() => handleVerifyToggle(false)} disabled={verifyBusy}>
                Remove verification
              </PlainButton>
            ) : (
              <PlainButton kind="neutral" onClick={() => handleVerifyToggle(true)} disabled={verifyBusy}>
                Mark verified
              </PlainButton>
            )}
          </div>
        </>
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

function AuditLogView({ reloadToken }) {
  const { items: log, loading, error, reload } = useAdminList(() => getAuditLog(), reloadToken);

  if (loading) return <AuditLogSkeleton />;
  if (error) {
    return <ErrorState title="Couldn't load the activity log" message="Something went wrong on our end. Please try again." onRetry={reload} />;
  }
  if (log.length === 0) return <EmptyCard>No moderation activity yet.</EmptyCard>;
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {log.map((entry) => {
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

const ADMIN_TABS = [
  { value: "reports", label: "Reports" },
  { value: "verification", label: "Verification" },
  { value: "photos", label: "Photos" },
  { value: "profile-photos", label: "Profile photos" },
  { value: "feedback", label: "Feedback" },
  { value: "activity", label: "Activity" },
];

function TabButton({ label, active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        minHeight: 44, padding: "8px 12px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14,
        whiteSpace: "nowrap", flex: "0 0 auto", fontWeight: active ? 600 : 500,
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

export default function AdminScreen() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loadingReports, setLoadingReports] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [activeTab, setActiveTab] = useState("reports");
  const [queueToken, setQueueToken] = useState(0); // bump to refetch the active queue
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const focusHeading = useCallback(() => { headingRef.current?.focus(); }, []);

  // loadStats stamps lastUpdatedAt in .finally, surfaces its own error, and —
  // when `announce` — sets ONE calm summary in the polite status region.
  const loadStats = useCallback((announce = false) => {
    return getAdminStats()
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
  }, []);

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

  // Explicit Refresh (F-C): refetch stats + whichever queue is active, announce.
  const handleRefresh = useCallback(() => {
    loadStats(true);
    if (activeTab === "reports") loadReports(statusFilter);
    else setQueueToken((x) => x + 1);
  }, [loadStats, loadReports, statusFilter, activeTab]);

  const jumpTo = useCallback((tab) => { setActiveTab(tab); }, []);
  const pickBreakdown = useCallback((filter) => { setStatusFilter(filter); setActiveTab("reports"); }, []);

  const page = {
    minHeight: "100%", background: t.bgGradient, color: t.text, fontFamily: t.sans, fontSize: 16,
    lineHeight: 1.6, padding: "20px 16px 48px", boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };
  const now = Date.now();

  const zoneHeading = { fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.textMuted, margin: "0 0 10px" };
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

        {/* Freshness bar (F-C): grounded "Updated HH:MM" + a real Refresh button */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: t.textMuted, minWidth: 0 }}>
            {lastUpdatedAt ? `Updated ${formatClock(lastUpdatedAt)}` : "Loading…"}
          </span>
          <PlainButton kind="neutral" onClick={handleRefresh}>Refresh</PlainButton>
        </div>

        {statsError && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "0 0 16px" }}>
            Couldn't load the latest counts. The figures below may be out of date — try Refresh.
          </p>
        )}

        {stats && (
          <>
            {/* Needs attention (F-A) — queues awaiting a moderator */}
            <div style={{ marginBottom: 20 }}>
              <h2 style={zoneHeading}>Needs attention</h2>
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
                  label="Photos"
                  value={stats.pendingAttachments ?? 0}
                  subtext={(stats.pendingAttachments ?? 0) > 0 ? oldestLabel(stats.oldestPendingAttachmentAt, now) : "All clear"}
                  tone={(stats.pendingAttachments ?? 0) > 0 && isPastSla(stats.oldestPendingAttachmentAt, now) ? "amber" : undefined}
                  onClick={() => jumpTo("photos")}
                  ariaLabel={`Photos awaiting review: ${stats.pendingAttachments ?? 0}. View photo queue.`}
                />
                <StatCard
                  label="Profile photos"
                  value={stats.pendingProfilePhotos ?? 0}
                  subtext={(stats.pendingProfilePhotos ?? 0) > 0 ? oldestLabel(stats.oldestPendingProfilePhotoAt, now) : "All clear"}
                  tone={(stats.pendingProfilePhotos ?? 0) > 0 && isPastSla(stats.oldestPendingProfilePhotoAt, now) ? "amber" : undefined}
                  onClick={() => jumpTo("profile-photos")}
                  ariaLabel={`Profile photos awaiting review: ${stats.pendingProfilePhotos ?? 0}. View profile-photo queue.`}
                />
                <StatCard
                  label="Verification"
                  value={stats.pendingVerifications ?? 0}
                  subtext={(stats.pendingVerifications ?? 0) > 0 ? oldestLabel(stats.oldestPendingVerificationAt, now) : "All clear"}
                  tone={(stats.pendingVerifications ?? 0) > 0 && isPastSla(stats.oldestPendingVerificationAt, now) ? "amber" : undefined}
                  onClick={() => jumpTo("verification")}
                  ariaLabel={`Verification requests: ${stats.pendingVerifications ?? 0}. View verification queue.`}
                />
              </div>
            </div>

            {/* Report breakdown strip (F-A) — tap a segment to filter */}
            <div style={{ marginBottom: 24 }}>
              <BreakdownStrip reports={stats.reports} active={activeTab === "reports" ? statusFilter : null} onPick={pickBreakdown} />
            </div>

            {/* Community health (F-A) — de-emphasized context, not a to-do list */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={zoneHeading}>Community health</h2>
              <div style={gridStyle}>
                <StatCard
                  label="Members"
                  value={stats.members ?? 0}
                  subtext={`Excludes test accounts${(stats.testAccounts ?? 0) > 0 ? ` (+${stats.testAccounts} test)` : ""}`}
                  muted
                />
                <StatCard label="Suspended" value={stats.suspended ?? 0} muted />
                <StatCard label="Matches" value={stats.matches ?? 0} muted />
                <StatCard label="Messages" value={stats.messages ?? 0} muted />
              </div>
            </div>
          </>
        )}

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Moderation sections"
          style={{
            display: "flex", gap: 6, background: t.surfaceAlt, border: `1px solid ${t.borderLight}`,
            borderRadius: 12, padding: 4, marginBottom: 20, overflowX: "auto",
            WebkitOverflowScrolling: "touch", scrollbarWidth: "thin",
          }}
        >
          {ADMIN_TABS.map((tab) => (
            <TabButton key={tab.value} label={tab.label} active={activeTab === tab.value} onClick={() => setActiveTab(tab.value)} />
          ))}
        </div>

        {activeTab === "verification" ? (
          <VerificationQueue onStatus={setStatusMsg} reloadToken={queueToken} onAfterAction={afterQueueAction} />
        ) : activeTab === "photos" ? (
          <PhotoReviewQueue onStatus={setStatusMsg} reloadToken={queueToken} onAfterAction={afterQueueAction} />
        ) : activeTab === "profile-photos" ? (
          <ProfilePhotoReviewQueue onStatus={setStatusMsg} reloadToken={queueToken} onAfterAction={afterQueueAction} />
        ) : activeTab === "feedback" ? (
          <FeedbackInbox reloadToken={queueToken} />
        ) : activeTab === "activity" ? (
          <AuditLogView reloadToken={queueToken} />
        ) : (
          <>
            {/* Filter */}
            <div style={{ marginBottom: 20 }}>
              <SegmentedControl value={statusFilter} onChange={setStatusFilter} />
            </div>

            {/* Reports list */}
            {loadingReports ? (
              <ReportsSkeleton />
            ) : error ? (
              <ErrorState title="Couldn't load reports" message="Something went wrong on our end. Please try again." onRetry={refresh} />
            ) : reports.length === 0 ? (
              <EmptyCard>
                {statusFilter === "open" ? "No open reports — all clear." : "No reports to show here."}
              </EmptyCard>
            ) : (
              <ul style={{ margin: 0, padding: 0 }}>
                {reports.map((report) => (
                  <ReportCard key={report.id} report={report} onRefresh={refresh} onStatus={setStatusMsg} onDone={focusHeading} />
                ))}
              </ul>
            )}
          </>
        )}

        {/* Maintenance — low-emphasis, collapsed by default */}
        <MaintenanceSection onStatus={setStatusMsg} onRefresh={() => { loadStats(); }} />
      </div>
    </div>
  );
}
