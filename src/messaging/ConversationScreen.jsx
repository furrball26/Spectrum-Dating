import { useState, useRef, useEffect, useCallback } from "react";
import EmptyConversationState from "./EmptyConversationState.jsx";
import { sendMessage, deleteMessage, toggleReaction as apiToggleReaction, getConversation, getUserId, uploadIntent, confirmAttachment } from "../api.js";
import { io } from "socket.io-client";
import { t } from "../tokens.js";

// Advisory fix 2 — dynamic prefers-reduced-motion hook (replaces static snapshot)
function usePrefersReduced() {
  const [prefersReduced, setPrefersReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return prefersReduced;
}

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

const MAX_BODY = 2000;
const CHAR_WARN_THRESHOLD = 200;
const RATE_LIMIT_SECONDS = 60;

// --- Feature 1: Reaction constants ---
const REACTION_EMOJIS = [
  { emoji: "♥", name: "heart" },
  { emoji: "👍", name: "thumbs up" },
  { emoji: "😊", name: "smiling face" },
  { emoji: "😄", name: "grinning face" },
  { emoji: "🤔", name: "thinking face" },
];
const MAX_REACTION_TYPES = 5;

// --- Feature 1: ReactionPicker ---
function ReactionPicker({ onSelect, onClose, reactButtonRef }) {
  const containerRef = useRef(null);
  const firstButtonRef = useRef(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        onClose();
        reactButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, reactButtonRef]);

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Add reaction"
      style={{
        display: "flex",
        gap: 4,
        padding: "6px 8px",
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 24,
        boxShadow: "0 4px 16px rgba(36,51,45,0.14)",
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: 0,
        zIndex: 250,
        whiteSpace: "nowrap",
      }}
    >
      {REACTION_EMOJIS.map(({ emoji, name }, idx) => (
        <button
          key={emoji}
          ref={idx === 0 ? firstButtonRef : undefined}
          type="button"
          aria-label={`React with ${name}`}
          onClick={() => onSelect(emoji)}
          style={{
            background: "transparent",
            border: "none",
            fontSize: 22,
            cursor: "pointer",
            padding: "4px 6px",
            borderRadius: 8,
            minHeight: 44,
            minWidth: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// --- Feature 1: ReactionPill (extracted for useFocusable — A11y Blockers 1 & 2) ---
function ReactionPill({ emoji, name, count, youReacted, onToggle }) {
  const f = useFocusable();
  const pillStyles = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 20,
    border: `1px solid ${youReacted ? t.accentStrong : t.border}`,
    background: youReacted ? t.accentStrong : t.surfaceAlt,
    color: youReacted ? "#fff" : t.text,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    minHeight: 44,
  };
  return (
    <button
      type="button"
      onClick={onToggle}
      {...f}
      style={{
        ...pillStyles,
        ...f.style,
      }}
      aria-label={`${name}, ${count} reaction${count !== 1 ? "s" : ""}. ${youReacted ? "You reacted. Tap to remove." : "Tap to react."}`}
    >
      <span aria-hidden="true">{emoji}</span>
      <span>{count}</span>
    </button>
  );
}

// --- Feature 1: ReactionPills ---
function ReactionPills({ messageId, msgReactions, currentUserId, onToggle }) {
  const entries = Object.entries(msgReactions || {}).filter(
    ([, data]) => data.count > 0
  );
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 4,
      }}
    >
      {entries.map(([emoji, data]) => {
        const count = data.count;
        const youReacted = data.youReacted;
        const emojiData = REACTION_EMOJIS.find((r) => r.emoji === emoji);
        const emojiName = emojiData ? emojiData.name : emoji;
        return (
          <ReactionPill
            key={emoji}
            emoji={emoji}
            name={emojiName}
            count={count}
            youReacted={youReacted}
            onToggle={() => onToggle(messageId, emoji)}
          />
        );
      })}
    </div>
  );
}

// Confirm delete dialog
function DeleteConfirmDialog({ onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Tab") {
        const els = [cancelRef.current, confirmRef.current].filter(Boolean);
        const idx = els.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (idx <= 0) { e.preventDefault(); els[els.length - 1]?.focus(); }
        } else {
          if (idx === els.length - 1 || idx === -1) { e.preventDefault(); els[0]?.focus(); }
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const fCancel = useFocusable();
  const fDelete = useFocusable();

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(36,51,45,0.35)",
          zIndex: 1100,
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-heading"
        aria-describedby="delete-dialog-desc"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: t.surface,
          borderRadius: 20,
          padding: "28px 24px",
          width: "min(90vw, 380px)",
          zIndex: 1101,
          boxShadow: "0 8px 40px rgba(36,51,45,0.18)",
          boxSizing: "border-box",
        }}
      >
        <h2
          id="delete-dialog-heading"
          style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 700, margin: "0 0 12px", color: t.text }}
        >
          Delete message?
        </h2>
        <p id="delete-dialog-desc" style={{ color: t.textSoft, margin: "0 0 24px", lineHeight: 1.6 }}>
          Are you sure? This can't be undone.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              background: t.surface,
              color: t.text,
              border: `1px solid ${t.border}`,
              ...fCancel.style,
            }}
            onFocus={fCancel.onFocus}
            onBlur={fCancel.onBlur}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              background: t.danger,
              color: "#fff",
              border: "none",
              ...fDelete.style,
            }}
            onFocus={fDelete.onFocus}
            onBlur={fDelete.onBlur}
          >
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

