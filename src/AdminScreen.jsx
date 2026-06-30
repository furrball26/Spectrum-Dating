import { useState, useEffect, useRef, useCallback } from "react";
import { getAdminStats, getAdminReports, resolveReport, suspendUser } from "./api.js";
import { t } from "./tokens.js";
import Skeleton from "./Skeleton.jsx";
import ErrorState from "./ErrorState.jsx";

// Calm placeholder cards shown while reports load.
function ReportsSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 16,
            padding: "18px 20px",
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
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

// Moderation dashboard — autism-friendly: calm, low-stimulation, clear states.
// Reds reserved for genuinely destructive actions (suspend).

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

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

function formatTimestamp(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusColor(status) {
  switch (status) {
    case "open": return t.warning;
    case "reviewed": return t.accent;
    case "actioned": return t.accentStrong;
    case "dismissed": return t.textMuted;
    default: return t.textMuted;
  }
}

function StatCard({ label, value }) {
  return (
    <div
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        minWidth: 96,
        flex: "1 1 96px",
        boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
      }}
    >
      <div style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function SegmentedControl({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Filter reports by status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: 4,
      }}
    >
      {STATUS_FILTERS.map((f) => (
        <SegmentButton
          key={f.value}
          label={f.label}
          active={value === f.value}
          onClick={() => onChange(f.value)}
        />
      ))}
    </div>
  );
}

function SegmentButton({ label, active, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: "1 1 auto",
        minHeight: 44,
        padding: "8px 14px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        background: active ? t.surface : "transparent",
        color: active ? t.text : t.textSoft,
        boxShadow: active ? "0 1px 3px rgba(36,51,45,0.12)" : "none",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {label}
    </button>
  );
}

function PlainButton({ children, onClick, kind = "neutral", disabled }) {
  const f = useFocusable();
  const kinds = {
    neutral: { background: t.surface, color: t.text, border: `1px solid ${t.border}` },
    accent: { background: t.accent, color: "#fff", border: `1px solid ${t.accent}` },
    danger: { background: t.danger, color: "#fff", border: `1px solid ${t.danger}` },
    quiet: { background: "transparent", color: t.textSoft, border: `1px solid ${t.border}` },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 44,
        padding: "9px 16px",
        borderRadius: 11,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        ...kinds[kind],
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {children}
    </button>
  );
}

