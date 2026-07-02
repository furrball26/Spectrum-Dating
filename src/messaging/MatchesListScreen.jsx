import { useState, useRef, useEffect } from "react";
import { t } from "../tokens.js";
import { getUserId } from "../api.js";
import VerifiedBadge from "../VerifiedBadge.jsx";
import Avatar from "../Avatar.jsx";
import Skeleton from "../Skeleton.jsx";
import { EmptyMessages } from "../illustrations.jsx";
import ErrorState from "../ErrorState.jsx";
import { useFocusable } from "../useFocusable.js";

const CONVERSATION_CAP = 5;
const AVATAR_SIZE = 44;


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

// MatchRow accepts showArchive/onArchive for active rows and
// showUnarchive/onUnarchive for archived rows.
function MatchRow({ match, onSelectConversation, showArchive, onArchive, showUnarchive, onUnarchive, selected, currentUserId }) {
  const f = useFocusable();
  const fArchive = useFocusable();
  const fRestore = useFocusable(); // for the unarchive / "Restore" button
  const {
    otherUser, lastMessageLabel, unread, started, ended,
    lastMessageSnippet, lastMessageSenderId, lastMessageDeleted,
  } = match;

  // F23 — who-replied-last cue. Prefix the snippet with "You: " when the last
  // sender is the current user, otherwise the other person's short (first-word)
  // name. Snippet itself is already ≤80 chars + "…"-truncated server-side; we
  // add single-line ellipsis so long snippets never break row height.
  const otherShortName = (otherUser.displayName || "").trim().split(/\s+/)[0] || otherUser.displayName;
  const sentByMe = lastMessageSenderId != null && lastMessageSenderId === currentUserId;
  const snippetPrefix = sentByMe ? "You: " : `${otherShortName}: `;

  // The wayfinding line under the name: removed marker, snippet, or a calm
  // placeholder when the thread has started but has no messages yet.
  let wayfindingText = null;
  let wayfindingMuted = false;
  if (started && !ended) {
    if (lastMessageDeleted) {
      wayfindingText = "Message removed";
      wayfindingMuted = true;
    } else if (lastMessageSnippet) {
      wayfindingText = `${snippetPrefix}${lastMessageSnippet}`;
    } else {
      wayfindingText = "No messages yet — say hello";
      wayfindingMuted = true;
    }
  }

  const ariaLabel = [
    `${otherUser.displayName}.`,
    // F21 — an ended (read-only) thread never carries an unread nudge.
    ended ? "This conversation has ended." : (unread ? "Unread: New messages." : ""),
    // F23 — announce the last-message cue (or removed/empty state) for SR users.
    !ended && wayfindingText ? `${wayfindingText}.` : "",
    ended ? "" : `Last message group: ${lastMessageLabel || "Not started"}.`,
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
          aria-current={selected ? "page" : undefined}
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
              {otherUser.verified && <VerifiedBadge interactive={false} style={{ flexShrink: 0 }} />}
            </div>
            {ended ? (
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2, fontStyle: "italic" }}>
                Conversation ended
              </div>
            ) : (
              <>
                {/* F23 — last-message snippet + who-replied-last cue. Single
                    line, ellipsis-truncated so rows stay tidy and calm. Deleted
                    → neutral "Message removed"; no messages → gentle placeholder.
                    No unread count (calm-by-design). */}
                {wayfindingText && (
                  <div style={{
                    fontSize: 13,
                    color: wayfindingMuted ? t.textMuted : t.textSoft,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontStyle: wayfindingMuted ? "italic" : "normal",
                  }}>
                    {wayfindingText}
                  </div>
                )}
                {lastMessageLabel && (
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 1 }}>
                    {lastMessageLabel}
                  </div>
                )}
              </>
            )}
          </div>
          {!ended && unread && (
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

        {/* Archive button shown on active rows when cap reached */}
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

        {/* Restore button shown on archived rows */}
        {showUnarchive && (
          <button
            type="button"
            aria-label={`Restore conversation with ${otherUser.displayName}`}
            onClick={() => onUnarchive && onUnarchive(match.conversationId)}
            style={{
              background: "transparent",
              border: "none",
              color: t.accentStrong,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              padding: "8px 16px",
              minHeight: 44,
              flexShrink: 0,
              ...fRestore.style,
            }}
            onFocus={fRestore.onFocus}
            onBlur={fRestore.onBlur}
          >
            Restore
          </button>
        )}
      </div>
    </li>
  );
}

