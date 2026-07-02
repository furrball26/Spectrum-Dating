import { useState, useEffect, useRef, lazy, Suspense } from "react";
import MatchesListScreen from "./MatchesListScreen.jsx";
import UnmatchSheet from "./UnmatchSheet.jsx";
import BlockReportScreen from "./BlockReportScreen.jsx";
import { getConversations, archiveConversation, unarchiveConversation, getArchivedConversations, blockUser, reportUser, getUserId, markConversationRead, unmatchConversation, getActivity, getMatches, createConversation, swipe, saveMatchNote, safeErrorMessage } from "../api.js";
import LikedYouSection from "../LikedYouSection.jsx";
import MatchMoment from "../MatchMoment.jsx";
import ReportModal from "../ReportModal.jsx";
import MatchProfileModal from "../MatchProfileModal.jsx";
import { getViewerIdentity } from "../viewerIdentity.js";
import { t } from "../tokens.js";
import { useViewport } from "../useViewport.js";
import Skeleton from "../Skeleton.jsx";

// ConversationScreen is lazy-loaded so its (heavy) subtree AND its statically
// imported socket.io-client ship in a separate chunk, keeping both off the main
// (logged-out) bundle. MessagingApp keeps all conversation-list state; only this
// leaf loads on first thread-open, so no list/selection state is lost.
const ConversationScreen = lazy(() => import("./ConversationScreen.jsx"));

// Calm fallback while the ConversationScreen chunk loads (respects
// prefers-reduced-motion via the shared Skeleton — static tint, no shimmer).
function ConversationFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "20px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <Skeleton width="55%" height={22} radius={8} />
      <Skeleton width="80%" height={48} radius={14} />
      <Skeleton width="65%" height={48} radius={14} />
      <Skeleton width="72%" height={48} radius={14} />
    </div>
  );
}