function ReportCard({ report, onRefresh, onStatus }) {
  const [resolveAction, setResolveAction] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [localError, setLocalError] = useState("");
  const fNote = useFocusable();
  const fSelect = useFocusable();

  const suspended = !!report.reportedSuspended;

  async function handleResolve() {
    if (!resolveAction) return;
    setBusy(true);
    setLocalError("");
    try {
      await resolveReport(report.id, resolveAction, note.trim() || undefined);
      onStatus(`Report marked ${resolveAction}.`);
      onRefresh();
    } catch {
      setLocalError("Couldn't update this report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspendToggle(nextSuspended) {
    setBusy(true);
    setLocalError("");
    try {
      await suspendUser(report.reportedId, nextSuspended);
      onStatus(
        nextSuspended
          ? `${report.reportedName} has been suspended.`
          : `${report.reportedName} has been reinstated.`
      );
      setConfirmSuspend(false);
      onRefresh();
    } catch {
      setLocalError("Couldn't update this account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: "20px 20px",
        marginBottom: 14,
        listStyle: "none",
        boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
      }}
    >
      {/* Header row: who reported whom + status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, color: t.text, fontWeight: 600 }}>
          <span>{report.reporterName || "Someone"}</span>
          <span aria-hidden="true" style={{ color: t.textMuted, margin: "0 8px" }}>→</span>
          <span>{report.reportedName || "a member"}</span>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "capitalize",
            color: "#fff",
            background: statusColor(report.status),
            borderRadius: 20,
            padding: "3px 10px",
            letterSpacing: "0.02em",
          }}
        >
          {report.status}
        </span>
      </div>

      {report.reportedEmail && (
        <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{report.reportedEmail}</div>
      )}

      {/* Reason + details */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, color: t.textSoft }}>
          <strong style={{ color: t.text, fontWeight: 600 }}>Reason: </strong>
          <span style={{ textTransform: "capitalize" }}>{report.reason || "—"}</span>
        </div>
        {report.details && (
          <p style={{ margin: "8px 0 0", fontSize: 15, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {report.details}
          </p>
        )}
      </div>

      <div style={{ fontSize: 12, color: t.textMuted, marginTop: 12 }}>
        {formatTimestamp(report.createdAt)}
        {suspended && (
          <span style={{ color: t.danger, fontWeight: 600, marginLeft: 10 }}>• Account suspended</span>
        )}
      </div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 13, margin: "12px 0 0" }}>{localError}</p>
      )}

      {/* Resolve controls */}
      <div style={{ borderTop: `1px solid ${t.borderLight}`, marginTop: 16, paddingTop: 16 }}>
        <label
          htmlFor={`resolve-${report.id}`}
          style={{ display: "block", fontSize: 13, fontWeight: 600, color: t.textSoft, marginBottom: 8 }}
        >
          Resolve report
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            id={`resolve-${report.id}`}
            value={resolveAction}
            onChange={(e) => setResolveAction(e.target.value)}
            style={{
              minHeight: 44,
              padding: "8px 12px",
              borderRadius: 11,
              border: `1px solid ${t.formBorder}`,
              background: t.surface,
              color: t.text,
              fontSize: 14,
              ...fSelect.style,
            }}
            onFocus={fSelect.onFocus}
            onBlur={fSelect.onBlur}
          >
            <option value="">Choose outcome…</option>
            {RESOLVE_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <PlainButton kind="accent" onClick={handleResolve} disabled={busy || !resolveAction}>
            Apply
          </PlainButton>
        </div>
        <textarea
          aria-label="Resolution note (optional)"
          placeholder="Add an optional note…"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={2}
          style={{
            width: "100%",
            marginTop: 10,
            border: `1px solid ${t.formBorder}`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 14,
            color: t.text,
            background: t.bg,
            resize: "vertical",
            fontFamily: t.sans,
            lineHeight: 1.5,
            boxSizing: "border-box",
            ...fNote.style,
          }}
          onFocus={fNote.onFocus}
          onBlur={fNote.onBlur}
        />
      </div>

      {/* Suspend / unsuspend */}
      <div style={{ marginTop: 14 }}>
        {suspended ? (
          <PlainButton kind="quiet" onClick={() => handleSuspendToggle(false)} disabled={busy}>
            Unsuspend {report.reportedName}
          </PlainButton>
        ) : confirmSuspend ? (
          <div
            style={{
              background: "#FBF1F1",
              border: `1px solid ${t.danger}`,
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <p style={{ margin: "0 0 12px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
              Suspend {report.reportedName}? They'll be logged out and unable to sign in.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <PlainButton kind="danger" onClick={() => handleSuspendToggle(true)} disabled={busy}>
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
    </li>
  );
}

export default function AdminScreen() {
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loadingReports, setLoadingReports] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const loadStats = useCallback(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => { /* stats are non-critical; leave previous value */ });
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

  const refresh = useCallback(() => {
    loadReports(statusFilter);
    loadStats();
  }, [loadReports, loadStats, statusFilter]);

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
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 20px",
            color: t.text,
            outline: "none",
          }}
        >
          Moderation
        </h1>

        {/* Polite live region for action feedback */}
        <div role="status" aria-live="polite" aria-atomic="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          {statusMsg}
        </div>

        {/* Stats row */}
        {stats && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
            <StatCard label="Members" value={stats.users ?? 0} />
            <StatCard label="Suspended" value={stats.suspended ?? 0} />
            <StatCard label="Matches" value={stats.matches ?? 0} />
            <StatCard label="Messages" value={stats.messages ?? 0} />
            <StatCard label="Open reports" value={stats.reports?.open ?? 0} />
          </div>
        )}

        {/* Filter */}
        <div style={{ marginBottom: 20 }}>
          <SegmentedControl value={statusFilter} onChange={setStatusFilter} />
        </div>

        {/* Reports list */}
        {loadingReports ? (
          <ReportsSkeleton />
        ) : error ? (
          <ErrorState
            title="Couldn't load reports"
            message="Something went wrong on our end. Please try again."
            onRetry={refresh}
          />
        ) : reports.length === 0 ? (
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              padding: "28px 24px",
              textAlign: "center",
              color: t.textSoft,
            }}
          >
            {statusFilter === "open"
              ? "No open reports — all clear."
              : "No reports to show here."}
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onRefresh={refresh}
                onStatus={setStatusMsg}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