// Feature 3: SectionList passes showArchive and onArchive down to MatchRow
function SectionList({ title, subtitle, matches, onSelectConversation, showArchive, onArchive, selectedConversationId, currentUserId }) {
  if (matches.length === 0) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 0 8px 16px", paddingRight: 4 }}>
        <h2 style={{
          fontSize: 13,
          fontWeight: 600,
          color: t.textSoft,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: 0,
        }}>
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>{subtitle}</span>
        )}
      </div>
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
            currentUserId={currentUserId}
            selected={selectedConversationId != null && m.conversationId === selectedConversationId}
          />
        ))}
      </ul>
    </section>
  );
}

export default function MatchesListScreen({
  conversations = [],
  loading = false,
  loadFailed = false,
  onRetry,
  onSelectConversation,
  statusMessage,
  onArchive,
  selectedConversationId = null,
  plainLanguage = false,
  // Server-authoritative active-conversation cap (falls back to the module
  // default if the server didn't send one).
  activeCap = CONVERSATION_CAP,
  // ─── Archived view ─────────────────────────────────────────────────────────
  showingArchived = false,
  archivedConversations = [],
  archivedLoading = false,
  archivedCount = 0,
  onToggleArchived,
  onUnarchive,
}) {
  const headingRef = useRef(null);
  // ALL hooks declared here — before any early return (including the archived
  // view path below) so the hook order is always stable.
  const [query, setQuery] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  // F23 — current user id for the who-replied-last cue ("You:" vs their name).
  // Same source the conversation screen uses (getUserId reads local auth).
  const currentUserId = getUserId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // ─── Archived view ───────────────────────────────────────────────────────────
  // Returned before the active-load error/loading paths so those states don't
  // bleed into the archived list experience.
  if (showingArchived) {
    return (
      <div
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
        <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto", padding: "24px 16px 48px" }}>
          {/* Back link */}
          <button
            type="button"
            onClick={onToggleArchived}
            aria-label="Back to active conversations"
            style={{
              background: "none",
              border: "none",
              color: t.accentStrong,
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
              padding: "0 0 16px",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ← Messages
          </button>

          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: t.serif,
              fontSize: 28,
              fontWeight: 700,
              margin: "0 0 20px",
              color: t.text,
              letterSpacing: "-0.01em",
              outline: "none",
            }}
          >
            Archived
          </h1>

          {archivedLoading ? (
            <MatchesListSkeleton />
          ) : archivedConversations.length === 0 ? (
            <div style={{ textAlign: "center", marginTop: 48 }}>
              <p style={{ color: t.textSoft, margin: 0, fontSize: 16 }}>
                No archived conversations.
              </p>
              <p style={{ color: t.textMuted, margin: "8px 0 0", fontSize: 14 }}>
                When you archive a conversation it will appear here.
              </p>
            </div>
          ) : (
            <>
              <p style={{ color: t.textSoft, fontSize: 14, margin: "0 0 16px" }}>
                Tap Restore to move a conversation back to your active list.
              </p>
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
                {archivedConversations.map((m) => (
                  <MatchRow
                    key={m.conversationId || m.matchId}
                    match={m}
                    onSelectConversation={onSelectConversation}
                    showUnarchive
                    onUnarchive={onUnarchive}
                    currentUserId={currentUserId}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Active-load error / loading states ──────────────────────────────────────
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

  const capReached = conversationCount >= activeCap;

  // Filtering logic — computed from query state
  const trimmedQuery = query.trim().toLowerCase();
  const isFiltering = trimmedQuery.length > 0;
  const filteredConversations = isFiltering
    ? conversations.filter((m) =>
        (m.otherUser?.displayName || "").toLowerCase().includes(trimmedQuery)
      )
    : [];

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
      {/* Skip link removed — the app-level "Skip to content" (App.jsx) handles
          bypassing the header + nav; this one pointed at its own container. */}

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
            margin: "0 0 20px",
            color: t.text,
            letterSpacing: "-0.01em",
            outline: "none",
          }}
        >
          Your matches
        </h1>

        {/* Search / filter input — only shown when there are conversations to filter */}
        {conversations.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="conversation-filter"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                color: t.textSoft,
                marginBottom: 6,
                fontFamily: t.sans,
              }}
            >
              Filter by name
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="conversation-filter"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your matches…"
                autoComplete="off"
                aria-controls="matches-list"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: query ? "10px 44px 10px 14px" : "10px 14px",
                  // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
                  fontSize: 16,
                  fontFamily: t.sans,
                  color: t.text,
                  background: t.surface,
                  border: `1.5px solid ${inputFocused ? t.accent : t.formBorder}`,
                  borderRadius: 12,
                  outline: "none",
                  transition: `border-color ${t.motion.base} ${t.motion.standard}`,
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: t.textMuted,
                    fontSize: 20,
                    lineHeight: 1,
                    padding: 0,
                    width: 32,
                    height: 32,
                    minHeight: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {/* Live result count announced to screen readers */}
            {isFiltering && (
              <div
                aria-live="polite"
                aria-atomic="true"
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                }}
              >
                {filteredConversations.length === 0
                  ? `No matches found for "${query.trim()}".`
                  : `${filteredConversations.length} match${filteredConversations.length === 1 ? "" : "es"} found.`}
              </div>
            )}
          </div>
        )}

        {/* Filtered view */}
        {isFiltering ? (
          filteredConversations.length > 0 ? (
            <SectionList
              title={`Results (${filteredConversations.length})`}
              matches={filteredConversations}
              onSelectConversation={onSelectConversation}
              selectedConversationId={selectedConversationId}
              currentUserId={currentUserId}
            />
          ) : (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ color: t.textSoft, margin: 0, fontSize: 16 }}>
                No matches named &ldquo;{query.trim()}&rdquo;.
              </p>
            </div>
          )
        ) : (
          /* Normal sections view */
          <>
            <SectionList
              title="Active conversations"
              subtitle={active.length > 0 ? `${conversationCount} / ${activeCap}` : undefined}
              matches={active}
              onSelectConversation={onSelectConversation}
              showArchive={capReached}
              onArchive={onArchive}
              selectedConversationId={selectedConversationId}
              currentUserId={currentUserId}
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
                You have {activeCap} active conversations. Archive one to start a new one.
              </div>
            )}

            <SectionList
              title="New matches"
              matches={newMatches}
              onSelectConversation={onSelectConversation}
              selectedConversationId={selectedConversationId}
              currentUserId={currentUserId}
            />

            {conversations.length === 0 && (
              <div style={{ textAlign: "center", marginTop: 48 }}>
                <div style={{ marginBottom: 16 }}>
                  <EmptyMessages size={104} />
                </div>
                <p style={{ color: t.textSoft, margin: 0 }}>
                  {archivedCount > 0
                    // D36: they DO have matches — they're just archived. Don't
                    // say "no matches yet"; point them to the archive instead.
                    ? (plainLanguage
                        ? "Your conversations are archived. Open Archived conversations below to see them."
                        : "Your matches are archived. You'll find them under Archived conversations below.")
                    : (plainLanguage
                        ? "No matches yet. Only people you've both matched with can message you."
                        : "No matches yet. Check back soon. Only people you've both matched with can message you.")}
                </p>
              </div>
            )}
          </>
        )}

        {/* Quiet link to archived conversations — always visible so users know
            the feature exists; count shown when there are archived threads. */}
        {onToggleArchived && (
          <div style={{ textAlign: "center", marginTop: 32 }}>
            <button
              type="button"
              onClick={onToggleArchived}
              style={{
                background: "none",
                border: "none",
                color: t.textMuted,
                fontSize: 14,
                cursor: "pointer",
                padding: "8px 12px",
                minHeight: 44,
                borderRadius: 8,
              }}
            >
              {archivedCount > 0
                ? `Archived conversations (${archivedCount})`
                : "Archived conversations"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
