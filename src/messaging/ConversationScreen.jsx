import { useState, useRef, useEffect, useCallback } from "react";
import EmptyConversationState from "./EmptyConversationState.jsx";
import { sendMessage, deleteMessage, toggleReaction as apiToggleReaction, getConversation, getUserId, uploadAttachmentIntent, confirmAttachment } from "../api.js";
import { io } from "socket.io-client";
import { t } from "../tokens.js";
import ErrorState from "../ErrorState.jsx";
import Avatar from "../Avatar.jsx";
import MatchProfileModal from "../MatchProfileModal.jsx";

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

// Photo message attachments are built end-to-end (upload-intent → R2 PUT →
// confirm → sendMessage with attachmentId → moderator review). Kept gated OFF
// so no user can upload until product flips this on. Flip to true to enable the
// compose/attach UI. The admin Photo-review queue ships regardless.
const ATTACHMENTS_ENABLED = true;
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
    border: `1px solid ${youReacted ? t.accentFill : t.border}`,
    background: youReacted ? t.accentFill : t.surfaceAlt,
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

// --- Feature 2: message photo attachment (in-bubble) ---
// Renders an approved image, or a calm "pending review" placeholder for the
// sender's own just-uploaded photo. Non-approved photos are NEVER rendered to
// the other party (the server already withholds their publicUrl on hydration).
function MessageAttachment({ attachment, isOwn, hasBody, onEnlarge }) {
  const approved = attachment.status === "approved" && attachment.publicUrl;
  const pending = isOwn && attachment.status === "pending_review";

  if (pending) {
    return (
      <div
        style={{
          marginTop: hasBody ? 8 : 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 12,
          border: `1px dashed ${t.border}`,
          background: t.surfaceAlt,
          color: t.textSoft,
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16 }}>🕓</span>
        <span>Photo pending review. It’ll appear here once a moderator approves it.</span>
      </div>
    );
  }

  if (!approved) return null;

  return (
    <button
      type="button"
      onClick={() => onEnlarge && onEnlarge(attachment.publicUrl)}
      aria-label="Shared photo. Open larger view."
      style={{
        display: "block",
        marginTop: hasBody ? 8 : 0,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: onEnlarge ? "zoom-in" : "default",
        borderRadius: 12,
        lineHeight: 0,
      }}
    >
      <img
        src={attachment.publicUrl}
        alt="Shared photo"
        loading="lazy"
        style={{
          display: "block",
          maxWidth: "100%",
          maxHeight: 240,
          borderRadius: 12,
          objectFit: "cover",
        }}
      />
    </button>
  );
}

// Click-to-enlarge lightbox for shared photos.
function ImageLightbox({ src, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo preview"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(36,51,45,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: 24,
      }}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label="Close photo preview"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          minHeight: 44,
          minWidth: 44,
          borderRadius: 22,
          border: "none",
          background: t.surface,
          color: t.text,
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✕
      </button>
      <img
        src={src}
        alt="Shared photo, enlarged"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          borderRadius: 12,
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}

