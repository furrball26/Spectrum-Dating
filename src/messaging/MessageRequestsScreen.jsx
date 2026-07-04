import { useState, useEffect, useRef } from "react";
import { t } from "../tokens.js";
import Avatar from "../Avatar.jsx";
import VerifiedBadge from "../VerifiedBadge.jsx";
import { getSentMessageRequests } from "../api.js";

// Requests area (audit/MESSAGE_REQUESTS.md §3) — a SIBLING of the matches inbox,
// NOT part of it. Two calm sections:
//   • "Intros to you"   — inbound pending; Accept / Ignore / Decline + Block/report.
//   • "Intros you've sent" — pending + accepted ONLY (the backend never returns a
//     decline, so there is deliberately no seen/declined affordance to build).
// No urgency, no red dot, no "N people want to talk to you" — just a plain list.

function IntroText({ children }) {
  return (
    <p
      style={{
        margin: "12px 0 0",
        padding: "12px 14px",
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        color: t.text,
        fontSize: 16,
        lineHeight: 1.6,
        // A stranger's free text — wrap hard so a long unbroken string can't
        // push the card past the viewport (past overlap/truncation class).
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </p>
  );
}

function PersonHeader({ person }) {
  const photo = person?.photoUrl || (Array.isArray(person?.photos) && person.photos[0]?.url) || null;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
      <Avatar name={person?.displayName} userId={person?.userId} photoUrl={photo} size={48} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 17, color: t.text, overflowWrap: "break-word", minWidth: 0 }}>
            {person?.displayName || "Someone"}
            {typeof person?.age === "number" ? `, ${person.age}` : ""}
          </span>
          {person?.verified && <VerifiedBadge compact />}
        </div>
        {person?.distCity && (
          <div style={{ fontSize: 14, color: t.textMuted, marginTop: 2 }}>Near {person.distCity}</div>
        )}
      </div>
    </div>
  );
}

// One inbound intro card. Local per-card busy state so a slow Accept/Decline
// disables just this card, not the whole list.
function InboundCard({ req, onAccept, onDecline, onIgnore, onBlockReport, plainLanguage }) {
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const secondaryBtn = {
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
    background: t.surface,
    color: t.text,
    border: `1px solid ${t.border}`,
    fontFamily: t.sans,
  };

  return (
    <li
      style={{
        listStyle: "none",
        background: t.surface,
        border: `1px solid ${t.cardBorder}`,
        borderRadius: 16,
        padding: "18px 18px",
        marginBottom: 14,
        boxShadow: t.shadow.sm,
      }}
    >
      <PersonHeader person={req.sender} />
      <IntroText>{req.intro}</IntroText>
      {req.createdAt && (
        <div style={{ fontSize: 13, color: t.textMuted, margin: "8px 2px 0" }}>{req.createdAt}</div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => onAccept(req))}
          style={{
            minHeight: 44,
            padding: "10px 18px",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            background: t.accentFill,
            color: "#fff",
            border: "none",
            fontFamily: t.sans,
          }}
        >
          {busy ? "…" : "Accept"}
        </button>
        <button type="button" disabled={busy} onClick={() => onIgnore(req)} style={secondaryBtn}>
          {plainLanguage ? "Leave for now" : "Ignore"}
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => onDecline(req))} style={secondaryBtn}>
          Decline
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onBlockReport(req.sender)}
          style={{
            background: "none",
            border: "none",
            color: t.textMuted,
            fontSize: 14,
            textDecoration: "underline",
            cursor: "pointer",
            padding: "6px 4px",
            minHeight: 44,
            fontFamily: t.sans,
          }}
        >
          Block or report
        </button>
      </div>
    </li>
  );
}

