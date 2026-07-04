import { useState, useEffect, useCallback, useRef } from "react";
import { t } from "./tokens.js";
import { getBestFits, swipe, createConversation, getUserId } from "./api.js";
import { useFocusable } from "./useFocusable.js";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import MatchMoment from "./MatchMoment.jsx";
import { isMutualReason, isCommNoteReason, sortReasonsMutualFirst } from "./discoverReasons.js";

// "Top Picks" — the first PAID (Spectrum Companion) surface
// (audit/MONETIZATION_STRATEGY.md §5 #4). A small, calm, curated shortlist of the
// viewer's highest-compatibility people, using the SAME honest compatibility
// scoring as the deck (no new "match %" vanity metric).
//
// PRODUCT LAW / the memo's hard red lines: this is a plain list the user can look
// at whenever. NO timer, NO countdown, NO expiry, NO "act now", NO counter, NO "X
// people viewed you", NO scarcity. A manual Refresh (re-fetch) is fine — never an
// auto-refreshing countdown. The paid gate lives on the BACKEND (requirePaid →
// 402); the lock here is UX only.
//
// A marker string used verbatim so the change is greppable in the live bundle.
// User-facing name is "Top Picks" (the code identifiers keep the best-fits name;
// only copy changed). The backend endpoint /matching/best-fits is unchanged.
const BEST_FITS_TITLE = "Top Picks";

// The current viewer's identity for the match moment (name/photo from the cached
// profile, id from auth) — mirrors SuggestionScreen.getViewerIdentity.
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

const cardStyle = {
  background: t.surface,
  border: `1px solid ${t.cardBorder}`,
  borderRadius: 16,
  padding: "20px 20px",
  boxShadow: t.shadow.sm,
  boxSizing: "border-box",
};

// ── Small focusable controls (each its own component — hooks-before-return law) ──

