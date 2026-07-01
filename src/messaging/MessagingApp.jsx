import { useState, useEffect, useRef } from "react";
import MatchesListScreen from "./MatchesListScreen.jsx";
import ConversationScreen from "./ConversationScreen.jsx";
import UnmatchSheet from "./UnmatchSheet.jsx";
import BlockReportScreen from "./BlockReportScreen.jsx";
import { getConversations, archiveConversation, unarchiveConversation, getArchivedConversations, blockUser, reportUser, getUserId, markConversationRead, unmatchConversation } from "../api.js";
import { t } from "../tokens.js";
import { useViewport } from "../useViewport.js";

export default function MessagingApp({ onUnreadCount, initialConversationId, plainLanguage = false }) {
  const viewport = useViewport(); // "mobile" | "tablet" | "desktop"
  const isDesktop = viewport === "desktop";
  // state: 'list' | 'conversation' | 'block-report'
  const [screen, setScreen] = useState("list");
  const [selectedConversationId, setSelectedConversationId] = useState(null);
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

  useEffect(() => {
    setLoadingConvs(true);
    setConvsLoadFailed(false);
    getConversations()
      .then(({ conversations: arr, archivedCount: count, activeCap: cap }) => {
        setConversations(arr);
        setArchivedCount(count);
        if (cap != null) setActiveCap(cap);
        if (onUnreadCount) {
          onUnreadCount(arr.filter(c => c.unread).length);
        }
      })
      .catch(() => setConvsLoadFailed(true))
      .finally(() => setLoadingConvs(false));
  }, [refreshKey]);

  const retryLoadConversations = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    if (screen === "list") {
      setRefreshKey(k => k + 1);
      if (onUnreadCount) onUnreadCount(0);
    }
  }, [screen]);

  // Auto-open a conversation when arriving from the Matches tab. Fires once,
  // after the conversation appears in the loaded list.
  const openedInitialRef = useRef(false);
  useEffect(() => {
    if (
      !openedInitialRef.current &&
      initialConversationId &&
      conversations.some(c => c.id === initialConversationId)
    ) {
      openedInitialRef.current = true;
      handleSelectConversation(initialConversationId);
    }
  }, [initialConversationId, conversations]);

  // Look up the selected conversation in both the active and archived lists so
  // a user can open and read an archived thread after navigating to it.
  const currentConvo =
    conversations.find(c => c.id === selectedConversationId) ||
    archivedConversations.find(c => c.id === selectedConversationId) ||
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
    markConversationRead(conversationId).catch((e) => console.warn("Mark-read failed", e));
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

  async function handleArchive(conversationId) {
    try { await archiveConversation(conversationId); } catch (e) { console.warn("Archive failed", e); }
    setConversations(prev => prev.filter(c => c.id !== conversationId));
  }

  function handleBlockReportBack() {
    setScreen("conversation");
  }

  const listPane = (
    <MatchesListScreen
      conversations={conversations}
      loading={loadingConvs}
      loadFailed={convsLoadFailed}
      onRetry={retryLoadConversations}
      onSelectConversation={handleSelectConversation}
      statusMessage={matchesStatusMessage}
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
    </div>
  );
}
