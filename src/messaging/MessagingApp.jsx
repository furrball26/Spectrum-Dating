import { useState, useEffect, useRef } from "react";
import MatchesListScreen from "./MatchesListScreen.jsx";
import ConversationScreen from "./ConversationScreen.jsx";
import UnmatchSheet from "./UnmatchSheet.jsx";
import BlockReportScreen from "./BlockReportScreen.jsx";
import { getConversations, archiveConversation, blockUser, reportUser, getUserId, markConversationRead } from "../api.js";

export default function MessagingApp({ onUnreadCount, initialConversationId }) {
  // state: 'list' | 'conversation' | 'block-report'
  const [screen, setScreen] = useState("list");
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [showUnmatchSheet, setShowUnmatchSheet] = useState(false);
  const [matchesStatusMessage, setMatchesStatusMessage] = useState("");
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getConversations()
      .then(data => {
        // Server returns { conversations: [...], activeCap, activeCount, capReached }
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : []);
        setConversations(arr);
        if (onUnreadCount) {
          onUnreadCount(arr.filter(c => c.hasUnread).length);
        }
      })
      .catch(() => {}) // silent — MatchesListScreen handles empty state
      .finally(() => setLoadingConvs(false));
  }, [refreshKey]);

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
    setShowUnmatchSheet(false);
    try {
      await archiveConversation(selectedConversationId);
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

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {screen === "list" && (
        <MatchesListScreen
          conversations={conversations}
          loading={loadingConvs}
          onSelectConversation={handleSelectConversation}
          statusMessage={matchesStatusMessage}
          onArchive={handleArchive}
          conversationCount={conversations.filter(c => c.started).length}
        />
      )}

      {screen === "conversation" && currentConvo && (
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
          />
          {showUnmatchSheet && (
            <UnmatchSheet
              displayName={currentConvo.otherUser.displayName}
              onConfirm={handleUnmatchConfirm}
              onCancel={handleUnmatchCancel}
            />
          )}
        </>
      )}

      {screen === "block-report" && currentConvo && (
        <BlockReportScreen
          displayName={currentConvo.otherUser.displayName}
          onSubmit={handleBlockReportSubmit}
          onBack={handleBlockReportBack}
        />
      )}
    </div>
  );
}