function BackButton({ onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.formBorder}`,
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
        background: t.green100,
        color: t.text,
        ...f.style,
      }}
    >
      {"← Back"}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "11px 20px",
        borderRadius: 11,
        border: `1px solid ${t.accentFill}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 16,
        fontWeight: 600,
        background: t.accentFill,
        color: "#fff",
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

function QuietButton({ children, onClick, disabled }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...f}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        border: `1px solid ${t.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 15,
        fontWeight: 600,
        background: t.surface,
        color: t.textSoft,
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// One "why you match" reason row — mirrors SuggestionScreen.WhyReason so the
// reasons read consistently across Discover and best-fits. Mutual "you both…"
// signals get the green ✓; one-sided context reads quieter.
function WhyReason({ reason }) {
  const mutual = isMutualReason(reason);
  return (
    <li style={{
      display: "flex",
      gap: 10,
      alignItems: "flex-start",
      marginBottom: 6,
      fontSize: 15,
      lineHeight: 1.5,
      color: mutual ? t.textSoft : t.textMuted,
    }}>
      <span
        aria-hidden="true"
        style={{ color: mutual ? t.accentStrong : t.textMuted, flexShrink: 0, marginTop: 1, fontWeight: 700 }}
      >
        {mutual ? "✓" : "·"}
      </span>
      <span style={{ minWidth: 0 }}>{reason}</span>
    </li>
  );
}

// One best-fit card. Actions reuse the EXISTING deck like/skip API (swipe) and
// the deck's match→conversation navigation — no parallel like flow. Its own
// component so the action buttons' useFocusable hooks stay unconditional.
function BestFitCard({ person, busy, onLike, onSkip }) {
  const reasons = sortReasonsMutualFirst((person.whyReasons || []).filter((r) => !isCommNoteReason(r))).slice(0, 3);
  const photo = Array.isArray(person.photos) && person.photos.length > 0
    ? person.photos[0]
    : (person.photoUrl ? { url: person.photoUrl } : null);
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
        {photo && photo.url ? (
          <img
            src={photo.url}
            alt={person.displayName}
            width={72}
            height={72}
            style={{ width: 72, height: 72, borderRadius: 14, objectFit: "cover", flexShrink: 0, background: t.surfaceAlt }}
          />
        ) : (
          <Avatar name={person.displayName} userId={person.memberId} size={72} style={{ flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            margin: 0, fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text,
            lineHeight: 1.2, minWidth: 0, overflowWrap: "anywhere",
          }}>
            {person.displayName}{typeof person.age === "number" ? `, ${person.age}` : ""}
            {person.verified && <VerifiedBadge style={{ marginLeft: 8, position: "relative", top: -2 }} />}
          </h3>
          {person.distCity && (
            <div style={{ fontSize: 14, color: t.textMuted, marginTop: 3, fontWeight: 500 }}>
              Near {person.distCity}
            </div>
          )}
        </div>
      </div>

      {reasons.length > 0 && (
        <div>
          <p style={{
            margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: t.textMuted,
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {reasons.some(isMutualReason) ? "Why you match" : "About them"}
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {reasons.map((r, i) => <WhyReason key={i} reason={r} />)}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PrimaryButton onClick={() => onLike(person)} disabled={busy}>
          {busy ? "One moment…" : "I'm interested"}
        </PrimaryButton>
        <QuietButton onClick={() => onSkip(person)} disabled={busy}>
          Not right now
        </QuietButton>
      </div>
    </div>
  );
}

// The calm locked panel for free (non-Companion) members. Feature description +
// an Upgrade link into the Membership screen. No shaming, no urgency.
function LockedPanel({ onUpgrade }) {
  return (
    <div style={{ ...cardStyle, background: t.surface }}>
      <h2 style={{ margin: "0 0 8px", fontFamily: t.serif, fontSize: 20, fontWeight: 700, color: t.text }}>
        {BEST_FITS_TITLE} is part of Spectrum Companion
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 15, color: t.textSoft, lineHeight: 1.6 }}>
        A small, calm shortlist of the people you're most compatible with — drawn
        from the same honest "why you match" scoring you already see in Discover.
        No ranking of you, no countdown, no pressure. Look whenever you like.
      </p>
      <p style={{ margin: "0 0 18px", fontSize: 14, color: t.textMuted, lineHeight: 1.6 }}>
        Matching, messaging, safety, and seeing who likes you always stay free.
        Companion only ever adds comfort and capability on top.
      </p>
      <PrimaryButton onClick={onUpgrade}>See Companion plans</PrimaryButton>
    </div>
  );
}

export default function BestFits({ onBack, onOpenConversation, onOpenMessages, tier = "free", plainLanguage = false }) {
  const isCompanion = tier === "companion";
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(isCompanion);
  const [loadError, setLoadError] = useState(false);
  const [locked, setLocked] = useState(!isCompanion);
  const [busyId, setBusyId] = useState(null);
  // Mutual-match overlay state (reuses the deck's MatchMoment + conversation flow).
  const [matchPerson, setMatchPerson] = useState(null);
  const [matchId, setMatchId] = useState(null);
  const headingRef = useRef(null);

  const load = useCallback(() => {
    // Reflect entitlement from app state — a free member never calls the endpoint
    // (the backend would 402 anyway); we show the locked panel directly.
    if (!isCompanion) {
      setLocked(true);
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    setLoadError(false);
    return getBestFits()
      .then((res) => {
        // A stale-tier caller can still hit the backend 402 → locked:true.
        setLocked(!!res.locked);
        setQueue(res.locked ? [] : res.bestFits);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [isCompanion]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const handleLike = useCallback(async (person) => {
    if (busyId) return;
    setBusyId(person.memberId);
    try {
      const result = await swipe(person.memberId, "like");
      // Remove from the list either way (calm — they've acted on this person).
      setQueue((q) => q.filter((p) => p.memberId !== person.memberId));
      if (result && result.matched) {
        setMatchPerson(person);
        setMatchId(result.matchId || null);
      }
    } catch {
      // Leave the card in place so the action is never silently lost.
    } finally {
      setBusyId(null);
    }
  }, [busyId]);

  const handleSkip = useCallback(async (person) => {
    if (busyId) return;
    setBusyId(person.memberId);
    setQueue((q) => q.filter((p) => p.memberId !== person.memberId));
    try {
      await swipe(person.memberId, "skip");
    } catch {
      // A skip that fails to persist is low-harm; the person may resurface later.
    } finally {
      setBusyId(null);
    }
  }, [busyId]);

  const closeMatch = useCallback(() => { setMatchPerson(null); setMatchId(null); }, []);

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 48px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };

  return (
    <div style={page}>
      <div style={shell}>
        <BackButton onClick={onBack} />

        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "18px 0 6px", color: t.text, outline: "none" }}
        >
          {BEST_FITS_TITLE}
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 15, color: t.textSoft, lineHeight: 1.6 }}>
          {locked
            ? "A calm, curated shortlist of the people you're most compatible with."
            : "A small, calm shortlist of the people you're most compatible with, using the same “why you match” scoring as Discover. There's no rush — look whenever you like."}
        </p>

        {locked ? (
          <LockedPanel onUpgrade={onBack} />
        ) : loading ? (
          <p style={{ fontSize: 15, color: t.textMuted }}>Finding your top picks…</p>
        ) : loadError ? (
          <div style={cardStyle}>
            <p style={{ margin: "0 0 12px", fontSize: 15, color: t.text }}>
              We couldn't load your top picks just now.
            </p>
            <QuietButton onClick={load}>Try again</QuietButton>
          </div>
        ) : queue.length === 0 ? (
          <div style={cardStyle}>
            <p style={{ margin: "0 0 6px", fontSize: 16, color: t.text, fontWeight: 600 }}>
              {plainLanguage ? "No top picks right now." : "Nothing new here right now."}
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: t.textSoft, lineHeight: 1.6 }}>
              You've seen your current top picks. As more people join, new ones will appear.
              There's nothing you need to do.
            </p>
            <QuietButton onClick={load}>Refresh</QuietButton>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {queue.map((person) => (
                <BestFitCard
                  key={person.memberId}
                  person={person}
                  busy={busyId === person.memberId}
                  onLike={handleLike}
                  onSkip={handleSkip}
                />
              ))}
            </div>
            {/* Calm manual refresh — a re-fetch, never a timer/countdown. */}
            <div style={{ marginTop: 18 }}>
              <QuietButton onClick={load}>Refresh your top picks</QuietButton>
            </div>
          </>
        )}
      </div>

      {/* Mutual match — reuse the deck's signature calm match moment + the exact
          conversation deep-link flow (createConversation → onOpenConversation). */}
      {matchPerson && (
        <MatchMoment
          you={getViewerIdentity()}
          them={{
            name: matchPerson.displayName,
            userId: matchPerson.memberId,
            photoUrl: matchPerson.photoUrl,
            pronouns: matchPerson.pronouns,
          }}
          onOpenChat={async () => {
            closeMatch();
            if (matchId && onOpenConversation) {
              const seedInfo = {
                otherUser: { userId: matchPerson.memberId, displayName: matchPerson.displayName, photoUrl: matchPerson.photoUrl },
                started: false,
              };
              try {
                const conv = await createConversation(matchId);
                const convId = conv?.conversationId || conv?.id;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              } catch (e) {
                const convId = e?.body?.conversationId;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              }
            }
            (onOpenMessages || (() => {}))();
          }}
          onContinue={closeMatch}
          plainLanguage={plainLanguage}
        />
      )}
    </div>
  );
}