// Per-message ⋯ menu — A11y Blocker 2: arrow-key navigation
function MessageMenu({ messageId, onDelete, onClose, anchorRef }) {
  const containerRef = useRef(null);
  const itemRef = useRef(null);

  useEffect(() => {
    itemRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const items = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('[role="menuitem"]'))
        : [];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (idx >= 0) items[idx].click();
      }
    }
    function handleClick(e) {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose, anchorRef]);

  const f = useFocusable();

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Message options"
      style={{
        position: "absolute",
        right: 0,
        bottom: "calc(100% + 4px)",
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(36,51,45,0.14)",
        zIndex: 200,
        minWidth: 160,
        overflow: "hidden",
      }}
    >
      <button
        ref={itemRef}
        role="menuitem"
        type="button"
        onClick={() => { onClose(); onDelete(messageId); }}
        style={{
          display: "block",
          width: "100%",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          fontSize: 15,
          color: t.danger,
          fontWeight: 500,
          cursor: "pointer",
          ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        Delete message
      </button>
    </div>
  );
}

// Message bubble — Security Fix 1: accept currentUserId prop
// Feature 1: reactions wired in via props
function MessageBubble({
  message,
  onRequestDelete,
  currentUserId,
  msgReactions,
  onToggleReaction,
}) {
  const prefersReduced = usePrefersReduced();
  const isOwn = message.senderId === currentUserId;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuAnchorRef = useRef(null);
  const fDots = useFocusable();
  const fReact = useFocusable();
  const reactButtonRef = useRef(null);

  const reactionCount = Object.keys(msgReactions || {}).filter(
    (emoji) => (msgReactions[emoji]?.count || 0) > 0
  ).length;
  const reactionCapReached = reactionCount >= MAX_REACTION_TYPES;
  const showReactBtn = !message.deleted && !reactionCapReached;

  if (message.deleted) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: isOwn ? "flex-end" : "flex-start",
          marginBottom: 8,
        }}
      >
        <div
          aria-label="Message deleted."
          style={{
            fontStyle: "italic",
            color: t.tombstone,
            fontSize: 14,
            padding: "8px 14px",
            borderRadius: 16,
            border: `1px solid ${t.borderLight}`,
            background: "transparent",
          }}
        >
          Message deleted
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: 8,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={menuAnchorRef}
        style={{
          position: "relative",
          maxWidth: "72%",
          display: "flex",
          flexDirection: isOwn ? "row" : "row-reverse",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
        {/* Own message: ⋯ button appears on hover or focus */}
        {isOwn && (
          <button
            type="button"
            aria-label="Message options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: t.textMuted,
              fontSize: 18,
              cursor: "pointer",
              padding: "4px 6px",
              borderRadius: 6,
              minHeight: 44,
              minWidth: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: hovered || menuOpen || fDots.style.outline !== "none" ? 1 : 0,
              transition: prefersReduced ? "none" : "opacity 120ms",
              flexShrink: 0,
              ...fDots.style,
            }}
            onFocus={(e) => { fDots.onFocus(e); setHovered(true); }}
            onBlur={(e) => { fDots.onBlur(e); setHovered(false); }}
          >
            ⋯
          </button>
        )}

        {/* React button (＋) — appears on hover/focus for all messages */}
        {showReactBtn && (
          <div style={{ position: "relative" }}>
            <button
              ref={reactButtonRef}
              type="button"
              aria-label="Add reaction"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                color: t.textMuted,
                fontSize: 16,
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 6,
                minHeight: 44,
                minWidth: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: hovered || pickerOpen || fReact.style.outline !== "none" ? 1 : 0,
                transition: prefersReduced ? "none" : "opacity 120ms",
                flexShrink: 0,
                ...fReact.style,
              }}
              onFocus={(e) => { fReact.onFocus(e); setHovered(true); }}
              onBlur={(e) => { fReact.onBlur(e); setHovered(false); }}
            >
              ＋
            </button>
            {pickerOpen && (
              <ReactionPicker
                onSelect={(emoji) => {
                  onToggleReaction(message.id, emoji);
                  setPickerOpen(false);
                  reactButtonRef.current?.focus();
                }}
                onClose={() => {
                  setPickerOpen(false);
                  reactButtonRef.current?.focus();
                }}
                reactButtonRef={reactButtonRef}
              />
            )}
          </div>
        )}

        <div
          style={{
            background: isOwn ? t.bubbleOwn : t.bubbleOther,
            border: isOwn ? "none" : `1px solid ${t.border}`,
            borderRadius: isOwn
              ? "18px 18px 4px 18px"
              : "18px 18px 18px 4px",
            padding: "10px 14px",
            fontSize: 16,
            color: t.text,
            lineHeight: 1.55,
            wordBreak: "break-word",
          }}
        >
          {message.body}
          {/* Photo attachment display in bubble */}
          {message.photoUrl && (
            <img
              src={message.photoUrl}
              alt="Shared photo"
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: 200,
                borderRadius: 10,
                marginTop: message.body ? 8 : 0,
              }}
            />
          )}
        </div>

        {menuOpen && (
          <MessageMenu
            messageId={message.id}
            onDelete={onRequestDelete}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuAnchorRef}
          />
        )}
      </div>

      {/* Reaction pills — in tab order after the bubble */}
      {msgReactions && (
        <div style={{ maxWidth: "72%" }}>
          <ReactionPills
            messageId={message.id}
            msgReactions={msgReactions}
            currentUserId={currentUserId}
            onToggle={onToggleReaction}
          />
        </div>
      )}
    </div>
  );
}