function SentCard({ req, onOpenConversation }) {
  const accepted = req.status === "accepted";
  return (
    <li
      style={{
        listStyle: "none",
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        marginBottom: 12,
      }}
    >
      <PersonHeader person={req.recipient} />
      <IntroText>{req.intro}</IntroText>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        {/* Pending is the ONLY neutral state we ever show for a sent intro. We
            never imply it was seen or declined — the backend can't tell us, and
            revealing it would be anti-retaliation-unsafe. */}
        <span style={{ fontSize: 14, color: t.textSoft }}>
          {accepted ? "You're connected — this is a conversation now." : "Waiting. There's no rush."}
        </span>
        {accepted && req.conversationId && onOpenConversation && (
          <button
            type="button"
            onClick={() => onOpenConversation(req.conversationId, {
              userId: req.recipient?.userId,
              displayName: req.recipient?.displayName,
              photoUrl: req.recipient?.photoUrl || null,
            })}
            style={{
              minHeight: 44,
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              background: t.surface,
              color: t.accentStrong,
              border: `1px solid ${t.accentStrong}`,
              fontFamily: t.sans,
            }}
          >
            Open conversation
          </button>
        )}
      </div>
    </li>
  );
}

export default function MessageRequestsScreen({
  requests = [],
  onBack,
  onAccept,
  onDecline,
  onIgnore,
  onBlockReport,
  onOpenConversation,
  statusMessage = "",
  plainLanguage = false,
}) {
  const headingRef = useRef(null);
  const [sent, setSent] = useState([]);
  const [sentLoading, setSentLoading] = useState(true);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // The sender outbox is only needed once this area is open — fetch on mount.
  useEffect(() => {
    let cancelled = false;
    setSentLoading(true);
    getSentMessageRequests()
      .then((rows) => { if (!cancelled) setSent(rows); })
      .catch(() => { /* non-fatal — show an empty Sent section */ })
      .finally(() => { if (!cancelled) setSentLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      data-testid="message-requests-scroll"
      style={{
        // Mounts inside the height-locked Messages tab, so become our own bounded
        // scroll container (mirrors BlockReportScreen) — never grow the page body.
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 17,
        lineHeight: 1.65,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "20px 16px 48px" }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to messages"
          style={{
            background: "transparent",
            border: "none",
            color: t.accentStrong,
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            padding: "8px 0",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            minHeight: 44,
          }}
        >
          ← Messages
        </button>

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 26,
            fontWeight: 700,
            margin: "0 0 6px",
            color: t.text,
            letterSpacing: "-0.01em",
            outline: "none",
          }}
        >
          Requests
        </h1>
        <p style={{ fontSize: 15, color: t.textSoft, margin: "0 0 20px", lineHeight: 1.55 }}>
          {plainLanguage
            ? "These are intros from people you haven't matched with. You can accept, leave them, or say no. Nothing here is urgent."
            : "Intros from people you haven't matched with yet. Accept to start a conversation, or leave them be — there's no clock and no one is told what you choose."}
        </p>

        {/* Polite status region — accept-cap and similar calm notices. */}
        {statusMessage && (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              background: t.surfaceAlt,
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              fontSize: 15,
              color: t.textSoft,
              lineHeight: 1.5,
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* Inbound */}
        {requests.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0 32px" }}>
            <p style={{ color: t.textSoft, margin: 0, fontSize: 16 }}>No intros waiting.</p>
            <p style={{ color: t.textMuted, margin: "8px 0 0", fontSize: 14 }}>
              When someone sends you an intro, it will appear here.
            </p>
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {requests.map((req) => (
              <InboundCard
                key={req.id}
                req={req}
                onAccept={onAccept}
                onDecline={onDecline}
                onIgnore={onIgnore}
                onBlockReport={onBlockReport}
                plainLanguage={plainLanguage}
              />
            ))}
          </ul>
        )}

        {/* Sent */}
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: t.textSoft,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            margin: "32px 0 12px",
          }}
        >
          Intros you've sent
        </h2>
        {sentLoading ? (
          <p style={{ color: t.textMuted, fontSize: 14, margin: 0 }}>Loading…</p>
        ) : sent.length === 0 ? (
          <p style={{ color: t.textMuted, fontSize: 14, margin: 0 }}>
            You haven't sent any intros yet.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {sent.map((req) => (
              <SentCard key={req.id} req={req} onOpenConversation={onOpenConversation} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
