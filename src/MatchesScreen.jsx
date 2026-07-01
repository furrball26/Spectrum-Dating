import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { getMatches, createConversation, getActivity, saveMatchNote } from "./api.js";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import Skeleton from "./Skeleton.jsx";
import Button from "./Button.jsx";
import Spectrum from "./Spectrum.jsx";
import { EmptyMatches } from "./illustrations.jsx";
import ErrorState from "./ErrorState.jsx";
import MatchProfileModal from "./MatchProfileModal.jsx";

// Matches — people you and they have both said yes to. Separate from active
// conversations (Messages). Calm, low-pressure: no counters, no urgency.

// Calm placeholder rows shown while matches load.
function MatchesSkeleton() {
  return (
    <ul style={{ margin: 0, padding: 0 }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} style={{ listStyle: "none", marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              padding: "14px 16px",
            }}
          >
            <Skeleton width={56} height={56} radius="50%" />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton width="45%" height={16} />
              <Skeleton width="70%" height={13} />
            </div>
            <Skeleton width={84} height={38} radius={11} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Private note to self ──────────────────────────────────────────────────
// A small, clearly-PRIVATE memory aid on a match ("met at the book club").
// Owner-only: only the viewer ever sees or saves it. Collapsed by default to
// keep the card calm; expands to a small textarea saved on blur or Save.
const NOTE_MAX = 500;
function PrivateNote({ matchId, note, onSaved }) {
  const initial = note || "";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const taRef = useRef(null);

  // Keep the field in sync if the underlying note changes (e.g. after reload).
  useEffect(() => { setValue(note || ""); }, [note]);
  // Focus the textarea when it opens.
  useEffect(() => { if (open) taRef.current?.focus(); }, [open]);

  const persist = useCallback(async () => {
    const trimmed = value.trim().slice(0, NOTE_MAX);
    if (trimmed === (note || "").trim()) return; // nothing changed
    setSaving(true);
    try {
      const res = await saveMatchNote(matchId, trimmed);
      const saved = typeof res?.note === "string" ? res.note : trimmed;
      if (onSaved) onSaved(matchId, saved);
      setValue(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch {
      /* leave the field as-is so the user doesn't lose their text */
    } finally {
      setSaving(false);
    }
  }, [value, note, matchId, onSaved]);

  const hasNote = !!(note && note.trim());

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          padding: "4px 0 0",
          marginTop: 4,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: t.textMuted,
          textAlign: "left",
        }}
        aria-label={hasNote ? "Edit your private note" : "Add a private note"}
      >
        <span aria-hidden="true">🔒</span>
        {hasNote ? (
          <span
            style={{
              fontWeight: 500,
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 220,
            }}
          >
            {note}
          </span>
        ) : (
          <span>Add a private note</span>
        )}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: t.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 4,
        }}
      >
        Note to self
      </label>
      <textarea
        ref={taRef}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => setValue(e.target.value)}
        onBlur={persist}
        rows={2}
        placeholder="e.g. met at the book club; dislikes loud bars"
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontFamily: t.sans,
          // ≥16px so iOS Safari doesn't auto-zoom on focus (WCAG-safe; no scale lock).
          fontSize: 16,
          color: t.text,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          padding: "8px 10px",
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: t.textMuted }}>
          {savedFlash ? "Saved. Only you can see this." : "Only you can see this."}
        </span>
        <Button
          variant="secondary"
          onClick={async () => { await persist(); setOpen(false); }}
          disabled={saving}
          style={{ padding: "6px 14px", fontSize: 14, cursor: saving ? "wait" : undefined }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function MatchCard({ match, busy, onOpen, plainLanguage, onViewProfile, onNoteSaved }) {
  const { otherUser, hasConversation } = match;
  // Optional first-prompt preview — only if it has an answer and no tagline/context
  // already filling the row, to keep the card calm and uncluttered.
  const firstPrompt = Array.isArray(otherUser.prompts)
    ? otherUser.prompts.find((p) => p && p.answer && p.answer.trim() && (p.promptText || p.promptKey))
    : null;
  const showPrompt =
    firstPrompt && !otherUser.tagline && !(otherUser.contextCard && otherUser.contextCard.trim());
  return (
    <li style={{ listStyle: "none", marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          padding: "14px 16px",
          boxShadow: "0 1px 4px rgba(36,51,45,0.05)",
        }}
      >
        <button
          type="button"
          onClick={() => onViewProfile && onViewProfile(otherUser.userId)}
          aria-label={`View ${otherUser.displayName || "this person"}'s profile`}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", borderRadius: "50%", flexShrink: 0 }}
        >
          <Avatar name={otherUser.displayName} userId={otherUser.userId} photoUrl={otherUser.photoUrl} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: t.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{otherUser.displayName || "Someone"}</span>
            {otherUser.pronouns && (
              <span style={{ fontSize: 13, fontWeight: 400, color: t.textMuted }}>{otherUser.pronouns}</span>
            )}
            {otherUser.verified && <VerifiedBadge />}
          </div>
          {otherUser.distCity && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>
              {otherUser.distCity}
            </div>
          )}
          {otherUser.tagline && (
            <div
              style={{
                fontSize: 14,
                color: t.textSoft,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {otherUser.tagline}
            </div>
          )}
          {otherUser.contextCard && otherUser.contextCard.trim() && (
            <div
              style={{
                fontSize: 13,
                color: t.textSoft,
                fontStyle: "italic",
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              “{otherUser.contextCard}”
            </div>
          )}
          {showPrompt && (
            <div style={{ marginTop: 4, overflow: "hidden" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: t.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {firstPrompt.promptText || firstPrompt.promptKey}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: t.text,
                  fontFamily: t.serif,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {firstPrompt.answer}
              </div>
            </div>
          )}
          <PrivateNote matchId={match.matchId} note={match.note} onSaved={onNoteSaved} />
        </div>
        <Button
          variant={hasConversation ? "secondary" : "primary"}
          onClick={() => onOpen(match)}
          disabled={busy}
          style={{ flexShrink: 0, cursor: busy ? "wait" : undefined }}
        >
          {busy ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Spectrum variant="loader" size={6} gap={3} />
              Starting…
            </span>
          ) : hasConversation ? "Open chat" : (plainLanguage ? "Send first message" : "Say hello")}
        </Button>
      </div>
    </li>
  );
}

// ─── Liked-you section ────────────────────────────────────────────────────────

// Small horizontal scroll of people who liked you (one-sided likes, no mutual match yet).
// Tapping the avatar or "Go to Discover" button takes you back to the Discover deck
// where they'll show up naturally in the candidate queue.
function LikedYouSection({ people, onGoDiscover, plainLanguage = false }) {
  if (!people || people.length === 0) return null;
  return (
    <section aria-labelledby="liked-you-heading" style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h2
          id="liked-you-heading"
          style={{ fontFamily: t.serif, fontSize: 18, fontWeight: 600, color: t.text, margin: 0 }}
        >
          Liked you
        </h2>
        <span
          aria-label={`${people.length} ${people.length === 1 ? "person" : "people"}`}
          style={{
            background: t.accentFill,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            borderRadius: 10,
            padding: "1px 8px",
            lineHeight: 1.6,
          }}
        >
          {people.length}
        </span>
      </div>
      <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px" }}>
        {people.length === 1 ? "1 person has" : `${people.length} people have`} expressed interest.
        {plainLanguage
          ? " Go to Discover to see them."
          : " Head to Discover to see them and decide at your own pace — no rush."}
      </p>
      {/* Horizontal scroll row of liked-you avatars */}
      <ul
        aria-label="People who liked you"
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          padding: "4px 0 12px",
          margin: 0,
          listStyle: "none",
          scrollbarWidth: "none",
        }}
      >
        {people.map((person) => (
          <li key={person.userId} style={{ flexShrink: 0, textAlign: "center", width: 72 }}>
            <Avatar
              name={person.displayName}
              userId={person.userId}
              photoUrl={person.photoUrl}
              size={64}
              style={{ margin: "0 auto 6px" }}
            />
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: t.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 72,
              }}
            >
              {person.displayName || "Someone"}
            </div>
            {person.age && (
              <div style={{ fontSize: 11, color: t.textMuted }}>{person.age}</div>
            )}
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onGoDiscover} style={{ width: "100%" }}>
        Go to Discover to meet them
      </Button>
    </section>
  );
}

export default function MatchesScreen({ onOpenConversation, onGoDiscover, onActivityCount, plainLanguage = false, reducedSensory = false }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  // Activity inbox — incoming likes (one-sided).
  const [incomingLikes, setIncomingLikes] = useState([]);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const loadMatches = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    getMatches()
      .then(setMatches)
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Keep the viewer's own note in sync after a save (owner-only, local state).
  const handleNoteSaved = useCallback((matchId, savedNote) => {
    setMatches((prev) => prev.map((m) => (m.matchId === matchId ? { ...m, note: savedNote } : m)));
  }, []);

  // Load activity inbox (incoming likes) — separate, best-effort
  useEffect(() => {
    let active = true;
    getActivity()
      .then(({ incomingLikes: likes }) => {
        if (!active) return;
        setIncomingLikes(likes);
        if (onActivityCount) onActivityCount(likes.length);
      })
      .catch(() => { /* best-effort; no error UI for the inbox section */ });
    return () => { active = false; };
  }, [onActivityCount]);

  async function handleOpen(match) {
    if (match.hasConversation && match.conversationId) {
      onOpenConversation(match.conversationId);
      return;
    }
    setBusyId(match.matchId);
    setError("");
    try {
      const res = await createConversation(match.matchId);
      const convId = res?.conversation?.id || res?.conversationId;
      if (convId) onOpenConversation(convId);
      else setError("Couldn't open the conversation. Please try again.");
    } catch (e) {
      // The conversation already exists (e.g. stale list / race): the server
      // returns 409 with the existing id — just open it instead of erroring.
      const existingId = e?.status === 409 && e?.body?.conversationId;
      if (existingId) {
        onOpenConversation(existingId);
      } else {
        setError(
          e?.code === "CAP_REACHED"
            ? "You've reached the limit of active conversations. Archive one from Messages to start a new chat."
            : e?.message || "Couldn't start the conversation. Please try again."
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 40px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };

  return (
    <div style={page}>
      {viewingUserId && (
        <MatchProfileModal userId={viewingUserId} onClose={() => setViewingUserId(null)} />
      )}
      <div style={shell}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: t.text, outline: "none" }}
        >
          Matches
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 15, color: t.textSoft }}>
          {plainLanguage
            ? "People you've both said yes to. Message them whenever you want."
            : "People you've both said yes to. Reach out whenever you're ready — there's no rush."}
        </p>

        {/* Activity inbox: people who liked you (one-sided) */}
        <LikedYouSection people={incomingLikes} onGoDiscover={onGoDiscover} plainLanguage={plainLanguage} />

        {error && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}

        {loading ? (
          <MatchesSkeleton />
        ) : loadFailed ? (
          <ErrorState
            title="Couldn't load your matches"
            message="Something went wrong on our end. Please try again."
            onRetry={loadMatches}
          />
        ) : matches.length === 0 ? (
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              padding: "28px 24px",
              textAlign: "center",
              color: t.textSoft,
            }}
          >
            {!reducedSensory && (
              <div style={{ marginBottom: 16 }}>
                <EmptyMatches size={104} />
              </div>
            )}
            {plainLanguage
              ? "No matches yet. Both you and the other person need to say yes in Discover. Only matches can message you."
              : "No matches yet. When you and someone both say you're interested in Discover, they'll appear here. Only people you've both matched with can message you."}
          </div>
        ) : (
          <>
            {matches.length > 0 && (
              <h2 style={{ fontFamily: t.serif, fontSize: 18, fontWeight: 600, color: t.text, margin: "0 0 14px" }}>
                Your matches
              </h2>
            )}
            <ul style={{ margin: 0, padding: 0 }}>
              {matches.map((m) => (
                <MatchCard
                  key={m.matchId}
                  match={m}
                  busy={busyId === m.matchId}
                  onOpen={handleOpen}
                  plainLanguage={plainLanguage}
                  onViewProfile={setViewingUserId}
                  onNoteSaved={handleNoteSaved}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
