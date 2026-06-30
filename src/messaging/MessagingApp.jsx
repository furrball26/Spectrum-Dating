import { useState, useEffect, useRef } from "react";
import MatchesListScreen from "./MatchesListScreen.jsx";
import ConversationScreen from "./ConversationScreen.jsx";
import UnmatchSheet from "./UnmatchSheet.jsx";
import BlockReportScreen from "./BlockReportScreen.jsx";
import { getConversations, archiveConversation, blockUser, reportUser, getUserId, markConversationRead, unmatchConversation } from "../api.js";
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

  useEffect(() => {
    setLoadingConvs(true);
    setConvsLoadFailed(false);
    getConversations()
      .then(data => {
        // Server returns { conversations: [...], activeCap, activeCount, capReached }
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : []);
        setConversations(arr);
        if (onUnreadCount) {
          onUnreadCount(arr.filter(c => c.hasUnread).length);
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

  const currentConvo = conversations.find(c => c.id === selectedConversationId) || null;

  function handleSelectConversation(conversationId) {
    setSelectedConversationId(conversationId);
    setScreen("conversation");
    markConversationRead(conversationId).catch(() => {});
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
    } catch {}
    setConversations(prev => prev.filter(c => c.id !== selectedConversationId));
    setMatchesStatusMessage(`You unmatched with ${name}.`);
    handleBackToList();
  }

  function handleUnmatchCancel() {
    setShowUnmatchSheet(false);
  }

  function handleBlockReport() {
    setScreen("block-report");
  }

  async function handleBlockReportSubmit({ reason, details }) {
    const name = currentConvo?.otherUser?.displayName || "this person";
    const otherUserId = currentConvo.otherUser.userId;
    try {
      await blockUser(otherUserId, reason, details);
    } catch {}
    // Also surface the report to moderators (best-effort, independent of block)
    try {
      await reportUser(otherUserId, reason, details, currentConvo.id);
    } catch {}
    setConversations(prev => prev.filter(c => c.id !== selectedConversationId));
    setMatchesStatusMessage(`You blocked and reported ${name}.`);
    handleBackToList();
  }

  async function handleArchive(conversationId) {
    try { await archiveConversation(conversationId); } catch {}
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
      selectedConversationId={isDesktop ? selectedConversationId : null}
      plainLanguage={plainLanguage}
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