// Small private-note editor sheet (F13 survives the merge — notes were only
// editable on the retiring Matches tab). Owner-only; saved via saveMatchNote.
function NoteSheet({ row, initialNote, onSaved, onClose }) {
  const [value, setValue] = useState(initialNote || "");
  const [saving, setSaving] = useState(false);
  return (
    <>
      <div aria-hidden="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(36,51,45,0.35)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Private note about ${row.otherUser?.displayName || "this person"}`}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: t.surface, borderRadius: 20, padding: "24px 20px", width: "min(90vw, 400px)", zIndex: 1101, boxShadow: t.shadow.lg, boxSizing: "border-box", fontFamily: t.sans }}
      >
        <h2 style={{ fontFamily: t.serif, fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: t.text }}>
          Private note
        </h2>
        <p style={{ fontSize: 13, color: t.textMuted, margin: "0 0 12px" }}>Only you can see this.</p>
        <textarea
          value={value}
          maxLength={500}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="e.g. met at the book club; dislikes loud bars"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: t.sans, fontSize: 16, color: t.text, background: t.surface, border: `1px solid ${t.formBorder}`, borderRadius: 10, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={{ minHeight: 44, padding: "8px 16px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: t.sans }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const res = await saveMatchNote(row.matchId, value.trim());
                onSaved(row.matchId, typeof res?.note === "string" ? res.note : value.trim());
              } catch { /* keep text; user can retry */ }
              setSaving(false);
              onClose();
            }}
            style={{ minHeight: 44, padding: "8px 18px", borderRadius: 10, border: "none", background: t.accentFill, color: "#fff", fontSize: 15, fontWeight: 600, cursor: saving ? "wait" : "pointer", fontFamily: t.sans }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

// `initialConversation` (preferred) is a seed object {id, otherUser, started}
// passed straight from the tapping surface, so the thread opens INSTANTLY on
// mount — no waiting for the conversations list to download just to re-derive
// data the caller already had. `initialConversationId` remains as the id-only
// legacy path. `onConsumedInitial` lets App clear the pending deep-link so a
// later visit to Messages doesn't re-open the same thread (stale-pending bug).
export default function MessagingApp({ onUnreadCount, onActivityCount, initialConversation, initialConversationId, onConsumedInitial, plainLanguage = false }) {
  const viewport = useViewport(); // "mobile" | "tablet" | "desktop"
  const isDesktop = viewport === "desktop";
  // Seed usable only when it carries enough to render a thread header.
  const seed = initialConversation && initialConversation.id && initialConversation.otherUser
    ? { started: false, ...initialConversation }
    : null;
  // state: 'list' | 'conversation' | 'block-report' — seeded opens start
  // directly on the conversation (no list flash, no wait).
  const [screen, setScreen] = useState(seed ? "conversation" : "list");
  const [selectedConversationId, setSelectedConversationId] = useState(seed ? seed.id : null);
  const [showUnmatchSheet, setShowUnmatchSheet] = useState(false);
  const [matchesStatusMessage, setMatchesStatusMessage] = useState("");
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [convsLoadFailed, setConvsLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // ─── Archived view ───────────────────────────────────────────────────────────
  const [showingArchived, setShowingArchived] = useState(false);
  const [archivedConversations, setArchivedConversations] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  // Server-authoritative active-conversation cap (default 5 until first load).
  const [activeCap, setActiveCap] = useState(5);
  // E13: the in-flight markConversationRead PUT. The list re-fetch awaits this
  // so the read state has committed server-side before we GET — otherwise the
  // unread badge can flicker back on when the refresh out-races the write.
  const pendingReadRef = useRef(null);

  // ── Merged surface (Phase 1): likes + conversation-less matches live HERE ──
  // Incoming likes (one-sided) — act in place, same as the old Matches tab.
  const [incomingLikes, setIncomingLikes] = useState([]);
  const [likerBusyId, setLikerBusyId] = useState(null);
  const [matchMoment, setMatchMoment] = useState(null);
  const [reportingLiker, setReportingLiker] = useState(null);
  // Matches that don't have a conversation row yet (join source for notes too).
  const [pendingMatches, setPendingMatches] = useState([]);
  const [matchNotes, setMatchNotes] = useState({}); // matchId -> note
  // Seed for a conversation created in place (before the list refetch knows it).
  const [localSeed, setLocalSeed] = useState(null);
  // Row-level safety actions (⋯ menu on every person).
  const [reportingRow, setReportingRow] = useState(null);   // {matchId, conversationId, otherUser}
  const [unmatchingRow, setUnmatchingRow] = useState(null); // same shape
  const [viewingUserId, setViewingUserId] = useState(null);
  const [noteRow, setNoteRow] = useState(null);             // {matchId, otherUser}

  // Warm the (lazy) ConversationScreen chunk as soon as Messages mounts, so
  // the first thread-open doesn't pay a JS download mid-gesture.
  useEffect(() => { import("./ConversationScreen.jsx"); }, []);

  // Consume the deep-link once; App clears it so revisiting Messages later
  // shows the list instead of silently re-opening the last thread.
  useEffect(() => {
    if ((seed || initialConversationId) && onConsumedInitial) onConsumedInitial();
    // A seeded open still marks the thread read (same as a list tap).
    if (seed) {
      pendingReadRef.current = markConversationRead(seed.id)
        .catch((e) => console.warn("Mark-read failed", e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingConvs(true);
    setConvsLoadFailed(false);
    // Sequence after any in-flight mark-read so the refetch reflects it.
    Promise.resolve(pendingReadRef.current)
      .catch(() => {}) // a failed mark-read must not block the list load
      .then(() => getConversations())
      .then(({ conversations: arr, archivedCount: count, activeCap: cap }) => {
        if (cancelled) return;
        setConversations(arr);
        setArchivedCount(count);
        if (cap != null) setActiveCap(cap);
        if (onUnreadCount) {
          onUnreadCount(arr.filter(c => c.unread).length);
        }
      })
      .catch(() => { if (!cancelled) setConvsLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoadingConvs(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const retryLoadConversations = () => setRefreshKey(k => k + 1);

  // Likes + matches (for conversation-less matches and private notes). Runs on
  // the same refresh cadence as the conversations list; failures are non-fatal.
  useEffect(() => {
    let cancelled = false;
    getActivity()
      .then(({ incomingLikes: likes }) => {
        if (cancelled) return;
        setIncomingLikes(likes);
        if (onActivityCount) onActivityCount(likes.length);
      })
      .catch(() => {});
    getMatches()
      .then((arr) => {
        if (cancelled) return;
        setPendingMatches(arr.filter(m => !m.hasConversation || !m.conversationId));
        const notes = {};
        arr.forEach(m => { if (m.note) notes[m.matchId] = m.note; });
        setMatchNotes(notes);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Drop a liker locally and keep the likes badge in sync.
  const removeLiker = (userId) => {
    setIncomingLikes(prev => {
      const next = prev.filter(p => p.userId !== userId);
      if (onActivityCount) onActivityCount(next.length);
      return next;
    });
  };

  // "I'm interested" on a liker — they already liked us, so this completes the
  // mutual match; celebrate, then open the new thread IN PLACE.
  async function handleLikeBack(person) {
    if (likerBusyId) return;
    setLikerBusyId(person.userId);
    try {
      const result = await swipe(person.userId, "like");
      if (result && result.matched) {
        setMatchMoment({
          them: { name: person.displayName, userId: person.userId, photoUrl: person.photoUrl },
          matchId: result.matchId || null,
        });
      } else {
        setMatchesStatusMessage(`${person.displayName || "They"} isn't available anymore.`);
      }
      removeLiker(person.userId);
    } catch (e) {
      setMatchesStatusMessage(safeErrorMessage(e, "Couldn't save that just now. Please try again."));
    } finally {
      setLikerBusyId(null);
    }
  }

  async function handleDismissLiker(person) {
    if (likerBusyId) return;
    setLikerBusyId(person.userId);
    try { await swipe(person.userId, "skip"); } catch (e) { console.warn("Dismiss liker failed", e); }
    removeLiker(person.userId);
    setLikerBusyId(null);
  }

  // Open a thread in place with a seed (created-just-now or pending match).
  function openInPlace(conversationId, otherUser, started) {
    setLocalSeed({ id: conversationId, otherUser, started: !!started });
    setSelectedConversationId(conversationId);
    setScreen("conversation");
    pendingReadRef.current = markConversationRead(conversationId)
      .catch((e) => console.warn("Mark-read failed", e));
  }

  // Tap on a match that has no conversation yet: create it, open in place.
  const [startingMatchId, setStartingMatchId] = useState(null);
  async function handleStartConversation(match) {
    if (startingMatchId) return;
    setStartingMatchId(match.matchId);
    try {
      const res = await createConversation(match.matchId);
      const convId = res?.conversation?.id || res?.conversationId || res?.id;
      if (convId) {
        setPendingMatches(prev => prev.filter(m => m.matchId !== match.matchId));
        openInPlace(convId, match.otherUser, false);
        setRefreshKey(k => k + 1);
      }
    } catch (e) {
      const existingId = e?.status === 409 && e?.body?.conversationId;
      if (existingId) {
        openInPlace(existingId, match.otherUser, true);
      } else {
        setMatchesStatusMessage(
          e?.code === "CAP_REACHED"
            ? "You've reached your active conversations for now. Archive one below to start a new one."
            : safeErrorMessage(e, "Couldn't start the conversation. Please try again.")
        );
      }
    } finally {
      setStartingMatchId(null);
    }
  }

  // Row ⋯ safety actions.
  async function handleRowUnmatchConfirm() {
    const row = unmatchingRow;
    setUnmatchingRow(null);
    if (!row) return;
    try {
      if (row.matchId) await unmatchConversation(row.matchId);
      else if (row.conversationId) await archiveConversation(row.conversationId);
    } catch (e) { console.warn("Unmatch failed", e); }
    if (row.conversationId) setConversations(prev => prev.filter(c => c.id !== row.conversationId));
    setPendingMatches(prev => prev.filter(m => m.matchId !== row.matchId));
    setMatchesStatusMessage(`You unmatched ${row.otherUser?.displayName || "this person"}.`);
  }

  // Refresh the list when RETURNING to it — skip the mount run (the
  // [refreshKey] effect above already fetches on mount; the old version
  // double-fetched getConversations on every mount).
  const firstListRunRef = useRef(true);
  useEffect(() => {
    if (firstListRunRef.current) { firstListRunRef.current = false; return; }
    if (screen === "list") {
      setRefreshKey(k => k + 1);
      if (onUnreadCount) onUnreadCount(0);
    }
  }, [screen]);

  // Legacy id-only deep-link: auto-open once the conversation appears in the
  // loaded list. (Seeded opens above never wait for this.) If the list has
  // loaded and the id ISN'T there, say so calmly instead of silently doing
  // nothing — the old behavior was an unexplained dead-end.
  const openedInitialRef = useRef(!!seed);
  useEffect(() => {
    if (openedInitialRef.current || !initialConversationId) return;
    if (conversations.some(c => c.id === initialConversationId)) {
      openedInitialRef.current = true;
      handleSelectConversation(initialConversationId);
    } else if (!loadingConvs) {
      openedInitialRef.current = true;
      setMatchesStatusMessage("We couldn't open that conversation — it may have been archived.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, conversations, loadingConvs]);

  // Look up the selected conversation in both the active and archived lists so
  // a user can open and read an archived thread after navigating to it.
  const currentConvo =
    conversations.find(c => c.id === selectedConversationId) ||
    archivedConversations.find(c => c.id === selectedConversationId) ||
    (seed && seed.id === selectedConversationId ? seed : null) ||
    (localSeed && localSeed.id === selectedConversationId ? localSeed : null) ||
    null;

  function handleToggleArchived() {
    if (!showingArchived) {
      // Load archived conversations on first open (and every subsequent open so
      // the list stays fresh after unarchiving).
      setArchivedLoading(true);
      getArchivedConversations()
        .then(arr => setArchivedConversations(arr))
        .catch((e) => console.warn("Load archived failed", e)) // non-fatal — show empty state
        .finally(() => setArchivedLoading(false));
    }
    setShowingArchived(prev => !prev);
  }

  async function handleUnarchive(conversationId) {
    try { await unarchiveConversation(conversationId); } catch (e) { console.warn("Unarchive failed", e); }
    // Remove from the archived list immediately
    setArchivedConversations(prev => prev.filter(c => c.id !== conversationId));
    setArchivedCount(prev => Math.max(0, prev - 1));
    // Refresh the active list so the restored conversation appears
    setRefreshKey(k => k + 1);
  }

  function handleSelectConversation(conversationId) {
    setSelectedConversationId(conversationId);
    setScreen("conversation");
    // Optimistically clear unread locally so the badge doesn't linger, and hold
    // the PUT promise so the next list refresh (on "back") awaits it (E13).
    setConversations(prev =>
      prev.map(c => (c.id === conversationId && c.unread ? { ...c, unread: false } : c))
    );
    pendingReadRef.current = markConversationRead(conversationId)
      .catch((e) => console.warn("Mark-read failed", e));
  }

  function handleBackToList() {
    setScreen("list");
    setSelectedConversationId(null);
    setShowUnmatchSheet(false);
  }

  function handleUnmatch() {
    setShowUnmatchSheet(true);
  }

  async function handleUnmatchConfirm() {
    const name = currentConvo?.otherUser?.displayName || "this person";
    const matchId = currentConvo?.matchId;
    setShowUnmatchSheet(false);
    try {
      // True unmatch: removes the match + conversation server-side. Falls back
      // to archiving if matchId is somehow missing.
      if (matchId) await unmatchConversation(matchId);
      else await archiveConversation(selectedConversationId);
    } catch (e) { console.warn("Unmatch failed", e); }
    setConversations(prev => prev.filter(c => c.id !== selectedConversationId));
    setMatchesStatusMessage(`You ended your conversation with ${name}.`);
    handleBackToList();
  }

  function handleUnmatchCancel() {
    setShowUnmatchSheet(false);
  }

  function handleBlockReport() {
    setScreen("block-report");
  }

  // Block and report are independent. The caller passes which actions were
  // chosen ({ doBlock, doReport }); we only perform (and only confirm) the ones
  // requested. E27 is preserved: we never claim a block landed unless it did.
  async function handleBlockReportSubmit({ reason, details, doBlock, doReport }) {
    const name = currentConvo?.otherUser?.displayName || "this person";
    // Optional-chain the id — the async handler can fire after currentConvo nulls.
    const otherUserId = currentConvo?.otherUser?.userId;
    const convId = selectedConversationId;
    if (!otherUserId) {
      // Nothing to act on — signal failure so the screen keeps them informed.
      return { blocked: false, reported: false };
    }
    let blocked = false;
    if (doBlock) {
      try {
        await blockUser(otherUserId, reason, details);
        blocked = true;
      } catch (e) {
        console.warn("Block failed", e);
      }
    }
    let reported = false;
    if (doReport) {
      try {
        await reportUser(otherUserId, reason, details, convId);
        reported = true;
      } catch (e) {
        console.warn("Report failed", e);
      }
    }
    if (blocked) {
      // Client-side fallback: once blocked, drop the conversation from the list
      // so the user isn't confronted with it again this session.
      setConversations(prev => prev.filter(c => c.id !== convId));
      setMatchesStatusMessage(
        reported ? `You blocked and reported ${name}.` : `You blocked ${name}.`
      );
      handleBackToList();
    }
    // If only reporting (no block), the screen shows its own calm confirmation
    // and the conversation stays. On block failure, stay so it can retry.
    return { blocked, reported };
  }

  // Archive with a calm, persistent Undo — a one-tap silent removal is how
  // "my match disappeared" happens for an accidental-tap-prone audience.
  const [lastArchived, setLastArchived] = useState(null); // {id, name}
  async function handleArchive(conversationId) {
    const conv = conversations.find(c => c.id === conversationId);
    const name = conv?.otherUser?.displayName || "this person";
    try { await archiveConversation(conversationId); } catch (e) { console.warn("Archive failed", e); }
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    setArchivedCount(prev => prev + 1);
    setLastArchived({ id: conversationId, name });
    setMatchesStatusMessage(`Conversation with ${name} archived.`);
    if (screen !== "list") handleBackToList();
  }
  async function handleUndoArchive() {
    const la = lastArchived;
    setLastArchived(null);
    if (!la) return;
    await handleUnarchive(la.id);
    setMatchesStatusMessage(`Conversation with ${la.name} restored.`);
  }

  function handleBlockReportBack() {
    setScreen("conversation");
  }

  const likedYouPane = (
    <LikedYouSection
      people={incomingLikes}
      plainLanguage={plainLanguage}
      busyId={likerBusyId}
      onInterested={handleLikeBack}
      onNotNow={handleDismissLiker}
      onReport={setReportingLiker}
    />
  );

  const listPane = (
    <MatchesListScreen
      conversations={conversations}
      likedYou={likedYouPane}
      pendingMatches={pendingMatches}
      onStartConversation={handleStartConversation}
      startingMatchId={startingMatchId}
      matchNotes={matchNotes}
      onRowViewProfile={setViewingUserId}
      onRowReport={setReportingRow}
      onRowUnmatch={setUnmatchingRow}
      onRowNote={setNoteRow}
      loading={loadingConvs}
      loadFailed={convsLoadFailed}
      onRetry={retryLoadConversations}
      onSelectConversation={handleSelectConversation}
      statusMessage={matchesStatusMessage}
      statusAction={lastArchived ? { label: "Undo", onAction: handleUndoArchive } : null}
      onArchive={handleArchive}
      conversationCount={conversations.filter(c => c.started).length}
      activeCap={activeCap}
      selectedConversationId={isDesktop ? selectedConversationId : null}
      plainLanguage={plainLanguage}
      showingArchived={showingArchived}
      archivedConversations={archivedConversations}
      archivedLoading={archivedLoading}
      archivedCount={archivedCount}
      onToggleArchived={handleToggleArchived}
      onUnarchive={handleUnarchive}
    />
  );

  const conversationPane = currentConvo && (
    <>
      <Suspense fallback={<ConversationFallback />}>
        <ConversationScreen
          conversationId={currentConvo.id}
          otherUser={currentConvo.otherUser}
          started={currentConvo.started}
          onBack={handleBackToList}
          onUnmatch={handleUnmatch}
          onBlockReport={handleBlockReport}
          currentUserId={getUserId() || "me"}
          onArchive={handleArchive}
          hideBack={isDesktop}
          plainLanguage={plainLanguage}
        />
      </Suspense>
      {showUnmatchSheet && (
        <UnmatchSheet
          displayName={currentConvo.otherUser.displayName}
          onConfirm={handleUnmatchConfirm}
          onCancel={handleUnmatchCancel}
        />
      )}
    </>
  );

  const blockReportPane = currentConvo && (
    <BlockReportScreen
      displayName={currentConvo.otherUser.displayName}
      onSubmit={handleBlockReportSubmit}
      onBack={handleBlockReportBack}
    />
  );

  // Overlays shared by both layouts (match moment, safety modals, note editor).
  const overlays = (
    <>
      {matchMoment && (
        <MatchMoment
          you={getViewerIdentity()}
          them={matchMoment.them}
          plainLanguage={plainLanguage}
          onOpenChat={async () => {
            const mm = matchMoment;
            setMatchMoment(null);
            if (mm.matchId) {
              try {
                const conv = await createConversation(mm.matchId);
                const convId = conv?.conversation?.id || conv?.conversationId || conv?.id;
                if (convId) {
                  openInPlace(convId, { userId: mm.them.userId, displayName: mm.them.name, photoUrl: mm.them.photoUrl }, false);
                  setRefreshKey(k => k + 1);
                  return;
                }
              } catch (e) {
                const convId = e?.status === 409 && e?.body?.conversationId;
                if (convId) {
                  openInPlace(convId, { userId: mm.them.userId, displayName: mm.them.name, photoUrl: mm.them.photoUrl }, true);
                  return;
                }
              }
            }
            setRefreshKey(k => k + 1);
          }}
          onContinue={() => { setMatchMoment(null); setRefreshKey(k => k + 1); }}
        />
      )}
      {reportingLiker && (
        <ReportModal
          candidate={{ memberId: reportingLiker.userId, displayName: reportingLiker.displayName }}
          onClose={() => setReportingLiker(null)}
          onBlocked={(c) => removeLiker(c.memberId)}
        />
      )}
      {reportingRow && (
        <ReportModal
          candidate={{ memberId: reportingRow.otherUser?.userId, displayName: reportingRow.otherUser?.displayName }}
          onClose={() => setReportingRow(null)}
          onBlocked={() => {
            if (reportingRow.conversationId) setConversations(prev => prev.filter(c => c.id !== reportingRow.conversationId));
            setPendingMatches(prev => prev.filter(m => m.matchId !== reportingRow.matchId));
            setMatchesStatusMessage(`You blocked ${reportingRow.otherUser?.displayName || "this person"}.`);
          }}
        />
      )}
      {unmatchingRow && (
        <UnmatchSheet
          displayName={unmatchingRow.otherUser?.displayName || "this person"}
          onConfirm={handleRowUnmatchConfirm}
          onCancel={() => setUnmatchingRow(null)}
        />
      )}
      {viewingUserId && (
        <MatchProfileModal userId={viewingUserId} onClose={() => setViewingUserId(null)} />
      )}
      {noteRow && (
        <NoteSheet
          row={noteRow}
          initialNote={matchNotes[noteRow.matchId] || ""}
          onSaved={(matchId, note) => setMatchNotes(prev => ({ ...prev, [matchId]: note }))}
          onClose={() => setNoteRow(null)}
        />
      )}
    </>
  );

  // ── Desktop: two-pane (list + open thread side-by-side) ──
  // List stays visible while a thread is open. Capped + centered so it reads as
  // a calm app panel, not an edge-to-edge inbox. Mobile/tablet keep the existing
  // stack-swap below (list → conversation), unchanged.
  if (isDesktop) {
    const rightPane =
      screen === "block-report"
        ? blockReportPane
        : screen === "conversation" && currentConvo
        ? conversationPane
        : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "32px",
              textAlign: "center",
              color: t.textMuted,
              fontSize: 15,
            }}
          >
            {plainLanguage ? "Click a conversation to open it." : "Select a conversation to start reading."}
          </div>
        );
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "row",
          minHeight: 0,
        }}
      >
        <div
          style={{
            width: 340,
            flexShrink: 0,
            height: "100%",
            overflowY: "auto",
            borderRight: `1px solid ${t.border}`,
          }}
        >
          {listPane}
        </div>
        <div style={{ flex: 1, minWidth: 0, height: "100%", position: "relative" }}>
          {rightPane}
        </div>
        {overlays}
      </div>
    );
  }

  // ── Mobile / tablet: single-column stack-swap (unchanged) ──
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {screen === "list" && listPane}

      {screen === "conversation" && currentConvo && conversationPane}

      {screen === "block-report" && currentConvo && blockReportPane}
      {overlays}
    </div>
  );
}