// Overflow (⋯) header menu — A11y Blocker 2: arrow-key navigation
// Feature 3: added "Archive conversation" menu item
function HeaderMenu({ onUnmatch, onBlockReport, onArchive, onClose, anchorRef }) {
  const containerRef = useRef(null);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const items = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('[role="menuitem"]'))
        : [];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (idx >= 0) items[idx].click();
      }
    }
    function handleClick(e) {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose, anchorRef]);

  const f1 = useFocusable();
  const f2 = useFocusable();
  const f3 = useFocusable();

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Conversation options"
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 6px)",
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(36,51,45,0.14)",
        zIndex: 300,
        minWidth: 200,
        overflow: "hidden",
      }}
    >
      <button
        ref={firstRef}
        role="menuitem"
        type="button"
        onClick={() => { onClose(); onUnmatch(); }}
        style={{
          display: "block",
          width: "100%",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          fontSize: 15,
          color: t.text,
          fontWeight: 500,
          cursor: "pointer",
          borderBottom: `1px solid ${t.borderLight}`,
          ...f1.style,
        }}
        onFocus={f1.onFocus}
        onBlur={f1.onBlur}
      >
        Unmatch
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={() => { onClose(); onBlockReport(); }}
        style={{
          display: "block",
          width: "100%",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          fontSize: 15,
          color: t.danger,
          fontWeight: 500,
          cursor: "pointer",
          borderBottom: `1px solid ${t.borderLight}`,
          ...f2.style,
        }}
        onFocus={f2.onFocus}
        onBlur={f2.onBlur}
      >
        Block and report
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={() => { onClose(); if (onArchive) onArchive(); }}
        style={{
          display: "block",
          width: "100%",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          fontSize: 15,
          color: t.textSoft,
          fontWeight: 500,
          cursor: "pointer",
          ...f3.style,
        }}
        onFocus={f3.onFocus}
        onBlur={f3.onBlur}
      >
        Archive conversation
      </button>
    </div>
  );
}

