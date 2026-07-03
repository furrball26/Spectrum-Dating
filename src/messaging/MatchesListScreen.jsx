import { useState, useRef, useEffect } from "react";
import { t } from "../tokens.js";
import VerifiedBadge from "../VerifiedBadge.jsx";
import Avatar from "../Avatar.jsx";
import Skeleton from "../Skeleton.jsx";
import { EmptyMessages } from "../illustrations.jsx";
import ErrorState from "../ErrorState.jsx";
import { useFocusable } from "../useFocusable.js";

const CONVERSATION_CAP = 5;
const AVATAR_SIZE = 56;


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
            gap: 16,
            padding: "10px 0",
          }}
        >
          <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius="50%" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Skeleton width="45%" height={16} />
          </div>
        </div>
      ))}
    </div>
  );
}

// When the last message is recent, relative words read calmer ("Today",
// "Yesterday", "Tue"); past a week they stop meaning anything, so switch to a
// real date ("Jun 24", with the year when it isn't this year). Falls back to
// the server's group label when no timestamp came through.
function formatRowDate(iso, fallback) {
  if (!iso) return fallback || null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return fallback || null;
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

// MatchRow: archiving lives in the per-row ⋯ menu (rowMenuProps.onArchive);
// archived rows keep their visible Restore button (showUnarchive/onUnarchive).
// No message preview — the row is just who + when (calm, glanceable), with the
// full name always shown whole (wrapping instead of truncating).
function MatchRow({ match, onSelectConversation, showUnarchive, onUnarchive, selected, onStartConversation, startingMatchId, rowMenuProps, first, last }) {
  const f = useFocusable();
  const fRestore = useFocusable(); // for the unarchive / "Restore" button
  const { otherUser, lastMessageLabel, lastMessageAt, unread, started, ended } = match;

  const dateLabel = ended ? null : formatRowDate(lastMessageAt, lastMessageLabel);

  const ariaLabel = [
    `${otherUser.displayName}.`,
    // The list badge is icon-only (aria-hidden), so the row label carries it.
    otherUser.verified ? "Reviewed profile." : "",
    // F21 — an ended (read-only) thread never carries an unread nudge.
    ended ? "This conversation has ended." : (unread ? "Unread: New messages." : ""),
    ended ? "" : `Last message: ${dateLabel || "Not started"}.`,
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
          // FE-3: the parent <ul> no longer clips with overflow:hidden (that
          // was hiding the row ⋯ menu popover), so each row rounds its own
          // outer corners to nest inside the list's 14px rounded border. Last
          // row drops its divider — the container's own bottom border closes it.
          borderBottom: last ? "none" : `1px solid ${t.borderLight}`,
          ...(first ? { borderTopLeftRadius: 13, borderTopRightRadius: 13 } : {}),
          ...(last ? { borderBottomLeftRadius: 13, borderBottomRightRadius: 13 } : {}),
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          aria-label={ariaLabel}
          aria-current={selected ? "page" : undefined}
          onClick={() =>
            match.needsConversation
              ? onStartConversation && onStartConversation(match)
              : onSelectConversation(match.conversationId)
          }
          disabled={match.needsConversation && startingMatchId != null}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flex: 1,
            // Allow the button to shrink below its content width — the implicit
            // min-width:auto let long snippets push the row past the viewport
            // and collide with the trailing controls.
            minWidth: 0,
            minHeight: 72,
            padding: "12px 16px",
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
            {/* Who + when, nothing else. The full name always shows whole —
                it wraps onto a second line rather than truncating; the date
                sits right-aligned and never shrinks. */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}>
              <span style={{
                fontWeight: unread ? 600 : 400,
                fontSize: 16,
                lineHeight: 1.35,
                color: t.text,
                minWidth: 0,
                overflowWrap: "break-word",
              }}>
                {otherUser.displayName}
              </span>
              {otherUser.verified && <VerifiedBadge compact />}
              {dateLabel && (
                <span style={{
                  marginLeft: "auto",
                  paddingLeft: 8,
                  fontSize: 13,
                  color: t.textMuted,
                  flexShrink: 0,
                }}>
                  {dateLabel}
                </span>
              )}
            </div>
            {ended && (
              <div style={{ fontSize: 14, color: t.textMuted, marginTop: 2, fontStyle: "italic" }}>
                Conversation ended
              </div>
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

        {/* Per-row ⋯ menu (view profile / note / archive / block / unmatch) */}
        {rowMenuProps && match.matchId && (
          <RowMenu
            row={{ matchId: match.matchId, conversationId: match.conversationId || null, otherUser: match.otherUser, started }}
            note={rowMenuProps.matchNotes ? rowMenuProps.matchNotes[match.matchId] : null}
            onViewProfile={rowMenuProps.onViewProfile}
            onNote={rowMenuProps.onNote}
            onArchive={showUnarchive ? null : rowMenuProps.onArchive}
            onReport={rowMenuProps.onReport}
            onUnmatch={rowMenuProps.onUnmatch}
          />
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

// Quiet per-row ⋯ menu — archive, block/report/unmatch (and the private note)
// reachable without opening the conversation. Focus returns to the trigger on
// close; destructive items last, visually separated (a11y adjacency spec).
function RowMenu({ row, note, onViewProfile, onNote, onArchive, onReport, onUnmatch }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const f = useFocusable();
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } }
    function onClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);
  const itemStyle = { display: "block", width: "100%", padding: "12px 16px", background: "transparent", border: "none", textAlign: "left", fontSize: 16, fontWeight: 500, cursor: "pointer", fontFamily: t.sans };
  const name = row.otherUser?.displayName || "this person";
  // FE-2: activating a menu item closes the menu, which unmounts the item
  // button (it lives inside the `open &&` block). If that button still holds
  // focus when it unmounts, focus falls to <body> — so the modal this item
  // opens snapshots <body> as its focus-restore target and dumps a keyboard
  // user at the top of the page on close. Move focus to the ⋯ trigger FIRST
  // (synchronously, before the modal mounts and snapshots activeElement),
  // mirroring the Escape-close branch, so focus returns to the row on close.
  const runItem = (fn) => { setOpen(false); triggerRef.current?.focus(); fn(); };
  return (
    <span ref={rootRef} style={{ position: "relative", flexShrink: 0, marginRight: 4 }}>
      {/* FE-5: aria-haspopup="true" (generic "opens a popup"), NOT "menu" — this
          is a disclosure without APG menu keyboard semantics (roving focus /
          Arrow / Home / End / focus-trap), so it doesn't claim the "menu" it
          never implemented. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More options for ${name}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ background: "transparent", border: "none", color: t.textMuted, fontSize: 18, cursor: "pointer", padding: "4px 8px", borderRadius: 8, minHeight: 44, minWidth: 44, ...f.style }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        ⋯
      </button>
      {/* FE-5: an honest disclosure — role="group" (a labelled cluster of plain
          buttons), NOT role="menu". We don't ship APG menu keyboard semantics,
          so we don't claim them. Escape + click-outside close and focus-return-
          to-trigger (FE-2, via runItem) are preserved below. */}
      {open && (
        <div role="group" aria-label={`Options for ${name}`} style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: t.surface, border: `1px solid ${t.cardBorder}`, borderRadius: 12, boxShadow: t.shadow.md, zIndex: 300, minWidth: 200, overflow: "hidden" }}>
          <button type="button" style={{ ...itemStyle, color: t.text }} onClick={() => runItem(() => onViewProfile(row.otherUser?.userId))}>
            View profile
          </button>
          <button type="button" style={{ ...itemStyle, color: t.text, ...(onArchive && row.conversationId && row.started ? {} : { borderBottom: `1px solid ${t.borderLight}`, paddingBottom: 14 }) }} onClick={() => runItem(() => onNote(row))}>
            {note ? "Edit private note" : "Add private note"}
          </button>
          {onArchive && row.conversationId && row.started && (
            <button type="button" style={{ ...itemStyle, color: t.textSoft, borderBottom: `1px solid ${t.borderLight}`, paddingBottom: 14 }} onClick={() => runItem(() => onArchive(row.conversationId))}>
              Archive conversation
            </button>
          )}
          <button type="button" style={{ ...itemStyle, color: t.danger, paddingTop: 14 }} onClick={() => runItem(() => onReport(row))}>
            Block or report
          </button>
          <button type="button" style={{ ...itemStyle, color: t.textSoft }} onClick={() => runItem(() => onUnmatch(row))}>
            Unmatch
          </button>
        </div>
      )}
    </span>
  );
}

function SectionList({ title, subtitle, matches, onSelectConversation, selectedConversationId, onStartConversation, startingMatchId, rowMenuProps }) {
  if (matches.length === 0) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 0 8px 16px", paddingRight: 4 }}>
        <h2 style={{
          fontSize: 14,
          fontWeight: 600,
          color: t.textSoft,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: 0,
        }}>
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: 13, color: t.textMuted, fontWeight: 500 }}>{subtitle}</span>
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
          // FE-3: no overflow:hidden here — it clipped the per-row ⋯ popover
          // (z-index can't escape an overflow clip). Rows round their own
          // corners instead (see MatchRow first/last), preserving the look.
        }}
      >
        {matches.map((m, i) => (
          <MatchRow
            key={m.conversationId || m.matchId}
            match={m}
            first={i === 0}
            last={i === matches.length - 1}
            onSelectConversation={onSelectConversation}
            selected={selectedConversationId != null && m.conversationId === selectedConversationId}
            onStartConversation={onStartConversation}
            startingMatchId={startingMatchId}
            rowMenuProps={rowMenuProps}
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
  statusAction,
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
  // ── Merged surface (Phase 1) ──
  likedYou = null,
  pendingMatches = [],
  onStartConversation,
  startingMatchId = null,
  matchNotes = {},
  onRowViewProfile,
  onRowReport,
  onRowUnmatch,
  onRowNote,
}) {
  const headingRef = useRef(null);
  // ALL hooks declared here — before any early return (including the archived
  // view path below) so the hook order is always stable.
  const [query, setQuery] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  // One-time note explaining the Matches/Messages merge (predictability for an
  // IA change). Dismissal persists forever.
  const [mergeNoteDismissed, setMergeNoteDismissed] = useState(() => {
    try { return localStorage.getItem("spectrum_merge_note_dismissed") === "1"; } catch { return true; }
  });
  const dismissMergeNote = () => {
    setMergeNoteDismissed(true);
    try { localStorage.setItem("spectrum_merge_note_dismissed", "1"); } catch { /* ignore */ }
  };

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
              fontSize: 16,
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
                  // FE-3: rows self-round (see MatchRow first/last); no
                  // overflow:hidden so the list stays consistent with the
                  // active list and never clips row-level popovers.
                }}
              >
                {archivedConversations.map((m, i) => (
                  <MatchRow
                    key={m.conversationId || m.matchId}
                    match={m}
                    first={i === 0}
                    last={i === archivedConversations.length - 1}
                    onSelectConversation={onSelectConversation}
                    showUnarchive
                    onUnarchive={onUnarchive}
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
  // New matches = conversations nobody has messaged in yet PLUS matches that
  // don't have a conversation row at all (tap creates + opens in place).
  const pendingRows = pendingMatches.map((pm) => ({
    conversationId: null,
    matchId: pm.matchId,
    otherUser: pm.otherUser,
    started: false,
    unread: false,
    ended: false,
    lastMessageLabel: null,
    needsConversation: true,
  }));
  const newMatches = [...conversations.filter((m) => !m.started), ...pendingRows];
  const rowMenuProps = onRowReport
    ? { matchNotes, onViewProfile: onRowViewProfile, onNote: onRowNote, onArchive, onReport: onRowReport, onUnmatch: onRowUnmatch }
    : null;
  const capReached = active.length >= activeCap;

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

      {/* Visible, persistent status strip — archive/restore feedback with a
          no-time-pressure Undo (calm alternative to a timed snackbar). */}
      {statusMessage && (
        <div
          style={{
            maxWidth: t.layout.maxContent,
            margin: "12px auto 0",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: t.surfaceAlt,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 12,
            fontSize: 14,
            color: t.textSoft,
            boxSizing: "border-box",
            width: "calc(100% - 32px)",
          }}
        >
          <span style={{ minWidth: 0 }}>{statusMessage}</span>
          {statusAction && (
            <button
              type="button"
              onClick={statusAction.onAction}
              style={{
                background: "transparent",
                border: `1px solid ${t.accentStrong}`,
                borderRadius: 999,
                color: t.accentStrong,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                padding: "6px 16px",
                // FE-7 — ≥44px touch target (was 40).
                minHeight: 44,
                flexShrink: 0,
                fontFamily: t.sans,
              }}
            >
              {statusAction.label}
            </button>
          )}
        </div>
      )}

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

        {/* Search / filter input — with a hard cap of {activeCap} active
            conversations the list rarely needs one; only render once the list
            is genuinely long enough that scanning by eye stops working. */}
        {active.length + newMatches.length > 7 && (
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="conversation-filter"
              style={{
                display: "block",
                fontSize: 14,
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
                    // FE-7 — ≥44px hit area in BOTH axes (minWidth was missing).
                    minHeight: 44,
                    minWidth: 44,
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
            {!mergeNoteDismissed && (
              <div
                role="note"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 16,
                  padding: "12px 16px",
                  background: t.green50,
                  border: `1px solid ${t.borderLight}`,
                  borderRadius: 12,
                  fontSize: 14,
                  color: t.textSoft,
                  lineHeight: 1.55,
                }}
              >
                <span>
                  {plainLanguage
                    ? "Everything is in one place now. Your matches and messages are both here. New likes are in the Likes tab."
                    : "One place now: your matches and conversations both live here. People who liked you are in the Likes tab."}
                </span>
                <button
                  type="button"
                  onClick={dismissMergeNote}
                  aria-label="Dismiss this note"
                  style={{ background: "transparent", border: "none", color: t.textSoft, fontSize: 16, cursor: "pointer", padding: "2px 6px", minHeight: 44, minWidth: 44, flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Liked-you inbox — act in place (merged from the Matches tab). */}
            {likedYou}

            <SectionList
              title="Active conversations"
              matches={active}
              onSelectConversation={onSelectConversation}
              selectedConversationId={selectedConversationId}
              rowMenuProps={rowMenuProps}
            />

            {/* Feature 3 — conversation-cap context. Static explanation (not a
                live status), shown only when there's actually someone new to
                start with — otherwise it's pure noise. */}
            {capReached && (newMatches.length > 0 || likedYou) && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "12px 16px",
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  borderRadius: 12,
                  color: t.textSoft,
                  fontSize: 16,
                  lineHeight: 1.5,
                }}
              >
                {plainLanguage
                  ? "Your active list is full. That's the calm limit, not a problem. To start a new conversation, archive one first (open ⋯ on a row). Archived chats are never deleted."
                  : "Your active list is full — that's the calm limit, not a problem. If you'd like to start a new conversation, you can archive one first from a row's ⋯ menu. Archived chats are never deleted and can be restored anytime."}
              </div>
            )}

            <SectionList
              title="New matches"
              matches={newMatches}
              onSelectConversation={onSelectConversation}
              selectedConversationId={selectedConversationId}
              onStartConversation={onStartConversation}
              startingMatchId={startingMatchId}
              rowMenuProps={rowMenuProps}
            />

            {conversations.length === 0 && pendingRows.length === 0 && (
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