// Confirm delete dialog
function DeleteConfirmDialog({ onConfirm, onCancel, unsent = false }) {
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
          {unsent ? "Discard unsent message?" : "Delete message?"}
        </h2>
        <p id="delete-dialog-desc" style={{ color: t.textSoft, margin: "0 0 24px", lineHeight: 1.6 }}>
          {unsent ? "This message hasn't been sent yet." : "Are you sure? This can't be undone."}
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
              background: t.dangerFill,
              color: "#fff",
              border: "none",
              ...fDelete.style,
            }}
            onFocus={fDelete.onFocus}
            onBlur={fDelete.onBlur}
          >
            {unsent ? "Discard" : "Delete"}
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
  onRetry,
  onEnlargeImage,
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
          {/* Photo attachment — only ever render an approved image with a
              publicUrl. The sender sees a gentle pending-review state for their
              own just-sent photo; the other party never sees non-approved ones. */}
          {message.attachment && (
            <MessageAttachment
              attachment={message.attachment}
              isOwn={isOwn}
              hasBody={!!message.body}
              onEnlarge={onEnlargeImage}
            />
          )}
        </div>

        {isOwn && message.failed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 13, color: t.danger }}>
            <span>Didn't send.</span>
            <button
              type="button"
              onClick={() => onRetry && onRetry(message)}
              style={{ background: "none", border: "none", color: t.accentStrong, fontWeight: 600, fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: "4px 2px", minHeight: 32 }}
            >
              Retry
            </button>
          </div>
        )}

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
  // Desktop 2-pane: list stays visible beside the thread, so the redundant
  // "Back to Matches" control is hidden.
  hideBack = false,
  plainLanguage = false,
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
  const [reloadKey, setReloadKey] = useState(0);
  const [composeValue, setComposeValue] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [socketConnected, setSocketConnected] = useState(true);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(false);
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

  // --- Message pagination state ---
  const [hasMore, setHasMore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  // When set, the scroll useEffect restores position instead of snapping to bottom.
  const scrollRestorationRef = useRef(null);

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
  // Click-to-enlarge lightbox for an approved shared photo.
  const [enlargedImage, setEnlargedImage] = useState(null);

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

  // Load messages from API on mount (and on retry via reloadKey).
  // Fetches the most recent PAGE_SIZE messages; older messages are loaded on demand.
  useEffect(() => {
    setApiLoading(true);
    setApiError(null);
    getConversation(conversationId, { limit: 50 })
      .then(data => {
        const msgs = data.messages || [];
        setMessages(msgs);
        setHasMore(data.hasMore ?? false);
        setOldestCursor(msgs.length > 0 ? msgs[0].id : null);
        // Hydrate reactions from server
        const rxMap = {};
        msgs.forEach(msg => {
          if (msg.reactions && msg.reactions.length > 0) {
            const emojiMap = {};
            msg.reactions.forEach(r => { emojiMap[r.emoji] = { count: r.count, youReacted: r.userReacted }; });
            rxMap[msg.id] = emojiMap;
          }
        });
        setReactions(rxMap);
      })
      .catch(() => setApiError('Could not load messages. Please try again.'))
      .finally(() => setApiLoading(false));
  }, [conversationId, reloadKey]);

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
      setSocketConnected(true);
      socket.emit("join_conversation", { conversationId });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));

    socket.on("new_message", (payload) => {
      // Server emits { conversationId, message: {...} }; tolerate a flat shape too.
      const msg = payload?.message || payload;
      if (!msg || !msg.id) return;
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
      (reactions || []).forEach(r => { emojiMap[r.emoji] = { count: r.count, youReacted: r.userReacted }; });
      setReactions(prev => ({ ...prev, [messageId]: emojiMap }));
    });

    return () => {
      socket.disconnect();
    };
  }, [conversationId, currentUserId]);

  // Scroll log to bottom when messages change, UNLESS we're prepending older
  // messages — in that case restore the relative scroll position instead.
  useEffect(() => {
    if (!logRef.current) return;
    if (scrollRestorationRef.current !== null) {
      const { prevScrollHeight } = scrollRestorationRef.current;
      scrollRestorationRef.current = null;
      logRef.current.scrollTop = logRef.current.scrollHeight - prevScrollHeight;
    } else {
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
        reactionMap[r.emoji] = { count: r.count, youReacted: r.userReacted };
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
    attachment.status === "uploading";

  async function handleSend() {
    if (sendDisabled) return;
    const body = composeValue.trim();

    if (!body && !hasAttachment) return;

    // Feature 2 — real R2 upload if attachment present (Error Log E2).
    // Flow: upload-intent → PUT bytes to R2 → confirm → sendMessage({ body,
    // attachmentId }) in ONE send. The server returns the real messageId and the
    // hydrated attachment; we never fabricate a temp-/client-only id here. On
    // ANY failure the composer text is preserved (E37) so the user loses nothing.
    if (hasAttachment) {
      const file = attachment.file;
      const capturedBody = body;
      setAttachment((prev) => ({ ...prev, status: "uploading" }));
      setAttachStatusMsg("Uploading photo…");
      try {
        // 1. Get a presigned upload intent (status: pending).
        const { attachmentId, uploadUrl } = await uploadAttachmentIntent({
          mimeType: file.type,
          fileSizeBytes: file.size,
        });
        // 2. Upload the raw bytes directly to R2.
        const upload = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!upload.ok) throw new Error("Upload failed");
        // 3. Confirm the attachment (status → pending_review).
        await confirmAttachment(attachmentId);
        // 4. Send the message linking the attachment. Body is optional here
        //    because a valid attachment is present.
        const saved = await sendMessage(conversationId, {
          body: capturedBody || undefined,
          attachmentId,
        });
        // Use the server's authoritative id + hydrated attachment shape.
        const newMsg = {
          id: saved.id,
          senderId: currentUserId,
          body: capturedBody || null,
          attachment: saved.attachment || {
            id: attachmentId,
            status: "pending_review",
            mimeType: file.type,
          },
          timeLabel: saved.timeLabel || "Today",
          deleted: false,
        };
        setMessages((prev) => [...prev, newMsg]);
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        setAttachment({ file: null, previewUrl: null, status: null });
        setAttachStatusMsg("");
        setComposeValue("");
        setSendStatus("Photo sent — pending review.");
        composeRef.current?.focus();
      } catch (err) {
        // PRESERVE the user's typed text (E37): we never cleared composeValue on
        // this path, so it's still intact. Keep the selected photo too so they
        // can retry. Surface a calm, specific message.
        setAttachment((prev) => ({ ...prev, status: "selected" }));
        if (err.status === 403) {
          setConsentGateFailed(true);
          setAttachStatusMsg("");
          setSendStatus("Unable to send. This conversation is no longer available.");
        } else if (
          err.status === 400 &&
          /attachments are not enabled/i.test(err.message || "")
        ) {
          setAttachStatusMsg("Photo sharing isn’t available right now.");
        } else if (err.status === 429) {
          setRateLimited(true);
          setAttachStatusMsg("");
          setSendStatus("You're sending messages quickly. Please wait a moment.");
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
      // Replace temp with server message (clear any prior failed flag)
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: saved.id, timeLabel: saved.timeLabel || 'Today', failed: false } : m));
      setSendStatus("Message sent.");
    } catch (err) {
      if (err.status === 403) {
        setMessages(prev => prev.filter(m => m.id !== tempId)); // terminal — gone
        setConsentGateFailed(true);
        setSendStatus("Unable to send. This conversation is no longer available.");
      } else if (err.status === 429) {
        setMessages(prev => prev.filter(m => m.id !== tempId)); // they can retype after the limit
        setRateLimited(true);
        setSendStatus("You're sending messages quickly. Please wait a moment.");
      } else {
        // Keep the message (with its text) and mark it failed so it can be retried.
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true } : m));
        setSendStatus("Message didn't send. Tap Retry.");
      }
    }
  }

  // Re-send a failed message: clear the flag and try again in place.
  async function retrySend(failedMsg) {
    if (!failedMsg?.body) return;
    setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, failed: false } : m));
    try {
      const saved = await sendMessage(conversationId, failedMsg.body);
      setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, id: saved.id, timeLabel: saved.timeLabel || 'Today', failed: false } : m));
      setSendStatus("Message sent.");
    } catch {
      setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, failed: true } : m));
      setSendStatus("Still couldn't send. Check your connection.");
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
    // Unsent (temp-) messages exist only client-side — they were never persisted,
    // so there's nothing to DELETE. Remove the row outright and stop (a server
    // call would 404 on the fabricated id).
    if (typeof targetId === "string" && targetId.startsWith("temp-")) {
      setMessages(prev => prev.filter(m => m.id !== targetId));
      composeRef.current?.focus();
      return;
    }
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

  async function handleLoadEarlier() {
    if (!hasMore || isLoadingEarlier || !oldestCursor) return;
    setIsLoadingEarlier(true);
    try {
      const data = await getConversation(conversationId, { limit: 50, before: oldestCursor });
      const olderMsgs = data.messages || [];
      if (olderMsgs.length === 0) {
        setHasMore(false);
        return;
      }
      // Capture the current scroll height BEFORE prepending so we can restore
      // relative position after React re-renders the longer list.
      scrollRestorationRef.current = { prevScrollHeight: logRef.current?.scrollHeight ?? 0 };
      setMessages(prev => [...olderMsgs, ...prev]);
      setHasMore(data.hasMore ?? false);
      setOldestCursor(olderMsgs.length > 0 ? olderMsgs[0].id : null);
      // Hydrate reactions for the newly-loaded older messages
      setReactions(prev => {
        const rxMap = { ...prev };
        olderMsgs.forEach(msg => {
          if (msg.reactions && msg.reactions.length > 0) {
            const emojiMap = {};
            msg.reactions.forEach(r => { emojiMap[r.emoji] = { count: r.count, youReacted: r.userReacted }; });
            rxMap[msg.id] = emojiMap;
          }
        });
        return rxMap;
      });
    } catch {
      // Silently ignore — the button stays and the user can retry.
    } finally {
      setIsLoadingEarlier(false);
    }
  }

  if (apiLoading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: t.textSoft }}>Loading…</p></div>;
  if (apiError) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ErrorState
        title="Couldn't load messages"
        message="Something went wrong on our end. Please try again."
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );

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
      {viewingProfile && (
        <MatchProfileModal userId={otherUser.userId} onClose={() => setViewingProfile(false)} />
      )}
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
        {/* Back button — touch target fix: minHeight/minWidth 44. Hidden in the
            desktop 2-pane where the list stays visible alongside the thread. */}
        {!hideBack && (
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
        )}

        {/* Centred heading — tap the avatar/name to view their profile. */}
        <h2 style={{ flex: 1, margin: 0, textAlign: "center", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setViewingProfile(true)}
            aria-label={`View ${otherUser.displayName}'s profile`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%",
              background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
              minHeight: 44, borderRadius: 10,
            }}
          >
            <Avatar name={otherUser.displayName} userId={otherUser.userId} photoUrl={otherUser.photoUrl} size={32} />
            <span
              ref={headingRef}
              tabIndex={-1}
              style={{
                fontFamily: t.serif, fontSize: 18, fontWeight: 700, color: t.text,
                outline: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {otherUser.displayName}
            </span>
          </button>
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
            plainLanguage={plainLanguage}
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

          {!socketConnected && (
            <div role="status" style={{ textAlign: "center", padding: "6px 12px", fontSize: 13, color: t.textMuted, background: t.surfaceAlt, borderBottom: `1px solid ${t.borderLight}` }}>
              Reconnecting… new messages will appear once you're back online.
            </div>
          )}

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
            {/* Load-earlier button — only shown when the server reports more pages */}
            {hasMore && (
              <div style={{ textAlign: "center", padding: "4px 0 8px" }}>
                <button
                  type="button"
                  onClick={handleLoadEarlier}
                  disabled={isLoadingEarlier}
                  aria-busy={isLoadingEarlier}
                  style={{
                    background: "transparent",
                    border: `1px solid ${t.border}`,
                    borderRadius: 20,
                    color: t.accent,
                    padding: "6px 18px",
                    fontSize: 14,
                    cursor: isLoadingEarlier ? "default" : "pointer",
                    opacity: isLoadingEarlier ? 0.6 : 1,
                    fontFamily: t.sans,
                    minHeight: 36,
                    transition: "opacity 150ms ease",
                  }}
                >
                  {isLoadingEarlier ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}

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
                  onRetry={retrySend}
                  onEnlargeImage={setEnlargedImage}
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
            background: t.surfaceAlt,
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
            background: attachment.status === "rejected" ? t.surfaceAlt : t.surfaceAlt,
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
        {/* Feature 2 — Attach photo button. Hidden until the backend supports
            linking an uploaded photo to a message (needs R2 configured + the
            sendMessage attachmentId path). Flip ATTACHMENTS_ENABLED to restore. */}
        {ATTACHMENTS_ENABLED && (
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
        )}

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
            background: !sendDisabled ? t.accentFill : t.borderLight,
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

      {/* Click-to-enlarge photo lightbox */}
      {enlargedImage && (
        <ImageLightbox src={enlargedImage} onClose={() => setEnlargedImage(null)} />
      )}

      {/* Delete confirmation dialog */}
      {pendingDeleteId && (
        <DeleteConfirmDialog
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          unsent={typeof pendingDeleteId === "string" && pendingDeleteId.startsWith("temp-")}
        />
      )}
    </div>
  );
}
