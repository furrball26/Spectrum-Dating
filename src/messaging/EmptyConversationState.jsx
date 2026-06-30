import { useState, useRef, useEffect } from "react";
import { getStarters } from "../api.js";
import { t } from "../tokens.js";
import { EmptyMessages } from "../illustrations.jsx";

const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

// Generic fallback — used only if the personalised starters can't be fetched.
const FALLBACK_STARTERS = [
  "What's something you've been enjoying lately?",
  "If you could visit anywhere, where would you go?",
  "How do you usually like to spend a quiet weekend?",
];

export default function EmptyConversationState({ displayName, conversationId, onSelectStarter, plainLanguage = false }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [starters, setStarters] = useState(FALLBACK_STARTERS);
  const needsIdeasRef = useRef(null);
  const firstStarterRef = useRef(null);
  const fButton = useFocusable();

  // Fetch personalised starters (generated from shared interests) once we have
  // a conversation id. Falls back silently to the generic list on any error.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    getStarters(conversationId)
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.starters;
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setStarters(list.slice(0, 3));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (panelOpen && firstStarterRef.current) {
      firstStarterRef.current.focus();
    }
  }, [panelOpen]);

  function closePanelAndReturnFocus() {
    setPanelOpen(false);
    // Focus returns to "Need ideas?" button after panel closes
    requestAnimationFrame(() => {
      needsIdeasRef.current?.focus();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 20,
          padding: "32px 28px",
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 2px 8px rgba(36,51,45,0.07)",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <EmptyMessages size={96} />
        </div>
        <h2
          style={{
            fontFamily: t.serif,
            fontSize: 22,
            fontWeight: 700,
            color: t.text,
            margin: "0 0 12px",
            lineHeight: 1.3,
          }}
        >
          You matched with {displayName}.
        </h2>
        <p
          style={{
            color: t.textSoft,
            fontSize: 16,
            lineHeight: 1.65,
            margin: "0 0 24px",
          }}
        >
          {plainLanguage ? "Send a message when you're ready." : "Send a message whenever you're ready. There's no rush."}
        </p>

        <button
          ref={needsIdeasRef}
          type="button"
          aria-expanded={panelOpen}
          aria-controls="starter-suggestions-panel"
          onClick={() => setPanelOpen((v) => !v)}
          style={{
            background: "transparent",
            border: `1px solid ${t.border}`,
            borderRadius: 10,
            padding: "10px 20px",
            fontSize: 15,
            color: t.accent,
            fontWeight: 600,
            cursor: "pointer",
            ...fButton.style,
          }}
          onFocus={fButton.onFocus}
          onBlur={fButton.onBlur}
        >
          {plainLanguage ? "Starter ideas" : "Need ideas?"}
        </button>

        {panelOpen && (
          <div
            id="starter-suggestions-panel"
            role="region"
            aria-label="Conversation starter suggestions"
            style={{
              marginTop: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              textAlign: "left",
            }}
          >
            <p style={{ fontSize: 13, color: t.textMuted, margin: "0 0 4px", fontWeight: 500 }}>
              Tap a suggestion to use it:
            </p>
            {starters.map((text, i) => {
              return (
                <StarterItem
                  key={i}
                  text={text}
                  itemRef={i === 0 ? firstStarterRef : null}
                  onSelect={() => {
                    onSelectStarter(text);
                    closePanelAndReturnFocus();
                  }}
                />
              );
            })}
            <DismissButton onDismiss={closePanelAndReturnFocus} />
          </div>
        )}
      </div>
    </div>
  );
}

function StarterItem({ text, onSelect, itemRef }) {
  const f = useFocusable();
  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onSelect}
      style={{
        background: t.surfaceAlt,
        border: `1px solid ${t.borderLight}`,
        borderRadius: 12,
        padding: "12px 16px",
        fontSize: 15,
        color: t.text,
        lineHeight: 1.5,
        cursor: "pointer",
        textAlign: "left",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {text}
    </button>
  );
}

function DismissButton({ onDismiss }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onDismiss}
      style={{
        background: "transparent",
        border: "none",
        color: t.textMuted,
        fontSize: 14,
        textDecoration: "underline",
        cursor: "pointer",
        marginTop: 4,
        padding: "4px 0",
        ...f.style,
      }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      Dismiss suggestions
    </button>
  );
}
