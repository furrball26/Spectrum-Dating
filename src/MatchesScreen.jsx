import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { getMatches, createConversation } from "./api.js";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import Skeleton from "./Skeleton.jsx";
import Button from "./Button.jsx";
import Spectrum from "./Spectrum.jsx";
import { EmptyMatches } from "./illustrations.jsx";
import ErrorState from "./ErrorState.jsx";

// Matches — people you and they have both said yes to. Separate from active
// conversations (Messages). Calm, low-pressure: no counters, no urgency.

// Calm placeholder rows shown while matches load.
function MatchesSkeleton() {
  return (
    <ul style={{ margin: 0, padding: 0 }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} style={{ listStyle: "none", marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              padding: "14px 16px",
            }}
          >
            <Skeleton width={56} height={56} radius="50%" />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton width="45%" height={16} />
              <Skeleton width="70%" height={13} />
            </div>
            <Skeleton width={84} height={38} radius={11} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MatchCard({ match, busy, onOpen }) {
  const { otherUser, hasConversation } = match;
  // Optional first-prompt preview — only if it has an answer and no tagline/context
  // already filling the row, to keep the card calm and uncluttered.
  const firstPrompt = Array.isArray(otherUser.prompts)
    ? otherUser.prompts.find((p) => p && p.answer && p.answer.trim() && (p.promptText || p.promptKey))
    : null;
  const showPrompt =
    firstPrompt && !otherUser.tagline && !(otherUser.contextCard && otherUser.contextCard.trim());
  return (
    <li style={{ listStyle: "none", marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          padding: "14px 16px",
          boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
        }}
      >
        <Avatar name={otherUser.displayName} userId={otherUser.userId} photoUrl={otherUser.photoUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: t.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{otherUser.displayName || "Someone"}</span>
            {otherUser.verified && <VerifiedBadge />}
          </div>
          {otherUser.distCity && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
              {otherUser.distCity}
            </div>
          )}
          {otherUser.tagline && (
            <div
              style={{
                fontSize: 14,
                color: t.textSoft,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {otherUser.tagline}
            </div>
          )}
          {otherUser.contextCard && otherUser.contextCard.trim() && (
            <div
              style={{
                fontSize: 13,
                color: t.textSoft,
                fontStyle: "italic",
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              “{otherUser.contextCard}”
            </div>
          )}
          {showPrompt && (
            <div style={{ marginTop: 4, overflow: "hidden" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: t.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {firstPrompt.promptText || firstPrompt.promptKey}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: t.text,
                  fontFamily: t.serif,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {firstPrompt.answer}
              </div>
            </div>
          )}
        </div>
        <Button
          variant={hasConversation ? "secondary" : "primary"}
          onClick={() => onOpen(match)}
          disabled={busy}
          style={{ flexShrink: 0, cursor: busy ? "wait" : undefined }}
        >
          {busy ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Spectrum variant="loader" size={6} gap={3} />
              Starting…
            </span>
          ) : hasConversation ? "Open chat" : "Say hello"}
        </Button>
      </div>
    </li>
  );
}

export default function MatchesScreen({ onOpenConversation }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const loadMatches = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    getMatches()
      .then(setMatches)
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  async function handleOpen(match) {
    if (match.hasConversation && match.conversationId) {
      onOpenConversation(match.conversationId);
      return;
    }
    setBusyId(match.matchId);
    setError("");
    try {
      const res = await createConversation(match.matchId);
      const convId = res?.conversation?.id || res?.conversationId;
      if (convId) onOpenConversation(convId);
      else setError("Couldn't open the conversation. Please try again.");
    } catch (e) {
      // The conversation already exists (e.g. stale list / race): the server
      // returns 409 with the existing id — just open it instead of erroring.
      const existingId = e?.status === 409 && e?.body?.conversationId;
      if (existingId) {
        onOpenConversation(existingId);
      } else {
        setError(
          e?.code === "CAP_REACHED"
            ? "You've reached the limit of active conversations. Archive one from Messages to start a new chat."
            : e?.message || "Couldn't start the conversation. Please try again."
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 40px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };

  return (
    <div style={page}>
      <div style={shell}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: t.text, outline: "none" }}
        >
          Matches
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 15, color: t.textSoft }}>
          People you've both said yes to. Reach out whenever you're ready — there's no rush.
        </p>

        {error && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}

        {loading ? (
          <MatchesSkeleton />
        ) : loadFailed ? (
          <ErrorState
            title="Couldn't load your matches"
            message="Something went wrong on our end. Please try again."
            onRetry={loadMatches}
          />
        ) : matches.length === 0 ? (
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
            <div style={{ marginBottom: 16 }}>
              <EmptyMatches size={104} />
            </div>
            No matches yet. When you and someone both say you're interested in
            Discover, they'll appear here. Only people you've both matched with
            can message you.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0 }}>
            {matches.map((m) => (
              <MatchCard
                key={m.matchId}
                match={m}
                busy={busyId === m.matchId}
                onOpen={handleOpen}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
