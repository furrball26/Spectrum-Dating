import { useState, useEffect, useRef, useCallback } from "react";
import { t } from "./tokens.js";
import { getActivity, swipe, createConversation, safeErrorMessage } from "./api.js";
import LikedYouSection from "./LikedYouSection.jsx";
import MatchMoment from "./MatchMoment.jsx";
import ReportModal from "./ReportModal.jsx";
import Skeleton from "./Skeleton.jsx";
import SpectrumMark from "./SpectrumMark.jsx";
import { EmptyMatches } from "./illustrations.jsx";
import { getViewerIdentity } from "./viewerIdentity.js";
import { useViewport } from "./useViewport.js";

// Likes — the decision queue: people who said they're interested in you.
// (Phase 2 of the Matches/Messages merge: everyone you've MATCHED with now
// lives in Messages; this tab holds only the incoming likes awaiting your
// answer.) Calm-by-design: no counters in the page, no urgency, decisions at
// your own pace, block/report reachable per person.
export default function LikesScreen({ onOpenConversation, onActivityCount, plainLanguage = false, reducedSensory = false }) {
  const [incomingLikes, setIncomingLikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [likerBusyId, setLikerBusyId] = useState(null);
  const [matchMoment, setMatchMoment] = useState(null);
  const [reportingLiker, setReportingLiker] = useState(null);
  const headingRef = useRef(null);
  const viewport = useViewport();
  const isMobile = viewport === "mobile";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const loadLikes = useCallback(() => {
    getActivity()
      .then(({ incomingLikes: likes }) => {
        setIncomingLikes(likes);
        if (onActivityCount) onActivityCount(likes.length);
      })
      .catch(() => { /* quiet — the empty state stays calm */ })
      .finally(() => setLoading(false));
  }, [onActivityCount]);

  useEffect(() => {
    loadLikes();
  }, [loadLikes]);

  const removeLiker = useCallback((userId) => {
    setIncomingLikes((prev) => {
      const next = prev.filter((p) => p.userId !== userId);
      if (onActivityCount) onActivityCount(next.length);
      return next;
    });
  }, [onActivityCount]);

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

  async function handleDismissLiker(person) {
    if (likerBusyId) return;
    setLikerBusyId(person.userId);
    try { await swipe(person.userId, "skip"); } catch (e) { console.warn("Dismiss liker failed", e); }
    removeLiker(person.userId);
    setLikerBusyId(null);
  }

  const page = {
    minHeight: "100%",
    // DT-3: on tablet/desktop this screen sits inside App's surface "panel", so
    // painting its own bgGradient here double-paints — short content left a
    // stark band of the panel's surface showing beneath (worst in Light). Go
    // transparent to inherit the panel; mobile keeps its full-bleed gradient.
    background: isMobile ? t.bgGradient : "transparent",
    color: t.text,
    fontFamily: t.sans,
    fontSize: 16,
    lineHeight: 1.6,
    padding: "20px 16px 40px",
    boxSizing: "border-box",
  };

  return (
    <div style={page}>
      {matchMoment && (
        <MatchMoment
          you={getViewerIdentity()}
          them={matchMoment.them}
          plainLanguage={plainLanguage}
          onOpenChat={async () => {
            const mm = matchMoment;
            setMatchMoment(null);
            if (mm.matchId && onOpenConversation) {
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
                if (convId) { onOpenConversation(convId, { ...seedInfo, started: true }); return; }
              }
            }
          }}
          onContinue={() => setMatchMoment(null)}
        />
      )}
      {reportingLiker && (
        <ReportModal
          candidate={{ memberId: reportingLiker.userId, displayName: reportingLiker.displayName }}
          onClose={() => setReportingLiker(null)}
          onBlocked={(c) => removeLiker(c.memberId)}
        />
      )}
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto" }}>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 700, margin: "0 0 6px", color: t.text, outline: "none" }}
        >
          Likes
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 16, color: t.textSoft }}>
          {plainLanguage
            ? "People who said yes to you. If you say yes too, you match — then you can message each other."
            : "People who've said they're interested in you. If you feel the same, say so — you'll match and can chat in Messages. There's no rush."}
        </p>

        {error && (
          <p role="alert" style={{ color: t.danger, fontSize: 14, marginBottom: 16 }}>
            {error}
          </p>
        )}

        {loading ? (
          <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton width="100%" height={84} radius={16} />
            <Skeleton width="100%" height={84} radius={16} />
          </div>
        ) : incomingLikes.length === 0 ? (
          <div
            style={{
              background: t.surface,
              border: `1px solid ${t.cardBorder}`,
              borderRadius: 16,
              padding: "28px 24px",
              textAlign: "center",
              color: t.textSoft,
              boxShadow: t.shadow.sm,
            }}
          >
            <div style={{ marginBottom: 16 }}>
              {reducedSensory ? <SpectrumMark height={10} /> : <EmptyMatches size={104} />}
            </div>
            {plainLanguage
              ? "No new likes right now. When someone says yes to you, they'll appear here."
              : "No new likes right now. When someone says they're interested in you, they'll appear here — take your time."}
          </div>
        ) : (
          <LikedYouSection
            people={incomingLikes}
            plainLanguage={plainLanguage}
            busyId={likerBusyId}
            onInterested={handleLikeBack}
            onNotNow={handleDismissLiker}
            onReport={setReportingLiker}
          />
        )}
      </div>
    </div>
  );
}
