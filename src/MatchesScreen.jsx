import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { getMatches, createConversation, getActivity, saveMatchNote, safeErrorMessage, swipe, getUserId, unmatchConversation } from "./api.js";
import { useFocusable } from "./useFocusable.js";
import UnmatchSheet from "./messaging/UnmatchSheet.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import Skeleton from "./Skeleton.jsx";
import Button from "./Button.jsx";
import Spectrum from "./Spectrum.jsx";
import SpectrumMark from "./SpectrumMark.jsx";
import { EmptyMatches } from "./illustrations.jsx";
import ErrorState from "./ErrorState.jsx";
import MatchProfileModal from "./MatchProfileModal.jsx";
import MatchMoment from "./MatchMoment.jsx";
import ReportModal from "./ReportModal.jsx";

// Matches — people you and they have both said yes to. Separate from active
// conversations (Messages). Calm, low-pressure: no counters, no urgency.

// The current viewer's identity for the match moment — name/photo from the
// cached profile, id from auth. Best-effort; the monogram avatar degrades
// gracefully on a missing name.
function getViewerIdentity() {
  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem("spectrum_profile") || "{}") || {};
  } catch {
    profile = {};
  }
  return {
    name: profile.displayName || profile.name || "You",
    userId: getUserId() || profile.memberId || profile.userId || null,
    photoUrl: profile.photoUrl || profile.photo_url || null,
  };
}

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
              border: `1px solid ${t.cardBorder}`,
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
          maxWidth: "100%",
          background: "none",
          border: "none",
          padding: "8px 0",
          marginTop: 2,
          minHeight: 44,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: t.textMuted,
          textAlign: "left",
        }}
        aria-label={hasNote ? `Edit your private note: ${note}` : "Add a private note (only you can see it)"}
      >
        <span aria-hidden="true">🔒</span>
        {hasNote ? (
          // Explicit "Private note:" label so the value isn't mistaken for a
          // name or for the other person's words (their italic "In their words"
          // card looks similar). The note text stays italic; the label doesn't.
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>Private note:</span>{" "}
            <span style={{ fontWeight: 500, fontStyle: "italic" }}>{note}</span>
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
          border: `1px solid ${t.cardBorder}`,
          borderRadius: 10,
          padding: "8px 10px",
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
        <span role="status" aria-live="polite" style={{ fontSize: 12, color: t.textMuted }}>
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

// Quiet per-match "⋯" menu — safety actions must be reachable WITHOUT having
// to open a conversation first (block/report/unmatch straight from the card).
function MatchCardMenu({ name, onViewProfile, onReport, onUnmatch }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const f = useFocusable();

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    function onClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const itemStyle = {
    display: "block",
    width: "100%",
    padding: "12px 16px",
    background: "transparent",
    border: "none",
    textAlign: "left",
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: t.sans,
  };
  return (
    <span ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`More options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          color: t.textMuted,
          fontSize: 18,
          cursor: "pointer",
          padding: "4px 6px",
          borderRadius: 8,
          minHeight: 44,
          minWidth: 36,
          ...f.style,
        }}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Options for ${name}`}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: t.surface,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 12,
            boxShadow: t.shadow.md,
            zIndex: 300,
            minWidth: 190,
            overflow: "hidden",
          }}
        >
          <button role="menuitem" type="button" style={{ ...itemStyle, color: t.text, borderBottom: `1px solid ${t.borderLight}` }}
            onClick={() => { setOpen(false); onViewProfile(); }}>
            View profile
          </button>
          <button role="menuitem" type="button" style={{ ...itemStyle, color: t.danger, borderBottom: `1px solid ${t.borderLight}` }}
            onClick={() => { setOpen(false); onReport(); }}>
            Block or report
          </button>
          <button role="menuitem" type="button" style={{ ...itemStyle, color: t.textSoft }}
            onClick={() => { setOpen(false); onUnmatch(); }}>
            Unmatch
          </button>
        </div>
      )}
    </span>
  );
}