export default function ConversationScreen({
  conversationId,
  otherUser,
  started = true,
  onBack,
  onUnmatch,
  onBlockReport,
  // Security Fix 1 — currentUserId replaces hardcoded "me" sentinel
  currentUserId = "me",
  // Feature 3 — archive callback
  onArchive,
}) {
  const headingRef = useRef(null);
  const composeRef = useRef(null);
  const logRef = useRef(null);
  const overflowButtonRef = useRef(null);
  const sendStatusRef = useRef(null);
  const logHintId = `log-hint-${conversationId}`;

  const [messages, setMessages] = useState([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [composeValue, setComposeValue] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const headerMenuAnchorRef = useRef(null);

  // Security Fix 2 — consent-gate state
  const [consentGateFailed, setConsentGateFailed] = useState(false);

  // Security Fix 4 — rate-limit state
  const [rateLimited, setRateLimited] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState("");
  const rateLimitTimerRef = useRef(null);

  // --- Feature 1: Reaction state ---
  // reactions: { [messageId]: { [emoji]: Set of userIds } }
  const [reactions, setReactions] = useState({});

  // --- Feature 2: Photo attachment state ---
  const fileInputRef = useRef(null);
  const attachButtonRef = useRef(null);
  const [attachment, setAttachment] = useState({
    file: null,
    previewUrl: null,
    status: null, // 'selected' | 'uploading' | 'pending_scan' | 'approved' | 'rejected'
  });
  const [attachStatusMsg, setAttachStatusMsg] = useState("");
  const attachScanTimerRef = useRef(null);

  const fBack = useFocusable();
  const fOverflow = useFocusable();
  const fSend = useFocusable();
  const fCompose = useFocusable();
  const fAttach = useFocusable();
  // A11y Blocker 1 — focus ring on log div
  const logFocus = useFocusable();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Load messages from API on mount
  useEffect(() => {
    getConversation(conversationId)
      .then(data => {
        setMessages(data.messages || []);
        // Hydrate reactions from server
        const rxMap = {};
        (data.messages || []).forEach(msg => {
          if (msg.reactions && msg.reactions.length > 0) {
            const emojiMap = {};
            msg.reactions.forEach(r => { emojiMap[r.emoji] = { count: r.count, youReacted: r.youReacted }; });
            rxMap[msg.id] = emojiMap;
          }
        });
        setReactions(rxMap);
      })
      .catch(() => setApiError('Could not load messages. Please try again.'))
      .finally(() => setApiLoading(false));
  }, [conversationId]);

  // socket.io real-time updates
  useEffect(() => {
    const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const token = localStorage.getItem("spectrum_token");
    if (!token) return;

    const socket = io(BASE_URL, {
      auth: { token },
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      socket.emit("join_conversation", { conversationId });
    });

    socket.on("new_message", (msg) => {
      // Don't add if it's from us (already optimistically added)
      if (msg.senderId === currentUserId) return;
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on("message_deleted", ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted: true, body: null } : m));
    });

    socket.on("reaction_update", ({ messageId, reactions }) => {
      const emojiMap = {};
      (reactions || []).forEach(r => { emojiMap[r.emoji] = { count: r.count, youReacted: r.youReacted }; });
      setReactions(prev => ({ ...prev, [messageId]: emojiMap }));
    });

    return () => {
      socket.disconnect();
    };
  }, [conversationId, currentUserId]);

  // Scroll log to bottom when messages change
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear send status after 2s (only for success statuses)
  useEffect(() => {
    if (!sendStatus) return;
    const id = setTimeout(() => setSendStatus(""), 2000);
    return () => clearTimeout(id);
  }, [sendStatus]);

  // Cleanup rate-limit timer on unmount
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    };
  }, []);

  // Cleanup attachment preview URL on unmount
  useEffect(() => {
    return () => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      if (attachScanTimerRef.current) clearTimeout(attachScanTimerRef.current);
    };
  }, []);

  // --- Feature 1: toggleReaction ---
  async function toggleReaction(messageId, emoji) {
    if (!REACTION_EMOJIS.some(r => r.emoji === emoji)) return;
    // Optimistic update
    setReactions(prev => {
      const cur = prev[messageId]?.[emoji] || { count: 0, youReacted: false };
      return {
        ...prev,
        [messageId]: {
          ...(prev[messageId] || {}),
          [emoji]: {
            count: cur.youReacted ? cur.count - 1 : cur.count + 1,
            youReacted: !cur.youReacted,
          },
        },
      };
    });
    try {
      const result = await apiToggleReaction(messageId, emoji);
      // Update with authoritative server state
      const reactionMap = {};
      (result.reactions || []).forEach(r => {
        reactionMap[r.emoji] = { count: r.count, youReacted: r.youReacted };
      });
      setReactions(prev => ({ ...prev, [messageId]: reactionMap }));
    } catch {
      // Revert optimistic update on failure
      setReactions(prev => {
        const cur = prev[messageId]?.[emoji] || { count: 0, youReacted: false };
        return {
          ...prev,
          [messageId]: {
            ...(prev[messageId] || {}),
            [emoji]: {
              count: cur.youReacted ? cur.count + 1 : cur.count - 1,
              youReacted: !cur.youReacted,
            },
          },
        };
      });
    }
  }

  // --- Feature 2: Photo attachment handlers ---
  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    // Reset input so same file can be re-selected after removal
    e.target.value = "";
    if (!file) return;

    // Max size check: 10MB
    if (file.size > 10 * 1024 * 1024) {
      setAttachStatusMsg("Photo must be under 10MB.");
      return;
    }

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setAttachStatusMsg('Only JPEG, PNG, GIF, and WebP images are supported.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAttachment({ file, previewUrl, status: "selected" });
    setAttachStatusMsg("");
  }

  function handleRemoveAttachment() {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment({ file: null, previewUrl: null, status: null });
    setAttachStatusMsg("");
    // Return focus to attach button
    attachButtonRef.current?.focus();
  }

  // Derived disabled state for compose/send
  const composingDisabled = consentGateFailed || rateLimited;
  const hasAttachment = attachment.file !== null;
  const sendDisabled =
    composingDisabled ||
    (!composeValue.trim() && !hasAttachment) ||
    composeValue.length > MAX_BODY ||
    attachment.status === "rejected";

  async function handleSend() {
    if (sendDisabled) return;
    const body = composeValue.trim();

    if (!body && !hasAttachment) return;

    // Feature 2 — real R2 upload if attachment present (backlog #9)
    if (hasAttachment) {
      const file = attachment.file;
      const capturedBody = body;
      setAttachment((prev) => ({ ...prev, status: "uploading" }));
      setAttachStatusMsg("Uploading photo…");
      try {
        // 1. Get a presigned upload intent
        const { attachmentId, uploadUrl, publicUrl } = await uploadIntent(file.type, file.size);
        // 2. Upload the file directly to R2
        const upload = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!upload.ok) throw new Error("Upload failed");
        // 3. Confirm the attachment with the backend
        await confirmAttachment(attachmentId);
        // 4. Send the message.
        // TODO: backend message-attachment linking — sendMessage does not yet
        // accept an attachmentId, so the photo is shown optimistically via
        // publicUrl and the text body (if any) is persisted on its own.
        let savedId = `msg-${Date.now()}`;
        let savedTimeLabel = "Today";
        if (capturedBody) {
          const saved = await sendMessage(conversationId, capturedBody);
          savedId = saved.id || savedId;
          savedTimeLabel = saved.timeLabel || savedTimeLabel;
        }
        const newMsg = {
          id: savedId,
          senderId: currentUserId,
          body: capturedBody || null,
          photoUrl: publicUrl,
          timeLabel: savedTimeLabel,
          deleted: false,
        };
        setMessages((prev) => [...prev, newMsg]);
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        setAttachment({ file: null, previewUrl: null, status: null });
        setAttachStatusMsg("");
        setComposeValue("");
        setSendStatus("Message sent.");
        composeRef.current?.focus();
      } catch (err) {
        // Graceful degradation: 503 = R2 not configured; surface via the
        // existing rejected-attachment error UI.
        setAttachment((prev) => ({ ...prev, status: "rejected" }));
        if (err.status === 503) {
          setAttachStatusMsg("Photo uploads are temporarily unavailable. Please try again later.");
        } else if (err.status === 403) {
          setConsentGateFailed(true);
          setAttachStatusMsg("");
          setSendStatus("Unable to send. This conversation is no longer available.");
        } else {
          setAttachStatusMsg("Photo could not be sent. Please try again.");
        }
      }
      return;
    }

    // Optimistic: add message immediately
    const tempId = `temp-${Date.now()}`;
    const tempMsg = {
      id: tempId,
      senderId: currentUserId,
      body: body || null,
      timeLabel: "Today",
      deleted: false,
    };
    setMessages(prev => [...prev, tempMsg]);
    setComposeValue("");
    composeRef.current?.focus();

    try {
      const saved = await sendMessage(conversationId, body);
      // Replace temp with server message
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id, timeLabel: saved.timeLabel || 'Today' } : m));
      setSendStatus("Message sent.");
    } catch (err) {
      // Remove optimistic message
      setMessages(prev => prev.filter(m => m.id !== tempId));
      if (err.status === 403) {
        setConsentGateFailed(true);
        setSendStatus("Unable to send. This conversation is no longer available.");
      } else if (err.status === 429) {
        setRateLimited(true);
        setSendStatus("You're sending messages quickly. Please wait a moment.");
      } else {
        setSendStatus("Message could not be sent. Please try again.");
      }
    }
  }

  function handleComposeKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleRequestDelete(messageId) {
    setPendingDeleteId(messageId);
  }

  async function handleConfirmDelete() {
    const targetId = pendingDeleteId;
    setPendingDeleteId(null);
    // Optimistic update
    setMessages(prev => prev.map(m => m.id === targetId ? { ...m, deleted: true, body: null } : m));
    requestAnimationFrame(() => {
      const tombstone = document.getElementById(`tombstone-${targetId}`);
      if (tombstone) {
        tombstone.focus();
        setTimeout(() => composeRef.current?.focus(), 800);
      } else {
        composeRef.current?.focus();
      }
    });
    try {
      await deleteMessage(conversationId, targetId);
    } catch {
      // Revert on failure
      setMessages(prev => prev.map(m => m.id === targetId ? { ...m, deleted: false } : m));
    }
  }

  function handleCancelDelete() {
    setPendingDeleteId(null);
    composeRef.current?.focus();
  }

  // Feature 3 — archive handler
  function handleArchive() {
    if (onArchive) onArchive(conversationId);
    if (onBack) onBack();
  }

  if (apiLoading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: t.textSoft }}>Loading…</p></div>;
  if (apiError) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}><p role="alert" style={{ color: t.danger, textAlign: 'center' }}>{apiError}</p></div>;

  // Group messages by timeLabel for group headers
  const grouped = [];
  let lastLabel = null;
  messages.forEach((msg) => {
    if (msg.timeLabel !== lastLabel) {
      grouped.push({ type: "header", label: msg.timeLabel });
      lastLabel = msg.timeLabel;
    }
    grouped.push({ type: "message", msg });
  });

  const hasMessages = messages.length > 0;

  // Security Fix 3 — character counter
  const charsRemaining = MAX_BODY - composeValue.length;
  const showCharCounter = charsRemaining < CHAR_WARN_THRESHOLD;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: t.bgGradient,
        fontFamily: t.sans,
        color: t.text,
        fontSize: 17,
      }}
    >
      {/* Fixed header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          background: t.surface,
          borderBottom: `1px solid ${t.border}`,
          flexShrink: 0,
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Back button — touch target fix: minHeight/minWidth 44 */}
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            color: t.accent,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            padding: "8px 10px 8px 0",
            flexShrink: 0,
            minHeight: 44,
            minWidth: 44,
            ...fBack.style,
          }}
          onFocus={fBack.onFocus}
          onBlur={fBack.onBlur}
          aria-label="Back to Matches"
        >
          ← Matches
        </button>

        {/* Centred heading */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          style={{
            flex: 1,
            textAlign: "center",
            fontFamily: t.serif,
            fontSize: 18,
            fontWeight: 700,
            margin: 0,
            color: t.text,
            outline: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {otherUser.displayName}
        </h2>

        {/* Overflow menu button — touch target fix: minHeight/minWidth 44 */}
        <div ref={headerMenuAnchorRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            ref={overflowButtonRef}
            type="button"
            aria-label="Conversation options"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: t.textMuted,
              fontSize: 22,
              cursor: "pointer",
              padding: "8px 0 8px 10px",
              minHeight: 44,
              minWidth: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...fOverflow.style,
            }}
            onFocus={fOverflow.onFocus}
            onBlur={fOverflow.onBlur}
          >
            ⋯
          </button>

          {headerMenuOpen && (
            <HeaderMenu
              onUnmatch={() => { if (onUnmatch) onUnmatch(); }}
              onBlockReport={() => { if (onBlockReport) onBlockReport(); }}
              onArchive={handleArchive}
              onClose={() => {
                setHeaderMenuOpen(false);
                overflowButtonRef.current?.focus();
              }}
              anchorRef={headerMenuAnchorRef}
            />
          )}
        </div>
      </div>

      {/* Message log or empty state */}
      {!hasMessages && !started ? (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <EmptyConversationState
            displayName={otherUser.displayName}
            conversationId={conversationId}
            onSelectStarter={(text) => setComposeValue(text)}
          />
        </div>
      ) : (
        <>
          {/* Visually hidden scroll hint */}
          <p
            id={logHintId}
            style={{
              position: "absolute",
              left: "-9999px",
              width: 1,
              height: 1,
              overflow: "hidden",
            }}
          >
            Use Page Up and Page Down to scroll through messages.
          </p>

          {/* A11y Blocker 1 — useFocusable() spread on log div (replaces outline: "none") */}
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={`Conversation with ${otherUser.displayName}`}
            aria-describedby={logHintId}
            tabIndex={0}
            {...logFocus}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 16px 8px",
              minHeight: 0,
              ...logFocus.style,
            }}
          >
            {grouped.map((item, i) => {
              if (item.type === "header") {
                return (
                  <div
                    key={`header-${item.label}-${i}`}
                    aria-hidden="true"
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      color: t.textSoft,
                      fontWeight: 500,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      margin: "16px 0 10px",
                    }}
                  >
                    {item.label}
                  </div>
                );
              }
              const msg = item.msg;
              if (msg.deleted) {
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      justifyContent: msg.senderId === currentUserId ? "flex-end" : "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      id={`tombstone-${msg.id}`}
                      tabIndex={-1}
                      aria-label="Message deleted."
                      style={{
                        fontStyle: "italic",
                        color: t.tombstone,
                        fontSize: 14,
                        padding: "8px 14px",
                        borderRadius: 16,
                        border: `1px solid ${t.borderLight}`,
                        background: "transparent",
                        outline: "none",
                      }}
                    >
                      Message deleted
                    </div>
                  </div>
                );
              }
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onRequestDelete={handleRequestDelete}
                  currentUserId={currentUserId}
                  msgReactions={reactions[msg.id] || {}}
                  onToggleReaction={toggleReaction}
                />
              );
            })}
          </div>
        </>
      )}

      {/* Security Fix 2 — consent-gate inline notice above compose area */}
      {consentGateFailed && (
        <div
          role="alert"
          style={{
            padding: "10px 16px",
            background: "#FFF5F5",
            borderTop: `1px solid ${t.danger}`,
            color: t.danger,
            fontSize: 15,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          This conversation is no longer available.
        </div>
      )}

      {/* Feature 2 — Photo attachment status region */}
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
        {attachStatusMsg}
      </div>

      {/* Feature 2 — attachment status visible (scan / error) */}
      {attachStatusMsg && (
        <div
          aria-hidden="true"
          style={{
            padding: "8px 16px",
            background: attachment.status === "rejected" ? "#FFF5F5" : t.surfaceAlt,
            borderTop: `1px solid ${attachment.status === "rejected" ? t.danger : t.border}`,
            color: attachment.status === "rejected" ? t.danger : t.textSoft,
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {attachStatusMsg}
        </div>
      )}

      {/* Feature 2 — photo preview above compose */}
      {attachment.previewUrl && attachment.status !== "rejected" && (
        <div
          style={{
            padding: "8px 16px",
            background: t.surface,
            borderTop: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <img
            src={attachment.previewUrl}
            alt="Attached photo preview"
            style={{
              maxHeight: 80,
              maxWidth: 120,
              borderRadius: 8,
              objectFit: "cover",
              border: `1px solid ${t.border}`,
            }}
          />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={handleRemoveAttachment}
            style={{
              background: "transparent",
              border: `1px solid ${t.border}`,
              borderRadius: 6,
              color: t.textSoft,
              fontSize: 14,
              cursor: "pointer",
              padding: "4px 10px",
              minHeight: 44,
              minWidth: 44,
              alignSelf: "flex-start",
            }}
          >
            ✕ Remove
          </button>
        </div>
      )}

      {/* Compose area */}
      <div
        style={{
          padding: "12px 16px",
          background: t.surface,
          borderTop: `1px solid ${t.border}`,
          flexShrink: 0,
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        {/* Feature 2 — Attach photo button */}
        <button
          ref={attachButtonRef}
          type="button"
          aria-label="Attach photo"
          onClick={handleAttachClick}
          disabled={composingDisabled}
          style={{
            background: "transparent",
            border: `1px solid ${t.border}`,
            borderRadius: 12,
            color: composingDisabled ? t.textMuted : t.accent,
            fontSize: 20,
            cursor: composingDisabled ? "not-allowed" : "pointer",
            minHeight: 44,
            minWidth: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...fAttach.style,
          }}
          onFocus={fAttach.onFocus}
          onBlur={fAttach.onBlur}
        >
          📎
        </button>

        {/* Hidden file input — Feature 2 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <textarea
            ref={composeRef}
            aria-label={`Message ${otherUser.displayName}`}
            placeholder="Write a message…"
            value={composeValue}
            onChange={(e) => setComposeValue(e.target.value)}
            onKeyDown={handleComposeKeyDown}
            rows={1}
            maxLength={MAX_BODY}
            disabled={composingDisabled}
            style={{
              border: `1px solid ${t.formBorder}`,
              borderRadius: 18,
              padding: "10px 14px",
              fontSize: 16,
              color: t.text,
              background: composingDisabled ? t.surfaceAlt : t.bg,
              resize: "none",
              fontFamily: t.sans,
              lineHeight: 1.5,
              boxSizing: "border-box",
              maxHeight: 120,
              overflow: "auto",
              width: "100%",
              ...fCompose.style,
            }}
            onFocus={fCompose.onFocus}
            onBlur={fCompose.onBlur}
          />
          {/* Security Fix 3 — character counter (shown when < 200 chars remaining) */}
          {showCharCounter && (
            <div
              role="status"
              aria-live="polite"
              style={{
                fontSize: 12,
                color: charsRemaining < 0 ? t.danger : t.textMuted,
                textAlign: "right",
                paddingRight: 4,
              }}
            >
              {charsRemaining >= 0
                ? `${charsRemaining} characters remaining`
                : `${Math.abs(charsRemaining)} characters over limit`}
            </div>
          )}
        </div>

        {/* Send status region — covers success, consent-gate failure, rate-limit */}
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
          {consentGateFailed
            ? "Unable to send. This conversation is no longer available."
            : rateLimitStatus || sendStatus}
        </div>

        {/* Security Fix 4 — rate-limit visible status (not hidden) */}
        {rateLimited && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              padding: "8px 16px",
              background: t.surfaceAlt,
              borderTop: `1px solid ${t.border}`,
              fontSize: 14,
              color: t.textSoft,
              textAlign: "center",
            }}
          >
            You're sending messages quickly. Please wait a moment before sending again.
          </div>
        )}

        {/* Send button — touch target fix: 48×48 */}
        <button
          type="button"
          aria-label="Send"
          onClick={handleSend}
          disabled={sendDisabled}
          style={{
            width: 48,
            height: 48,
            minWidth: 48,
            minHeight: 48,
            borderRadius: "50%",
            background: !sendDisabled ? t.accent : t.borderLight,
            border: "none",
            color: !sendDisabled ? "#fff" : t.textMuted,
            fontSize: 18,
            cursor: !sendDisabled ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...fSend.style,
          }}
          onFocus={fSend.onFocus}
          onBlur={fSend.onBlur}
        >
          ↑
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {pendingDeleteId && (
        <DeleteConfirmDialog
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
}
