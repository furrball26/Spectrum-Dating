import { useState, useEffect, useRef, useCallback } from "react";
import { getAdminStats, getAdminReports, resolveReport, suspendUser, getPendingAttachments, reviewAttachment, getPendingProfilePhotos, reviewProfilePhoto, verifyUser, getAuditLog, getAdminFeedback, getVerificationRequests } from "./api.js";
import { t } from "./tokens.js";
import Skeleton from "./Skeleton.jsx";
import ErrorState from "./ErrorState.jsx";
import { useFocusable } from "./useFocusable.js";

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
    case "open": return t.warningFill;
    case "reviewed": return t.accentFill;
    case "actioned": return t.accentFill;
    case "dismissed": return t.mutedFill;
    default: return t.mutedFill;
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
        boxShadow: t.shadow.sm,
      }}
    >
      <div style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 14, color: t.textMuted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function SegmentedControl({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="Filter reports by status"
      style={{
        display: "flex",
        gap: 4,
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: 4,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "thin",
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
      aria-pressed={active}
      onClick={onClick}
      style={{
        flex: "1 0 auto",
        whiteSpace: "nowrap",
        minHeight: 44,
        padding: "8px 10px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        background: active ? t.surface : "transparent",
        color: active ? t.text : t.textSoft,
        boxShadow: active ? t.shadow.sm : "none",
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
    accent: { background: t.accentFill, color: "#fff", border: `1px solid ${t.accentFill}` },
    danger: { background: t.dangerFill, color: "#fff", border: `1px solid ${t.dangerFill}` },
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
  const [verified, setVerified] = useState(!!report.reportedVerified);
  const [verifyBusy, setVerifyBusy] = useState(false);
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
    } catch {
      setLocalError("Couldn't update verification. Please try again.");
    } finally {
      setVerifyBusy(false);
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
        boxShadow: t.shadow.sm,
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
            fontSize: 13,
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

      {(report.reportedEmail || verified) && (
        <div style={{ fontSize: 14, color: t.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {report.reportedEmail && <span>{report.reportedEmail}</span>}
          {verified && (
            <span style={{ color: t.accentStrong, fontWeight: 600 }}>✓ Verified</span>
          )}
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

      <div style={{ fontSize: 13, color: t.textMuted, marginTop: 12 }}>
        {formatTimestamp(report.createdAt)}
        {suspended && (
          <span style={{ color: t.danger, fontWeight: 600, marginLeft: 10 }}>• Account suspended</span>
        )}
      </div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "12px 0 0" }}>{localError}</p>
      )}

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
              minHeight: 44,
              padding: "8px 12px",
              borderRadius: 11,
              border: `1px solid ${t.formBorder}`,
              background: t.surface,
              color: t.text,
              // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
              fontSize: 16,
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
            // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
            fontSize: 16,
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
              background: t.dangerSurface,
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
    </li>
  );
}

// --- Photo review queue (Error Log E2) ---
// Lists photo attachments awaiting moderation and lets a moderator approve or
// reject each. Reuses the calm skeleton / empty / error states above.
function PhotoReviewSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 16,
            padding: 12,
            width: 220,
            display: "flex",
            flexDirection: "column",
            gap: 10,
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

function PhotoReviewCard({ item, onReviewed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function decide(decision) {
    setBusy(true);
    setLocalError("");
    try {
      await reviewAttachment(item.id, decision);
      onStatus(decision === "approved" ? "Photo approved." : "Photo rejected.");
      onReviewed(item.id);
    } catch {
      setLocalError("Couldn't update this photo. Please try again.");
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: 12,
        width: 240,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: t.shadow.sm,
      }}
    >
      <img
        src={item.publicUrl}
        alt={`Photo submitted by ${item.uploaderEmail || "a member"}, awaiting review`}
        loading="lazy"
        decoding="async"
        style={{
          display: "block",
          width: "100%",
          height: 180,
          objectFit: "cover",
          borderRadius: 10,
          border: `1px solid ${t.borderLight}`,
          background: t.surfaceAlt,
        }}
      />
      <div style={{ fontSize: 14, color: t.text, fontWeight: 600, wordBreak: "break-word" }}>
        {item.uploaderEmail || "Unknown member"}
      </div>
      <div style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{localError}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
        <PlainButton kind="accent" onClick={() => decide("approved")} disabled={busy}>
          Approve
        </PlainButton>
        <PlainButton kind="quiet" onClick={() => decide("rejected")} disabled={busy}>
          Reject
        </PlainButton>
      </div>
    </li>
  );
}

function PhotoReviewQueue({ onStatus }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getPendingAttachments("pending_review")
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load photos. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReviewed = useCallback((id) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  if (loading) return <PhotoReviewSkeleton />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load photos"
        message="Something went wrong on our end. Please try again."
        onRetry={load}
      />
    );
  }
  if (items.length === 0) {
    return (
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
        No photos awaiting review.
      </div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <PhotoReviewCard
          key={item.id}
          item={item}
          onReviewed={handleReviewed}
          onStatus={onStatus}
        />
      ))}
    </ul>
  );
}

// --- Profile-photo review queue (SAFETY-2) ---
// Lists profile photos awaiting moderation and lets a moderator approve or
// reject each. Mirrors the message-attachment PhotoReviewQueue above; decisions
// are 'approve' | 'reject' (the profile-photo endpoint's contract).
function ProfilePhotoReviewCard({ item, onReviewed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function decide(decision) {
    setBusy(true);
    setLocalError("");
    try {
      await reviewProfilePhoto(item.id, decision);
      onStatus(decision === "approve" ? "Profile photo approved." : "Profile photo rejected.");
      onReviewed(item.id);
    } catch {
      setLocalError("Couldn't update this photo. Please try again.");
      setBusy(false);
    }
  }

  const owner = item.ownerDisplayName || item.ownerEmail || "Unknown member";

  return (
    <li
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: 12,
        width: 240,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: t.shadow.sm,
      }}
    >
      <img
        src={item.url}
        alt={`Profile photo submitted by ${owner}, awaiting review`}
        loading="lazy"
        decoding="async"
        style={{
          display: "block",
          width: "100%",
          height: 180,
          objectFit: "cover",
          borderRadius: 10,
          border: `1px solid ${t.borderLight}`,
          background: t.surfaceAlt,
        }}
      />
      <div style={{ fontSize: 14, color: t.text, fontWeight: 600, wordBreak: "break-word" }}>
        {owner}
      </div>
      {item.ownerDisplayName && item.ownerEmail && (
        <div style={{ fontSize: 13, color: t.textMuted, wordBreak: "break-word" }}>{item.ownerEmail}</div>
      )}
      <div style={{ fontSize: 13, color: t.textMuted }}>{formatTimestamp(item.createdAt)}</div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: 0 }}>{localError}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
        <PlainButton kind="accent" onClick={() => decide("approve")} disabled={busy}>
          Approve
        </PlainButton>
        <PlainButton kind="quiet" onClick={() => decide("reject")} disabled={busy}>
          Reject
        </PlainButton>
      </div>
    </li>
  );
}