function MatchCard({ match, busy, onOpen, plainLanguage, onViewProfile, onNoteSaved, onReport, onUnmatch }) {
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
          border: `1px solid ${t.cardBorder}`,
          borderRadius: 16,
          padding: "14px 16px",
          boxShadow: t.shadow.sm,
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
          {/* Name gets its own line so it can NEVER be crushed to nothing by
              unshrinkable siblings (the old single-row flex collapsed the name
              and let pronouns + badge overflow into the Open button). */}
          <div style={{ fontSize: 17, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {otherUser.displayName || "Someone"}
          </div>
          {(otherUser.pronouns || otherUser.verified) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2, minWidth: 0 }}>
              {otherUser.pronouns && (
                <span style={{ fontSize: 13, fontWeight: 400, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{otherUser.pronouns}</span>
              )}
              {otherUser.verified && <span style={{ flexShrink: 0, display: "inline-flex" }}><VerifiedBadge /></span>}
            </div>
          )}
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
          {/* Density: show at most one secondary line — tagline takes precedence,
              so the context quote only appears when there's no tagline. */}
          {!otherUser.tagline && otherUser.contextCard && otherUser.contextCard.trim() && (
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
          aria-label={
            hasConversation
              ? `Open conversation with ${otherUser.displayName || "this person"}`
              : `Say hello to ${otherUser.displayName || "this person"}`
          }
          style={{ flexShrink: 0, cursor: busy ? "wait" : undefined }}
        >
          {busy ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Spectrum variant="loader" size={6} gap={3} />
              Starting…
            </span>
          ) : hasConversation ? "Open" : (plainLanguage ? "Send message" : "Say hello")}
        </Button>
        <MatchCardMenu
          name={otherUser.displayName || "this person"}
          onViewProfile={() => onViewProfile && onViewProfile(otherUser.userId)}
          onReport={() => onReport(match)}
          onUnmatch={() => onUnmatch(match)}
        />
      </div>
    </li>
  );
}

// ─── Liked-you section ────────────────────────────────────────────────────────

// People who have liked you (one-sided, no mutual match yet). This is where you
// ACT on them, calmly and at your own pace. Because they already like you,
// "I'm interested" completes the mutual match immediately (previously this sent
// you to Discover, which never surfaced the liker — a dead end). "Not right now"
// declines quietly, and each person can be blocked or reported. No swipe stack,
// no counters, no urgency.
function LikedYouSection({ people, plainLanguage = false, busyId, onInterested, onNotNow, onReport }) {
  if (!people || people.length === 0) return null;
  const linkStyle = {
    background: "none",
    border: "none",
    padding: "8px 4px",
    minHeight: 44,
    fontSize: 13,
    fontWeight: 600,
    color: t.textMuted,
    cursor: "pointer",
    fontFamily: t.sans,
  };
  return (
    <section aria-labelledby="liked-you-heading" style={{ marginBottom: 28 }}>
      <h2
        id="liked-you-heading"
        style={{ fontFamily: t.serif, fontSize: 18, fontWeight: 600, color: t.text, margin: "0 0 6px" }}
      >
        Liked you
      </h2>
      <p style={{ fontSize: 14, color: t.textSoft, margin: "0 0 14px" }}>
        {people.length === 1 ? "1 person has" : `${people.length} people have`} said they're interested in you.
        {plainLanguage
          ? " If you're interested too, say so and you'll match."
          : " If you feel the same, say you're interested — you'll match and can start chatting. There's no rush."}
      </p>
      <ul aria-label="People who liked you" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {people.map((person) => {
          const busy = busyId === person.userId;
          const name = person.displayName || "Someone";
          return (
            <li key={person.userId} style={{ marginBottom: 12 }}>
              <div
                style={{
                  background: t.surface,
                  border: `1px solid ${t.cardBorder}`,
                  borderRadius: 16,
                  padding: "14px 16px",
                  boxShadow: t.shadow.sm,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Avatar name={person.displayName} userId={person.userId} photoUrl={person.photoUrl} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    {person.age && <div style={{ fontSize: 13, color: t.textMuted }}>{person.age}</div>}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => onInterested(person)}
                    disabled={busy}
                    aria-label={`I'm interested in ${name}`}
                    style={{ flexShrink: 0, cursor: busy ? "wait" : undefined }}
                  >
                    {busy ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Spectrum variant="loader" size={6} gap={3} />
                        …
                      </span>
                    ) : (plainLanguage ? "Yes" : "I'm interested")}
                  </Button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginLeft: 66 }}>
                  <button type="button" style={linkStyle} disabled={busy} onClick={() => onNotNow(person)}>
                    Not right now
                  </button>
                  <span aria-hidden="true" style={{ color: t.borderLight }}>·</span>
                  <button type="button" style={linkStyle} onClick={() => onReport(person)}>
                    Block or report
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function MatchesScreen({ onOpenConversation, onActivityCount, plainLanguage = false, reducedSensory = false }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  // Activity inbox — incoming likes (one-sided).
  const [incomingLikes, setIncomingLikes] = useState([]);
  // Liked-you action state: which liker is mid-request, the mutual-match moment
  // to celebrate, and the person being blocked/reported.
  const [likerBusyId, setLikerBusyId] = useState(null);
  const [matchMoment, setMatchMoment] = useState(null);
  const [reportingLiker, setReportingLiker] = useState(null);
  // Safety actions on an existing match (from the card's ⋯ menu).
  const [reportingMatch, setReportingMatch] = useState(null);
  const [unmatchingMatch, setUnmatchingMatch] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
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

  // Drop a liker from the inbox and keep the tab badge in sync.
  const removeLiker = useCallback((userId) => {
    setIncomingLikes((prev) => {
      const next = prev.filter((p) => p.userId !== userId);
      if (onActivityCount) onActivityCount(next.length);
      return next;
    });
  }, [onActivityCount]);

  // "I'm interested" on a liker. They already liked us, so this like completes
  // the mutual match — celebrate with the MatchMoment, then drop them from the
  // inbox. (If they withdrew their like in the meantime, it just resolves quietly.)
  async function handleLikeBack(person) {
    if (likerBusyId) return;
    setLikerBusyId(person.userId);
    setError("");
    try {
      const result = await swipe(person.userId, "like");
      if (result && result.matched) {
        setMatchMoment({
          them: { name: person.displayName, userId: person.userId, photoUrl: person.photoUrl },
          matchId: result.matchId || null,
        });
      } else {
        setError(`${person.displayName || "They"} isn't available anymore.`);
      }
      removeLiker(person.userId);
    } catch (e) {
      setError(safeErrorMessage(e, "Couldn't save that just now. Please try again."));
    } finally {
      setLikerBusyId(null);
    }
  }

  // "Not right now" — decline a liker quietly (a skip); low-harm on failure.
  async function handleDismissLiker(person) {
    if (likerBusyId) return;
    setLikerBusyId(person.userId);
    try {
      await swipe(person.userId, "skip");
    } catch (e) {
      console.warn("Dismiss liker failed", e);
    }
    removeLiker(person.userId);
    setLikerBusyId(null);
  }

  // Unmatch from the card menu — same server action as unmatching from a
  // conversation (removes match + conversation; the other person isn't told).
  async function handleUnmatchConfirm() {
    const m = unmatchingMatch;
    setUnmatchingMatch(null);
    if (!m) return;
    try {
      await unmatchConversation(m.matchId);
    } catch (e) {
      console.warn("Unmatch failed", e);
    }
    setMatches((prev) => prev.filter((x) => x.matchId !== m.matchId));
    setStatusMessage(`You unmatched ${m.otherUser?.displayName || "this person"}.`);
  }

  async function handleOpen(match) {
    if (match.hasConversation && match.conversationId) {
      // Seed the thread so it opens instantly (no list-fetch wait).
      onOpenConversation(match.conversationId, { otherUser: match.otherUser, started: true });
      return;
    }
    setBusyId(match.matchId);
    setError("");
    try {
      const res = await createConversation(match.matchId);
      const convId = res?.conversation?.id || res?.conversationId;
      if (convId) onOpenConversation(convId, { otherUser: match.otherUser, started: false });
      else setError("Couldn't open the conversation. Please try again.");
    } catch (e) {
      // The conversation already exists (e.g. stale list / race): the server
      // returns 409 with the existing id — just open it instead of erroring.
      const existingId = e?.status === 409 && e?.body?.conversationId;
      if (existingId) {
        onOpenConversation(existingId, { otherUser: match.otherUser, started: true });
      } else {
        setError(
          e?.code === "CAP_REACHED"
            ? "You've reached your active conversations for now. Archive one from Messages to start a new one."
            : safeErrorMessage(e, "Couldn't start the conversation. Please try again.")
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
      {/* Mutual match from liking someone back — the same calm celebration as
          Discover, deep-linking straight into the new conversation. */}
      {matchMoment && (
        <MatchMoment
          you={getViewerIdentity()}
          them={matchMoment.them}
          plainLanguage={plainLanguage}
          onOpenChat={async () => {
            const mm = matchMoment;
            setMatchMoment(null);
            loadMatches();
            if (mm.matchId) {
              const seedInfo = {
                otherUser: { userId: mm.them.userId, displayName: mm.them.name, photoUrl: mm.them.photoUrl },
                started: false,
              };
              try {
                const conv = await createConversation(mm.matchId);
                const convId = conv?.conversation?.id || conv?.conversationId || conv?.id;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              } catch (e) {
                const convId = e?.status === 409 && e?.body?.conversationId;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              }
            }
          }}
          onContinue={() => { setMatchMoment(null); loadMatches(); }}
        />
      )}
      {/* Calm block/report on a person who liked you (reused from Discover). */}
      {reportingLiker && (
        <ReportModal
          candidate={{ memberId: reportingLiker.userId, displayName: reportingLiker.displayName }}
          onClose={() => setReportingLiker(null)}
          onBlocked={(c) => removeLiker(c.memberId)}
        />
      )}
      {/* Block/report an existing match from the card's ⋯ menu. */}
      {reportingMatch && (
        <ReportModal
          candidate={{ memberId: reportingMatch.otherUser.userId, displayName: reportingMatch.otherUser.displayName }}
          onClose={() => setReportingMatch(null)}
          onBlocked={() => {
            setMatches((prev) => prev.filter((x) => x.matchId !== reportingMatch.matchId));
            setStatusMessage(`You blocked ${reportingMatch.otherUser?.displayName || "this person"}.`);
          }}
        />
      )}
      {/* Unmatch confirm — same calm sheet as in a conversation. */}
      {unmatchingMatch && (
        <UnmatchSheet
          displayName={unmatchingMatch.otherUser?.displayName || "this person"}
          onConfirm={handleUnmatchConfirm}
          onCancel={() => setUnmatchingMatch(null)}
        />
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

        {/* Activity inbox: people who liked you (one-sided) — act in place */}
        <LikedYouSection
          people={incomingLikes}
          plainLanguage={plainLanguage}
          busyId={likerBusyId}
          onInterested={handleLikeBack}
          onNotNow={handleDismissLiker}
          onReport={setReportingLiker}
        />

        {error && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}
        {statusMessage && (
          <p role="status" style={{ color: t.textSoft, fontSize: 14, marginBottom: 16 }}>
            {statusMessage}
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
              border: `1px solid ${t.cardBorder}`,
              borderRadius: 16,
              padding: "28px 24px",
              textAlign: "center",
              color: t.textSoft,
            }}
          >
            {/* Low-stimulation swaps the illustration for the static brand
                mark — quieter, but never a bare sentence in a box. */}
            <div style={{ marginBottom: 16 }}>
              {reducedSensory ? <SpectrumMark height={10} /> : <EmptyMatches size={104} />}
            </div>
            {plainLanguage
              ? "No matches yet. Both you and the other person need to say yes in Discover. Only matches can message you."
              : "No matches yet. When you and someone both say you're interested in Discover, they'll appear here. Only people you've both matched with can message you."}
          </div>
        ) : (
          <>
            {matches.length > 0 && (
              <>
                {/* Quiet brand divider between the liked-you inbox and the list. */}
                {incomingLikes.length > 0 && !reducedSensory && (
                  <Spectrum variant="divider" style={{ margin: "4px 0 24px" }} />
                )}
                <h2 style={{ fontFamily: t.serif, fontSize: 20, fontWeight: 600, color: t.text, margin: "0 0 14px" }}>
                  Your matches
                </h2>
              </>
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
                  onReport={setReportingMatch}
                  onUnmatch={setUnmatchingMatch}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
