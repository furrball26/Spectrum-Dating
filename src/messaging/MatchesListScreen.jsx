import { useState, useRef, useEffect } from "react";
import { t } from "../tokens.js";
import VerifiedBadge from "../VerifiedBadge.jsx";
import Avatar from "../Avatar.jsx";
import Skeleton from "../Skeleton.jsx";
import { EmptyMessages } from "../illustrations.jsx";
import ErrorState from "../ErrorState.jsx";

const CONVERSATION_CAP = 5;
const AVATAR_SIZE = 44;

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

// Calm placeholder rows shown while conversations load.
function MatchesListSkeleton() {
  return (
    <div style={{ padding: "8px 16px" }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 0",
          }}
        >
          <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius="50%" />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width="40%" height={15} />
            <Skeleton width="60%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Feature 3: MatchRow accepts showArchive and onArchive props
function MatchRow({ match, onSelectConversation, showArchive, onArchive, selected }) {
  const f = useFocusable();
  const fArchive = useFocusable();
  const { otherUser, lastMessageLabel, unread, started } = match;
  const ariaLabel = [
    `${otherUser.displayName}.`,
    unread ? "Unread: New messages." : "",
    `Last message group: ${lastMessageLabel || "Not started"}.`,
  ].filter(Boolean).join(" ");

  return (
    <li style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: selected ? t.surfaceAlt : t.surface,
          borderLeft: selected
            ? `3px solid ${t.accent}`
            : unread ? `3px solid ${t.accent}` : "3px solid transparent",
          borderBottom: `1px solid ${t.borderLight}`,
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          aria-label={ariaLabel}
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelectConversation(match.conversationId)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flex: 1,
            minHeight: 56,
            padding: "10px 16px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            boxSizing: "border-box",
            ...f.style,
          }}
          onFocus={f.onFocus}
          onBlur={f.onBlur}
        >
          <Avatar
            name={otherUser.displayName}
            userId={otherUser.userId}
            photoUrl={otherUser.photoUrl}
            size={AVATAR_SIZE}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}>
              <span style={{
                fontWeight: unread ? 600 : 400,
                fontSize: 16,
                color: t.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {otherUser.displayName}
              </span>
              {otherUser.verified && <VerifiedBadge style={{ flexShrink: 0 }} />}
            </div>
            {lastMessageLabel && (
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
                {lastMessageLabel}
              </div>
            )}
          </div>
          {unread && (
            <div
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: t.accent,
                flexShrink: 0,
              }}
            />
          )}
        </button>

        {/* Feature 3 — Archive button shown on active rows when cap reached */}
        {showArchive && (
          <button
            type="button"
            aria-label={`Archive conversation with ${otherUser.displayName}`}
            onClick={() => onArchive && onArchive(match.conversationId)}
            style={{
              background: "transparent",
              border: "none",
              color: t.textSoft,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              padding: "8px 16px",
              minHeight: 44,
              flexShrink: 0,
              ...fArchive.style,
            }}
            onFocus={fArchive.onFocus}
            onBlur={fArchive.onBlur}
          >
            Archive
          </button>
        )}
      </div>
    </li>
  );
}

// Feature 3: SectionList passes showArchive and onArchive down to MatchRow
function SectionList({ title, matches, onSelectConversation, showArchive, onArchive, selectedConversationId }) {
  if (matches.length === 0) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{
        fontSize: 13,
        fontWeight: 600,
        color: t.textSoft,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        margin: "0 0 8px 16px",
      }}>
        {title}
      </h2>
      <ul
        role="list"
        style={{
          margin: 0,
          padding: 0,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {matches.map((m) => (
          <MatchRow
            key={m.conversationId || m.matchId}
            match={m}
            onSelectConversation={onSelectConversation}
            showArchive={showArchive}
            onArchive={onArchive}
            selected={selectedConversationId != null && m.conversationId === selectedConversationId}
          />
        ))}
      </ul>
    </section>
  );
}

// Feature 3: conversationCount prop and onArchive prop added
export default function MatchesListScreen({
  conversations = [],
  loading = false,
  loadFailed = false,
  onRetry,
  onSelectConversation,
  statusMessage,
  onArchive,
  selectedConversationId = null,
}) {
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (loadFailed) {
    return (
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "24px 16px 48px" }}>
        <h1
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 24px",
            color: t.text,
            letterSpacing: "-0.01em",
          }}
        >
          Your matches
        </h1>
        <ErrorState
          title="Couldn't load your matches"
          message="Something went wrong on our end. Please try again."
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "24px 16px 48px" }}>
        <h1
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 24px",
            color: t.text,
            letterSpacing: "-0.01em",
          }}
        >
          Your matches
        </h1>
        <MatchesListSkeleton />
      </div>
    );
  }

  const active = conversations.filter((m) => m.started);
  const newMatches = conversations.filter((m) => !m.started);
  const conversationCount = active.length;

  const capReached = conversationCount >= CONVERSATION_CAP;

  return (
    <div
      id="matches-list"
      style={{
        minHeight: "100%",
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 17,
        lineHeight: 1.65,
        boxSizing: "border-box",
      }}
    >
      {/* Skip-to-content */}
      <a
        href="#matches-list"
        style={{
          position: "absolute",
          left: "-9999px",
          top: "auto",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
        onFocus={(e) => {
          e.target.style.left = "16px";
          e.target.style.top = "16px";
          e.target.style.width = "auto";
          e.target.style.height = "auto";
          e.target.style.zIndex = 9999;
          e.target.style.background = t.surface;
          e.target.style.padding = "8px 16px";
          e.target.style.border = `2px solid ${t.focus}`;
          e.target.style.borderRadius = 8;
        }}
        onBlur={(e) => {
          e.target.style.left = "-9999px";
          e.target.style.top = "auto";
          e.target.style.width = 1;
          e.target.style.height = 1;
        }}
      >
        Skip to matches
      </a>

      {/* Status region for match-disappeared announcements */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        {statusMessage || ""}
      </div>

      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "24px 16px 48px" }}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            fontFamily: t.serif,
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 24px",
            color: t.text,
            letterSpacing: "-0.01em",
            outline: "none",
          }}
        >
          Your matches
        </h1>

        <SectionList
          title="Active conversations"
          matches={active}
          onSelectConversation={onSelectConversation}
          showArchive={capReached}
          onArchive={onArchive}
          selectedConversationId={selectedConversationId}
        />

        {/* Feature 3 — Conversation cap notice above New matches */}
        {capReached && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              background: t.surfaceAlt,
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              color: t.textSoft,
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            You have {CONVERSATION_CAP} active conversations. Archive one to start a new one.
          </div>
        )}

        <SectionList
          title="New matches"
          matches={newMatches}
          onSelectConversation={onSelectConversation}
          selectedConversationId={selectedConversationId}
        />

        {conversations.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 48 }}>
            <div style={{ marginBottom: 16 }}>
              <EmptyMessages size={104} />
            </div>
            <p style={{ color: t.textSoft, margin: 0 }}>
              No matches yet. Check back soon. Only people you've both matched with
              can message you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