function ProfilePhotoReviewQueue({ onStatus }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getPendingProfilePhotos()
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load profile photos. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReviewed = useCallback((id) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  if (loading) return <PhotoReviewSkeleton />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load profile photos"
        message="Something went wrong on our end. Please try again."
        onRetry={load}
      />
    );
  }
  if (items.length === 0) {
    return (
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
        No profile photos awaiting review.
      </div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 14 }}>
      {items.map((item) => (
        <ProfilePhotoReviewCard
          key={item.id}
          item={item}
          onReviewed={handleReviewed}
          onStatus={onStatus}
        />
      ))}
    </ul>
  );
}

// --- Activity log (F2) ---
// Read-only moderation audit trail. Newest first. Calm rows: action · actor ·
// target · time · detail. Reuses the shared skeleton / error / empty patterns.
function AuditLogSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 14,
            padding: "16px 18px",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Skeleton width="45%" height={15} />
          <Skeleton width="70%" height={13} />
        </div>
      ))}
    </div>
  );
}

function AuditLogView() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getAuditLog()
      .then((data) => setLog(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load the activity log. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AuditLogSkeleton />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load the activity log"
        message="Something went wrong on our end. Please try again."
        onRetry={load}
      />
    );
  }
  if (log.length === 0) {
    return (
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
        No moderation activity yet.
      </div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {log.map((entry) => (
        <li
          key={entry.id}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 14,
            padding: "16px 18px",
            marginBottom: 10,
            listStyle: "none",
            boxShadow: t.shadow.sm,
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
            {entry.targetId != null && entry.targetId !== "" && (
              <>
                <span aria-hidden="true" style={{ color: t.textMuted, margin: "0 8px" }}>·</span>
                <span>target {entry.targetId}</span>
              </>
            )}
          </div>
          {entry.detail && (
            <p style={{ margin: "8px 0 0", fontSize: 14, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {entry.detail}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- Feedback inbox (F3) ---
// Read-only list of member feedback. Newest first. userEmail may be null.
function FeedbackInbox() {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getAdminFeedback()
      .then((data) => setFeedback(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load feedback. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AuditLogSkeleton />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load feedback"
        message="Something went wrong on our end. Please try again."
        onRetry={load}
      />
    );
  }
  if (feedback.length === 0) {
    return (
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
        No feedback yet.
      </div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {feedback.map((item) => (
        <li
          key={item.id}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 16,
            padding: "18px 20px",
            marginBottom: 12,
            listStyle: "none",
            boxShadow: t.shadow.sm,
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
// Lists members who requested identity verification (status 'pending'). Each row
// shows avatar/name/email/requested time with Approve / Reject actions that call
// the existing verifyUser endpoint. On success the row is removed from the list.
function VerificationCard({ item, onReviewed, onStatus }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function decide(approved) {
    setBusy(true);
    setLocalError("");
    try {
      await verifyUser(item.userId, approved);
      onStatus(
        approved
          ? `${item.displayName || "This member"} is now verified.`
          : `Verification declined for ${item.displayName || "this member"}.`
      );
      onReviewed(item.userId);
    } catch {
      setLocalError("Couldn't update this request. Please try again.");
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: "18px 20px",
        marginBottom: 12,
        listStyle: "none",
        boxShadow: t.shadow.sm,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {item.photoUrl ? (
          <img
            src={item.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              objectFit: "cover",
              border: `1px solid ${t.borderLight}`,
              background: t.surfaceAlt,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: t.surfaceAlt,
              border: `1px solid ${t.borderLight}`,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.text, wordBreak: "break-word" }}>
            {item.displayName || "Unnamed member"}
          </div>
          {item.email && (
            <div style={{ fontSize: 14, color: t.textMuted, wordBreak: "break-word" }}>
              {item.email}
            </div>
          )}
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
            Requested {formatTimestamp(item.requestedAt)}
          </div>
        </div>
      </div>

      {localError && (
        <p role="alert" style={{ color: t.danger, fontSize: 14, margin: "12px 0 0" }}>{localError}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <PlainButton kind="accent" onClick={() => decide(true)} disabled={busy}>
          Approve
        </PlainButton>
        <PlainButton kind="quiet" onClick={() => decide(false)} disabled={busy}>
          Reject
        </PlainButton>
      </div>
    </li>
  );
}

function VerificationQueue({ onStatus }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getVerificationRequests("pending")
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load verification requests. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReviewed = useCallback((userId) => {
    setItems((prev) => prev.filter((p) => p.userId !== userId));
  }, []);

  if (loading) return <ReportsSkeleton />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load verification requests"
        message="Something went wrong on our end. Please try again."
        onRetry={load}
      />
    );
  }
  if (items.length === 0) {
    return (
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
        No pending verification requests.
      </div>
    );
  }
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      {items.map((item) => (
        <VerificationCard
          key={item.userId}
          item={item}
          onReviewed={handleReviewed}
          onStatus={onStatus}
        />
      ))}
    </ul>
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
        minHeight: 44,
        padding: "8px 12px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        fontWeight: active ? 600 : 500,
        background: active ? t.surface : "transparent",
        color: active ? t.text : t.textSoft,
        boxShadow: active ? t.shadow.sm : "none",
        ...f.style,
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
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loadingReports, setLoadingReports] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [activeTab, setActiveTab] = useState("reports");
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 24 }}>
            <StatCard label="Members" value={stats.users ?? 0} />
            <StatCard label="Suspended" value={stats.suspended ?? 0} />
            <StatCard label="Matches" value={stats.matches ?? 0} />
            <StatCard label="Messages" value={stats.messages ?? 0} />
            <StatCard label="Open reports" value={stats.reports?.open ?? 0} />
          </div>
        )}

        {/* Tabs: Reports / Photo review */}
        <div
          role="tablist"
          aria-label="Moderation sections"
          style={{
            display: "flex",
            gap: 6,
            background: t.surfaceAlt,
            border: `1px solid ${t.borderLight}`,
            borderRadius: 12,
            padding: 4,
            marginBottom: 20,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "thin",
          }}
        >
          {ADMIN_TABS.map((tab) => (
            <TabButton
              key={tab.value}
              label={tab.label}
              active={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
            />
          ))}
        </div>

        {activeTab === "verification" ? (
          <VerificationQueue onStatus={setStatusMsg} />
        ) : activeTab === "photos" ? (
          <PhotoReviewQueue onStatus={setStatusMsg} />
        ) : activeTab === "profile-photos" ? (
          <ProfilePhotoReviewQueue onStatus={setStatusMsg} />
        ) : activeTab === "feedback" ? (
          <FeedbackInbox />
        ) : activeTab === "activity" ? (
          <AuditLogView />
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
          </>
        )}
      </div>
    </div>
  );
}
