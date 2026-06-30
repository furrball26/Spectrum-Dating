import { useState, useEffect, useRef } from "react";
import { t } from "./tokens.js";
import { getMatches, createConversation } from "./api.js";

// Matches — people you and they have both said yes to. Separate from active
// conversations (Messages). Calm, low-pressure: no counters, no urgency.

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

function Avatar({ name, photoUrl }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const size = 56;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        overflow: "hidden",
        background: t.accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: t.serif,
        fontSize: 24,
        fontWeight: 700,
      }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initial
      )}
    </div>
  );
}

function MatchCard({ match, busy, onOpen }) {
  const f = useFocusable();
  const { otherUser, hasConversation } = match;
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
        <Avatar name={otherUser.displayName} photoUrl={otherUser.photoUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: t.text }}>
            {otherUser.displayName || "Someone"}
          </div>
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
        </div>
        <button
          type="button"
          onClick={() => onOpen(match)}
          disabled={busy}
          {...f}
          style={{
            flexShrink: 0,
            minHeight: 44,
            padding: "9px 18px",
            borderRadius: 11,
            border: "none",
            cursor: busy ? "wait" : "pointer",
            fontSize: 14,
            fontWeight: 600,
            background: hasConversation ? t.surfaceAlt : t.accentStrong,
            color: hasConversation ? t.text : "#fff",
            opacity: busy ? 0.7 : 1,
            ...f.style,
          }}
        >
          {busy ? "Starting…" : hasConversation ? "Open chat" : "Say hello"}
        </button>
      </div>
    </li>
  );
}

export default function MatchesScreen({ onOpenConversation }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    getMatches()
      .then(setMatches)
      .catch(() => setError("Couldn't load your matches. Please try again."))
      .finally(() => setLoading(false));
  }, []);

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
      setError(
        e?.code === "CAP_REACHED"
          ? "You've reached the limit of active conversations. Archive one from Messages to start a new chat."
          : e?.message || "Couldn't start the conversation. Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 40px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: 560, margin: "0 auto" };

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
          <p style={{ color: t.textSoft }}>Loading your matches…</p>
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
            No matches yet. When you and someone both say you're interested in
            Discover, they'll appear here.
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
