import { useState, useRef, useEffect, useCallback } from "react";
import { getCandidates, swipe, getProfile, updateProfile, undoSkip, undoLike, getUserId, createConversation } from "./api.js";
import { t } from "./tokens.js";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import MatchMoment from "./MatchMoment.jsx";
import DiscoverFilters from "./DiscoverFilters.jsx";
import { AllCaughtUp } from "./illustrations.jsx";
import SpectrumMark from "./SpectrumMark.jsx";
import ReportModal from "./ReportModal.jsx";
import { useFocusable } from "./useFocusable.js";

// The current viewer's identity for the match moment — name/photo from the
// cached profile, id from auth. Best-effort: the monogram avatar degrades
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

// Suggestion screen — autism-friendly dating platform.
// Built to docs/specs/matching.md + docs/architecture/matching-a11y.md
// + docs/design-system.md. Every interaction rule below maps to a checklist item.

// Current viewer's interests — read from saved profile; falls back to demo defaults.
function getViewerInterests() {
  try {
    const profile = JSON.parse(localStorage.getItem("spectrum_profile") || "{}");
    return Array.isArray(profile.interests) && profile.interests.length > 0
      ? profile.interests
      : ["board games", "quiet evenings", "hiking"];
  } catch {
    return ["board games", "quiet evenings", "hiking"];
  }
}



function ActionButton({ label, kind, onClick, icon, ariaLabel, disabled }) {
  const f = useFocusable();
  const base = {
    minHeight: kind === "skip" ? 44 : 52,
    minWidth: 44,
    padding: kind === "skip" ? "10px 24px" : "14px 24px",
    borderRadius: 14,
    fontSize: kind === "skip" ? 15 : 17,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    letterSpacing: "0.01em",
  };
  const kinds = {
    interested: { background: t.accentFill, color: "#fff", border: `1px solid ${t.accentFill}` },
    notnow:     { background: t.surface,   color: t.text, border: `1px solid ${t.border}` },
    skip:       { background: "transparent", color: t.textSoft, border: "none", textDecoration: "underline" },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || undefined}
      style={{ ...base, ...kinds[kind], ...f.style, ...(disabled ? { cursor: "not-allowed", opacity: 0.6 } : null) }}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
    >
      {icon && <span aria-hidden="true" style={{ fontSize: 16 }}>{icon}</span>}
      {label}
    </button>
  );
}

function Divider() {
  return <div aria-hidden="true" style={{ height: 1, background: t.borderLight, margin: "20px 0" }} />;
}

function InterestPills({ interests, viewerInterests }) {
  const viewerSet = new Set(viewerInterests);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="list" aria-label="Interests">
      {interests.map((interest) => {
        const shared = viewerSet.has(interest);
        return (
          <span
            key={interest}
            role="listitem"
            aria-label={shared ? `${interest} — shared interest` : interest}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 13px",
              borderRadius: 24,
              fontSize: 14,
              fontWeight: shared ? 600 : 400,
              background: shared ? t.accentFill : t.surfaceAlt,
              color: shared ? "#fff" : t.textSoft,
              border: `1px solid ${shared ? t.accentFill : t.border}`,
              letterSpacing: shared ? "0.01em" : 0,
            }}
          >
            {shared && <span aria-hidden="true" style={{ fontSize: 10 }}>✦</span>}
            {interest}
          </span>
        );
      })}
    </div>
  );
}

// "How I communicate" — a tidy, low-stimulation row of chips for the moat
// comms/sensory prefs. Only set values render; we intentionally skip the noisy
// "either"/"whenever" values to keep a calm 2–4 chip row.
// Note: the free-text "In their words" context card is intentionally NOT shown
// here — it's withheld from non-matched strangers (the backend stops sending it
// pre-match) and only appears post-match in Matches / profile.
function commStyleChips(person) {
  const chips = [];
  if (person.commDirectness === "direct") chips.push("Direct");
  if (person.commDirectness === "softened") chips.push("Softened");
  if (person.commLiteral === "literal") chips.push("Literal");
  if (person.commLiteral === "playful") chips.push("Playful");
  if (person.commCadence === "instant") chips.push("Quick replies");
  if (person.commCadence === "daily") chips.push("Replies once a day");
  // commCadence "whenever" intentionally skipped (low signal)
  if (person.sensoryEnvironment === "quiet") chips.push("Quiet settings");
  if (person.sensoryEnvironment === "lively") chips.push("Lively settings");
  // sensoryEnvironment "either" intentionally skipped
  if (person.sensoryLighting === "dim") chips.push("Dim lighting");
  if (person.sensoryLighting === "bright") chips.push("Bright lighting");
  // sensoryLighting "either" intentionally skipped
  if (person.socialDuration === "short") chips.push("Short meetups");
  if (person.socialDuration === "long") chips.push("Longer meetups");
  // socialDuration "medium" intentionally skipped (low signal)
  return chips;
}

function CommStyleArea({ person }) {
  const chips = commStyleChips(person);
  if (chips.length === 0) return null;

  return (
    <div style={{ marginTop: 0 }}>
      <h2 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>
        How I communicate
      </h2>
      <ul
        role="list"
        aria-label="Communication and sensory preferences"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none" }}
      >
        {chips.map((label) => (
          <li
            key={label}
            role="listitem"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "5px 13px",
              borderRadius: 24,
              fontSize: 14,
              fontWeight: 400,
              background: t.surface,
              color: t.textSoft,
              border: `1px solid ${t.border}`,
            }}
          >
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Hinge-style prompt cards: a small muted label (the prompt) with the answer
// shown prominently below in serif. Only rendered when there are prompts.
function PromptCards({ prompts }) {
  const valid = (prompts || []).filter(
    (p) => p && p.answer && p.answer.trim() && (p.promptText || p.promptKey)
  );
  if (valid.length === 0) return null;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 16 }}>
      {valid.map((p, i) => (
        <li key={p.promptKey || i}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 13,
              fontWeight: 600,
              color: t.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              lineHeight: 1.4,
            }}
          >
            {p.promptText || p.promptKey}
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: t.serif,
              fontSize: 20,
              fontWeight: 700,
              color: t.text,
              lineHeight: 1.4,
            }}
          >
            {p.answer}
          </p>
        </li>
      ))}
    </ul>
  );
}


// F24 — a calm, persistent reminder that the viewer's own profile is paused.
// Browsing still works; this just surfaces the otherwise-invisible fact that
// they won't appear to others, with a gentle route to unpause. Low-key styling
// (neutral surface, no red/alarm), matching the app's other soft banners.
function PausedBanner({ onGoToProfile, plainLanguage = false }) {
  return (
    <div
      role="status"
      style={{
        background: t.surfaceAlt,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        marginBottom: 16,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        justifyContent: "space-between",
      }}
    >
      <p style={{ margin: 0, color: t.textSoft, fontSize: 16, lineHeight: 1.55, flex: "1 1 220px" }}>
        {plainLanguage ? (
          <>Your profile is <strong style={{ color: t.text, fontWeight: 600 }}>paused</strong>. Other people can't see you and you don't appear in Discover. You can still look around. You can turn it back on anytime.</>
        ) : (
          <>Your profile is <strong style={{ color: t.text, fontWeight: 600 }}>paused</strong> — you won't appear in Discover, and others can't see you. You can still look around. Unpause anytime.</>
        )}
      </p>
      {onGoToProfile && (
        <button
          type="button"
          onClick={onGoToProfile}
          style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 999,
            color: t.accentStrong,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            padding: "8px 16px",
            minHeight: 44,
            whiteSpace: "nowrap",
          }}
        >
          {plainLanguage ? "Go to profile" : "Unpause in Profile"}
        </button>
      )}
    </div>
  );
}

export default function SuggestionScreen({ onOpenMessages, onOpenConversation, onGoToProfile, plainLanguage = false, reducedSensory = false }) {
  const [viewerInterests, setViewerInterests] = useState(() => getViewerInterests());
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [index, setIndex] = useState(0);
  // stage: 'viewing' | 'confirmed' | 'done'
  const [stage, setStage] = useState("viewing");
  const [lastChoice, setLastChoice] = useState(null);
  const [lastPerson, setLastPerson] = useState(null);
  const [mutual, setMutual] = useState(false);
  const [matchId, setMatchId] = useState(null);
  const [reportingCandidate, setReportingCandidate] = useState(null);
  const [undoing, setUndoing] = useState(false);
  // F16 — when an "I'm interested" undo is refused because the like already
  // became a mutual match (409 matched:true), we hide the Undo and show a calm
  // "you can unmatch from the conversation instead" message. `undoneLike` marks
  // a like that was successfully undone so we hide the affordance (ok:false or
  // ok:true both resolve to "nothing more to undo here").
  const [undoLikeBlocked, setUndoLikeBlocked] = useState(false);
  const [likeUndone, setLikeUndone] = useState(false);
  // In-flight guard against double-submit, and a calm retry surface for a
  // failed "I'm interested" swipe (the one choice we must not silently lose).
  const [submitting, setSubmitting] = useState(false);
  const [swipeFailed, setSwipeFailed] = useState(null);
  // F18 — in-context Discover filters. `filterInitial` pre-fills the sheet from
  // the current profile's filter fields; `applyingFilters` drives a calm loading
  // state while we persist + re-fetch the deck.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [applyingFilters, setApplyingFilters] = useState(false);
  // F22 — distinguish "zero candidates from the start" from "exhausted after
  // viewing people". A fresh load that returns 0 sets this true; any load with
  // results (or once the user has advanced) leaves it false so the exhausted
  // state shows the friendlier "all caught up" copy.
  const [deckEmptyFromStart, setDeckEmptyFromStart] = useState(false);
  // F24 — the viewer's own paused flag, seeded from the profile fetch. When
  // true we show a calm, persistent banner atop Discover (browsing still works).
  const [paused, setPaused] = useState(false);
  const [filterInitial, setFilterInitial] = useState({
    prefAgeMin: 18,
    prefAgeMax: 99,
    searchRadiusMiles: 0,
    seeking: "",
    distanceCity: "",
  });
  const liveRef = useRef(null);
  const doneHeadingRef = useRef(null);
  const endHeadingRef = useRef(null);

  // Fetch fresh viewer interests from API on mount; fall back to localStorage cache
  useEffect(() => {
    getProfile()
      .then(profile => {
        if (Array.isArray(profile.interests) && profile.interests.length > 0) {
          setViewerInterests(profile.interests);
        }
        // F24 — reflect the paused flag so Discover can show the reminder banner.
        setPaused(!!profile.paused);
        // Seed the Filters sheet from the live profile. The GET returns the
        // coarse city as `distCity`; the filter fields keep their profile keys.
        setFilterInitial({
          prefAgeMin: profile.prefAgeMin ?? 18,
          prefAgeMax: profile.prefAgeMax ?? 99,
          searchRadiusMiles: profile.searchRadiusMiles ?? 0,
          seeking: profile.seeking || "",
          distanceCity: profile.distCity || profile.distanceCity || "",
        });
      })
      .catch(() => {
        // Silently fall back to the localStorage-seeded initial value
      });
  }, []);

  // Fetch candidates and reset the deck to the top. Reused on mount and after Undo.
  const loadCandidates = useCallback(() => {
    return getCandidates()
      .then(candidates => {
        // Backend returns array directly (not {candidates: [...]})
        const arr = Array.isArray(candidates) ? candidates : [];
        // F22 — remember when a fresh deck comes back completely empty, so the
        // exhausted view can tell "nobody matches your filters" apart from
        // "you've now seen everyone". Any load with results clears the flag.
        setDeckEmptyFromStart(arr.length === 0);
        // Map to the shape the component expects
        setQueue(arr.map(c => ({
          memberId: c.memberId,
          displayName: c.displayName,
          pronouns: c.pronouns || '',
          age: c.age || null,
          tagline: c.tagline || '',
          bio: c.bio || '',
          interests: c.interests || [],
          communicationNote: c.commNote || '',
          whyReasons: c.whyReasons || [],
          distanceLabel: c.distCity ? `Near ${c.distCity}` : null,
          relationshipGoal: c.relationshipGoal || '',
          sharedInterests: c.sharedInterests || [],
          photoUrl: c.photoUrl || c.photo_url || null,
          verified: !!c.verified,
          commDirectness: c.commDirectness || '',
          commLiteral: c.commLiteral || '',
          commCadence: c.commCadence || '',
          sensoryEnvironment: c.sensoryEnvironment || '',
          sensoryLighting: c.sensoryLighting || '',
          socialDuration: c.socialDuration || '',
          contextCard: c.contextCard || '',
          photoDescription: c.photoDescription || '',
          prompts: Array.isArray(c.prompts) ? c.prompts : [],
        })));
        setIndex(0);
      });
  }, []);

  useEffect(() => {
    loadCandidates()
      .catch(() => setLoadError('Could not load suggestions. Please check your connection.'))
      .finally(() => setLoading(false));
  }, [loadCandidates]);

  // F18 — persist changed filter fields to the profile, then re-fetch the deck
  // so results update immediately (not behind the profile Save). `changed` only
  // carries fields that actually differ, so a no-op Apply skips the PUT.
  const handleApplyFilters = useCallback(async (changed) => {
    setApplyingFilters(true);
    // Optimistically fold the new values into the sheet's seed so a re-open
    // reflects them even if the caller closes and reopens quickly.
    setFilterInitial(prev => ({ ...prev, ...changed }));
    try {
      if (changed && Object.keys(changed).length > 0) {
        await updateProfile(changed);
      }
      await loadCandidates();
      // Land the user back on a fresh deck rather than a stale confirmation.
      setMutual(false);
      setMatchId(null);
      setLastChoice(null);
      setLastPerson(null);
      setSwipeFailed(null);
      setStage("viewing");
    } catch (e) {
      // A failed apply shouldn't strand the user — log and keep the deck as-is.
      console.warn("Applying filters failed", e);
    } finally {
      setApplyingFilters(false);
      setFiltersOpen(false);
    }
  }, [loadCandidates]);

  const person = queue[index];
  const atEnd = index >= queue.length;

  // Perceived-speed: warm the next 1–2 candidates' hero photos so the next card
  // doesn't stall on a fresh fetch after a swipe. The deck advances by dropping
  // the current person (queue.slice(1) + setIndex(0)), so the upcoming heroes are
  // queue[index+1] / queue[index+2]. new Image().src kicks off a background fetch
  // that the browser HTTP cache reuses when the <img> mounts. Cancel-safe: we
  // detach handlers and drop refs on cleanup so nothing fires after unmount.
  useEffect(() => {
    const preloaders = [];
    for (let ahead = 1; ahead <= 2; ahead++) {
      const url = queue[index + ahead]?.photoUrl;
      if (!url) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      preloaders.push(img);
    }
    return () => {
      // Drop references; browsers keep any in-flight fetch warming the HTTP cache.
      preloaders.forEach((img) => { img.onload = null; img.onerror = null; img.src = ""; });
    };
  }, [queue, index]);

  // Move focus to confirmation so screen-reader + keyboard users land on new state (4.1.3).
  useEffect(() => {
    if (stage === "confirmed" && liveRef.current) liveRef.current.focus();
  }, [stage]);

  useEffect(() => {
    if (stage === "done" && doneHeadingRef.current) {
      doneHeadingRef.current.focus();
    }
  }, [stage]);

  useEffect(() => {
    if (atEnd && endHeadingRef.current) {
      endHeadingRef.current.focus();
    }
  }, [atEnd]);

  async function handleInterested() {
    // Explicit action only — never triggered by focus, hover, or scroll (3.2.1 / 3.2.2).
    if (submitting) return; // in-flight guard against double-submit
    const current = queue[index];
    if (!current) return;
    setSubmitting(true);
    setSwipeFailed(null);
    // Do NOT advance the deck optimistically here: on a mutual match the result
    // flips us to the MatchMoment overlay, and advancing first would briefly
    // render the NEXT candidate's viewing card in the gap before the awaited
    // result resolves (the match-moment flash). Instead we keep `current` in
    // place during the in-flight request and only advance once the like
    // succeeds. On failure the card is still current, so E9 retry can re-fire.
    setLastChoice("interested");
    setLastPerson(current);
    try {
      const result = await swipe(current.memberId, 'like');
      // Advance the deck only after the like resolves. On a match this happens
      // in the same tick as the stage flip, so the confirmed/MatchMoment view
      // replaces the current card with no flash of the next person.
      setQueue(q => q.slice(1));
      setIndex(0);
      if (result.matched) {
        setMutual(true);
        setMatchId(result.matchId || null);
      }
      setStage("confirmed");
    } catch {
      // The candidate never left the front of the deck, so nothing to restore —
      // just surface a calm retry so the "I'm interested" is never lost. Stay on
      // the viewing stage.
      setSwipeFailed(current);
      setLastChoice(null);
      setLastPerson(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNotNow() {
    // Explicit action only — never triggered by focus, hover, or scroll (3.2.1 / 3.2.2).
    if (submitting) return; // in-flight guard against double-submit
    const current = queue[index];
    if (!current) return;
    setSubmitting(true);
    setLastChoice("not_now");
    setLastPerson(current);
    setQueue(q => q.slice(1));
    setIndex(0);
    try {
      await swipe(current.memberId, 'skip');
    } catch (e) {
      // A skip that fails to persist is low-harm (the person may simply reappear
      // later), so we don't block the flow — but log it rather than swallow.
      console.warn('Skip (not now) failed to persist', e);
    } finally {
      setSubmitting(false);
    }
    setStage("confirmed");
  }

  async function handleSkip() {
    // Explicit action only — never triggered by focus, hover, or scroll (3.2.1 / 3.2.2).
    if (submitting) return; // in-flight guard against double-submit
    const current = queue[index];
    if (!current) return;
    setSubmitting(true);
    setLastChoice("skip");
    setLastPerson(current);
    setQueue(q => q.slice(1));
    setIndex(0);
    try {
      await swipe(current.memberId, 'skip');
    } catch (e) {
      // Skip is low-harm on failure; log rather than swallow silently.
      console.warn('Skip failed to persist', e);
    } finally {
      setSubmitting(false);
    }
    setStage("confirmed");
  }

  // Retry a previously-failed "I'm interested" swipe from the viewing stage.
  async function handleRetryInterested() {
    setSwipeFailed(null);
    await handleInterested();
  }

  function next() {
    setMutual(false);
    setMatchId(null);
    setLastChoice(null);
    setLastPerson(null);
    setSwipeFailed(null);
    setUndoLikeBlocked(false);
    setLikeUndone(false);
    setStage("viewing");
  }

  // Undo the last skip: ask the backend to restore the candidate, then put that
  // person back at the FRONT of the current deck — preserving the user's place
  // instead of rebuilding the whole deck from the top. A no-op (ok:false) is
  // handled quietly — we simply return to viewing without fuss.
  async function handleUndo() {
    if (undoing) return;
    setUndoing(true);
    const restored = lastPerson;
    try {
      const result = await undoSkip();
      if (result && result.ok && restored) {
        setQueue(q => (q.some(c => c.memberId === restored.memberId) ? q : [restored, ...q]));
        setIndex(0);
      }
    } catch {
      // Network hiccup — stay calm, just resume viewing the deck.
    } finally {
      setUndoing(false);
      next();
    }
  }

  // F16 — undo the last "I'm interested". Symmetrical with handleUndo (skip):
  // in-flight guard, restore the specific candidate to the FRONT of the deck on
  // success, and announce via the confirmation live region. Passes the exact
  // candidateId so the server reverses that person, not just "the most recent".
  //  • ok:true  → like removed; return them to the deck and resume viewing.
  //  • ok:false → calm no-op; the like was already gone. Hide the Undo, stay put.
  //  • 409 matched:true → the like already became a match. Never offer undo;
  //    show the calm "you can unmatch from the conversation instead" line.
  async function handleUndoLike() {
    if (undoing) return;
    const restored = lastPerson;
    if (!restored) return;
    setUndoing(true);
    try {
      const result = await undoLike(restored.memberId);
      if (result && result.ok) {
        // Restore this exact person to the front of the deck and resume viewing,
        // mirroring how a skip-undo returns the card. next() clears the flags.
        setQueue(q => (q.some(c => c.memberId === restored.memberId) ? q : [restored, ...q]));
        setIndex(0);
        next();
      } else {
        // ok:false — nothing to undo. Quietly hide the Undo; no scary error.
        setLikeUndone(true);
      }
    } catch (err) {
      // 409 matched:true — the like already became a mutual match. Refuse undo
      // calmly and point to the unmatch-from-conversation path (never appear
      // broken). Any other error resolves as a quiet no-op.
      if (err && err.status === 409 && err.body && err.body.matched) {
        setUndoLikeBlocked(true);
      } else {
        setLikeUndone(true);
      }
    } finally {
      setUndoing(false);
    }
  }

  const page = {
    minHeight: "100%",
    background: t.bgGradient,
    color: t.text,
    fontFamily: t.sans,
    fontSize: 17,
    lineHeight: 1.65,
    padding: "20px 16px 48px",
    boxSizing: "border-box",
  };
  const shell = { maxWidth: t.layout.maxContent, margin: "0 auto" };
  // Raised card tier: real edge + real elevation (the inset tier below overrides
  // with surfaceAlt + borderLight + no shadow for secondary content).
  const card = {
    background: t.surface,
    border: `1px solid ${t.cardBorder}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: t.shadow.md,
  };

  // Brand fingerprint — a quiet 6-tile spectrum strip along the top of the
  // person card. Static, decorative, hidden under reduced-sensory.
  const SpectrumStrip = () =>
    reducedSensory ? null : (
      <div aria-hidden="true" style={{ display: "flex", gap: 3, marginBottom: 18 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: `var(--mark-${n})`,
            }}
          />
        ))}
      </div>
    );

  // The app shell now owns the wordmark + primary nav, so this screen no longer
  // renders its own "Spectrum" header (was a duplicate landmark) or the dead
  // "#help" link. Just the real "Done for now" action, as a proper button.
  const Header = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setFiltersOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 999,
          color: t.text,
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          padding: "8px 16px",
          minHeight: 44,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Filters
      </button>
      <button
        type="button"
        onClick={() => setStage("done")}
        style={{
          background: "none",
          border: "none",
          color: t.accentStrong,
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          padding: "8px 4px",
          minHeight: 44,
        }}
      >
        {plainLanguage ? "Done" : "Done for now"}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: t.textSoft, fontSize: 16 }}>Finding people for you…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: t.textSoft, fontSize: 16 }}>{loadError}</p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div style={page}>
        <Header />
        <div style={shell}>
          {paused && <PausedBanner onGoToProfile={onGoToProfile} plainLanguage={plainLanguage} />}
          <div style={card}>
            <h1 ref={doneHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>You're done for now.</h1>
            <p style={{ color: t.textSoft, marginBottom: 24 }}>
              Your place is saved. When you come back, you'll start exactly where you left off.
              Nobody was told you looked at them.
            </p>
            <ActionButton label="See suggestions again" kind="interested" onClick={() => setStage("viewing")} />
          </div>
        </div>
        {filtersOpen && (
          <DiscoverFilters
            initial={filterInitial}
            applying={applyingFilters}
            plainLanguage={plainLanguage}
            onApply={handleApplyFilters}
            onClose={() => setFiltersOpen(false)}
          />
        )}
      </div>
    );
  }

  // Only show the "caught up"/empty-deck screen while actually viewing. If the
  // user just acted on their LAST card, the deck is now empty (atEnd) but we must
  // still render that action's confirmation — especially a mutual-match moment
  // (its "Say hello" deep-link) or the skip/not-now Undo — instead of jumping
  // straight to "all caught up". Once they continue (next() → stage "viewing"),
  // this guard lets the caught-up screen show.
  if (atEnd && stage === "viewing") {
    // F22 — a deck that came back empty on load is a different situation from
    // one the user has worked all the way through. The zero case names the
    // likely filter culprits and uses a calmer, neutral treatment (no
    // "all caught up" illustration or copy, which would misdescribe it).
    const noSeeking = !filterInitial.seeking || String(filterInitial.seeking).trim() === "";
    const tightRadius =
      typeof filterInitial.searchRadiusMiles === "number" &&
      filterInitial.searchRadiusMiles > 0 &&
      filterInitial.searchRadiusMiles <= 10;
    return (
      <div style={page}>
        <Header />
        <div style={shell}>
          {paused && <PausedBanner onGoToProfile={onGoToProfile} plainLanguage={plainLanguage} />}
          {deckEmptyFromStart ? (
            <div style={card}>
              <h1 ref={endHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>
                {plainLanguage ? "No one to show right now." : "No matches with your current filters"}
              </h1>
              <p style={{ color: t.textSoft, marginBottom: 16 }}>
                {plainLanguage
                  ? "We couldn't find anyone who matches your filters right now. Try changing your filters to see more people."
                  : "We couldn't find anyone matching your current filters right now. That's not a problem on your end — it just means the filters are narrow at the moment."}
              </p>
              <p style={{ color: t.textSoft, marginBottom: 18, fontSize: 16 }}>
                {noSeeking ? (
                  <>You haven't set <strong>who you want to meet</strong> yet — choosing that, or widening your <strong>age range</strong> or <strong>search radius</strong>, will usually bring people in.</>
                ) : tightRadius ? (
                  <>Your <strong>search radius</strong> is quite tight right now. Widening it, or your <strong>age range</strong>, will usually bring more people in.</>
                ) : (
                  <>Try widening your <strong>age range</strong> or <strong>search radius</strong>, or check <strong>who you want to meet</strong>.</>
                )}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ActionButton
                  label="Adjust your search"
                  kind="interested"
                  onClick={() => setFiltersOpen(true)}
                />
                <ActionButton
                  label="Check again"
                  kind="notnow"
                  onClick={() => loadCandidates()}
                />
              </div>
            </div>
          ) : (
            <div style={card}>
              {/* Low-stimulation swaps the illustration for the static brand
                  mark — quieter, but the empty state still feels authored. */}
              <div style={{ marginBottom: 12 }}>
                {reducedSensory ? <SpectrumMark height={10} /> : <AllCaughtUp size={110} />}
              </div>
              <h1 ref={endHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>
                {plainLanguage ? "You've seen everyone." : "You're all caught up."}
              </h1>
              <p style={{ color: t.textSoft, marginBottom: 20 }}>
                {plainLanguage
                  ? "You've seen everyone in your search for now. We will show more people as they join."
                  : "You've seen everyone who matches your search for now. There's nothing you need to do — we'll have more people as folks join."}
              </p>
              <p style={{ color: t.textSoft, marginBottom: 18, fontSize: 16 }}>
                Want to see more? Widening your <strong>search radius</strong>, <strong>age range</strong>, or <strong>who you want to meet</strong> can help — you can adjust all three here.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ActionButton
                  label="Check again"
                  kind="interested"
                  onClick={() => loadCandidates()}
                />
                <ActionButton
                  label="Adjust your search"
                  kind="notnow"
                  onClick={() => setFiltersOpen(true)}
                />
              </div>
            </div>
          )}
        </div>
        {filtersOpen && (
          <DiscoverFilters
            initial={filterInitial}
            applying={applyingFilters}
            plainLanguage={plainLanguage}
            onApply={handleApplyFilters}
            onClose={() => setFiltersOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={page}>
      <Header />
      <div style={shell}>
        {paused && <PausedBanner onGoToProfile={onGoToProfile} plainLanguage={plainLanguage} />}

        {stage === "viewing" && (
          <>
            {/* Calm retry surface for a failed "I'm interested" — the person is
                restored to the front of the deck so nothing is lost. */}
            {swipeFailed && person && swipeFailed.memberId === person.memberId && (
              <div
                role="alert"
                style={{
                  ...card,
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  boxShadow: "none",
                  marginBottom: 16,
                }}
              >
                <p style={{ margin: "0 0 12px", color: t.text, lineHeight: 1.6 }}>
                  We couldn't save that you're interested in {swipeFailed.displayName}. Please try again.
                </p>
                <ActionButton
                  label={submitting ? "Trying again…" : "Try again"}
                  kind="interested"
                  onClick={handleRetryInterested}
                />
              </div>
            )}
            {/* Profile card — one person at a time. No grid, no auto-advance, no timer. */}
            <div style={card}>
              <SpectrumStrip />

              {/* Hero photo when the person has one — real faces get prominence
                  instead of a tiny circle. Decorative (name is in the adjacent
                  heading). Falls back to the gradient-monogram lockup below. */}
              {person.photoUrl && (
                <img
                  src={person.photoUrl}
                  alt={person.photoDescription || `Photo of ${person.displayName}`}
                  width={640}
                  height={380}
                  fetchpriority="high"
                  decoding="async"
                  style={{
                    width: "100%",
                    height: 380,
                    objectFit: "cover",
                    borderRadius: 16,
                    display: "block",
                    marginBottom: 18,
                    background: t.surfaceAlt,
                  }}
                />
              )}
              {/* Name lockup — the monogram avatar shows only when there's no photo. */}
              <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 20 }}>
                {!person.photoUrl && (
                  <Avatar
                    name={person.displayName}
                    userId={person.memberId}
                    size={88}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h1 style={{
                    fontFamily: t.serif,
                    fontSize: 30,
                    margin: "0 0 3px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}>
                    {person.displayName}{typeof person.age === "number" ? `, ${person.age}` : ''}
                    {person.verified && (
                      <VerifiedBadge style={{ marginLeft: 10, position: "relative", top: -4 }} />
                    )}
                  </h1>
                  {person.pronouns && (
                    <div style={{ fontSize: 14, color: t.textMuted, margin: "2px 0" }}>
                      {person.pronouns}
                    </div>
                  )}
                  <p style={{
                    fontFamily: t.serif,
                    fontSize: 16,
                    color: t.textSoft,
                    fontStyle: "italic",
                    margin: "4px 0 6px",
                    lineHeight: 1.4,
                  }}>
                    {person.tagline}
                  </p>
                  <span style={{ fontSize: 14, color: t.textMuted, fontWeight: 500, letterSpacing: "0.02em" }}>
                    {person.distanceLabel}
                  </span>
                </div>
              </div>

              <Divider />

              {/* Bio */}
              <p style={{ margin: 0, color: t.text, lineHeight: 1.75 }}>{person.bio}</p>

              <Divider />

              {/* Communication note */}
              <p style={{ margin: 0, color: t.textSoft, fontSize: 16, lineHeight: 1.6 }}>
                <strong style={{ color: t.text, fontWeight: 600 }}>About talking: </strong>
                {person.communicationNote}
              </p>

            </div>

            {/* Interests + Why — in one quiet card */}
            <div style={{
              ...card,
              background: t.surfaceAlt,
              boxShadow: "none",
              border: `1px solid ${t.borderLight}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <h2 style={{ fontFamily: t.serif, fontSize: 17, margin: 0, fontWeight: 700 }}>Interests</h2>
                <span style={{ fontSize: 13, color: t.textMuted }}>
                  <span aria-hidden="true">✦</span> = shared
                </span>
              </div>
              <InterestPills interests={person.interests} viewerInterests={viewerInterests} />

              <Divider />

              <h2 style={{ fontFamily: t.serif, fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>
                Why you're seeing {person.displayName}
              </h2>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {person.whyReasons.map((r, i) => (
                  <li key={i} style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    marginBottom: 8,
                    fontSize: 16,
                    color: t.textSoft,
                  }}>
                    <span aria-hidden="true" style={{ color: t.accent, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>✓</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            {/* How I communicate — moat comms/sensory prefs. The free-text
                context card is withheld pre-match, so this renders only when the
                candidate has set any comms/sensory prefs. */}
            {commStyleChips(person).length > 0 && (
              <div style={{
                ...card,
                background: t.surfaceAlt,
                boxShadow: "none",
                border: `1px solid ${t.borderLight}`,
              }}>
                <CommStyleArea person={person} />
              </div>
            )}

            {/* Hinge-style prompts — only when the candidate has answered any. */}
            {Array.isArray(person.prompts) &&
              person.prompts.some((p) => p && p.answer && p.answer.trim()) && (
                <div style={card}>
                  <PromptCards prompts={person.prompts} />
                </div>
              )}

            {/* Three actions: fixed order, fixed labels (3.2.4). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ActionButton label={plainLanguage ? "Yes"      : "I'm interested"} kind="interested" onClick={handleInterested} icon="♡" />
              <ActionButton label={plainLanguage ? "Not now" : "Not right now"}  kind="notnow"    onClick={handleNotNow} />
              <ActionButton label="Skip"                                          kind="skip"      onClick={handleSkip} />
            </div>

            <p style={{ marginTop: 20, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => setReportingCandidate(person)}
                style={{
                  background: "none",
                  border: "none",
                  color: t.textMuted,
                  fontSize: 14,
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: "4px 8px",
                  minHeight: 44,
                }}
              >
                Report {person.displayName}
              </button>
            </p>
          </>
        )}

        {/* Confirmation — not a mutual match */}
        {stage === "confirmed" && !mutual && (
          <div style={card}>
            <p
              ref={liveRef}
              tabIndex={-1}
              aria-live="polite"
              style={{ fontFamily: t.serif, fontSize: 22, fontWeight: 700, color: t.text, marginTop: 0, lineHeight: 1.35 }}
            >
              {lastChoice === "interested" && (plainLanguage
                ? `Done. You said yes to ${lastPerson?.displayName}.`
                : `Saved. You said you're interested in ${lastPerson?.displayName}.`)}
              {lastChoice === "not_now" && (plainLanguage
                ? `Done. You pressed not now for ${lastPerson?.displayName}.`
                : `Saved. ${lastPerson?.displayName} may come up again later.`)}
              {lastChoice === "skip" && (plainLanguage
                ? `Done. You skipped ${lastPerson?.displayName}.`
                : `Saved. You won't see ${lastPerson?.displayName} again.`)}
            </p>
            {lastChoice === "interested" && (
              <p style={{ color: t.textSoft, marginBottom: 24 }}>
                {plainLanguage
                  ? <>If {lastPerson?.displayName} also says yes, you can both send messages. Until then, they won't be told.</>
                  : <>If {lastPerson?.displayName} also says they're interested, you'll both be able to message each other. Until then, {lastPerson?.displayName} isn't told.</>}
              </p>
            )}
            {/* F16 — the like already became a mutual match, so undo is refused.
                Calm, non-alarming; points to the unmatch-from-conversation path.
                Announced politely (no urgency cues). */}
            {lastChoice === "interested" && undoLikeBlocked && (
              <p
                role="status"
                style={{
                  background: t.surfaceAlt,
                  border: `1px solid ${t.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 20,
                  color: t.textSoft,
                  fontSize: 16,
                  lineHeight: 1.6,
                }}
              >
                {plainLanguage
                  ? <>You and {lastPerson?.displayName} already matched, so this can't be undone here. You can unmatch from the conversation instead.</>
                  : <>You've already matched — you can unmatch from the conversation instead.</>}
              </p>
            )}
            {/* Next loads only on explicit press (3.2.5). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ActionButton label="Next person" kind="interested" onClick={next} />
              {/* Undo is offered after any reversible choice — mirroring the
                  skip-undo affordance so the interaction language is symmetric.
                  A no-op (ok:false) or a 409 (already matched) resolves quietly:
                  we hide the control rather than show a scary error. */}
              {(lastChoice === "not_now" || lastChoice === "skip") && (
                <ActionButton
                  label={undoing ? "Undoing…" : "Undo"}
                  kind="notnow"
                  onClick={handleUndo}
                />
              )}
              {lastChoice === "interested" && !undoLikeBlocked && !likeUndone && (
                <ActionButton
                  label={undoing ? "Undoing…" : "Undo"}
                  kind="notnow"
                  onClick={handleUndoLike}
                  disabled={undoing}
                  ariaLabel={`Undo — you're no longer interested in ${lastPerson?.displayName}`}
                />
              )}
            </div>
          </div>
        )}

      </div>

      {/* Mutual match — the signature, calm full-screen "match moment". */}
      {stage === "confirmed" && mutual && lastPerson && (
        <MatchMoment
          you={getViewerIdentity()}
          them={{
            name: lastPerson.displayName,
            userId: lastPerson.memberId,
            photoUrl: lastPerson.photoUrl,
          }}
          onOpenChat={async () => {
            // Create the conversation (or find the existing one via 409) then
            // deep-link directly into the thread so the user lands on the empty
            // conversation with starters, not on the Messages inbox.
            next();
            if (matchId && onOpenConversation) {
              const seedInfo = lastPerson
                ? { otherUser: { userId: lastPerson.memberId, displayName: lastPerson.displayName, photoUrl: lastPerson.photoUrl }, started: false }
                : undefined;
              try {
                const conv = await createConversation(matchId);
                const convId = conv?.conversationId || conv?.id;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              } catch (e) {
                // 409 = conversation already exists; server returns conversationId
                const convId = e?.body?.conversationId;
                if (convId) { onOpenConversation(convId, seedInfo); return; }
              }
            }
            // Fallback: just open the Messages tab if we can't deep-link.
            (onOpenMessages || (() => {}))();
          }}
          onContinue={next}
          plainLanguage={plainLanguage}
        />
      )}

      {reportingCandidate && (
        <ReportModal
          candidate={reportingCandidate}
          onClose={() => setReportingCandidate(null)}
          onBlocked={(c) => {
            // Client-side fallback: drop the reported person from the deck so
            // they don't resurface this session, even if the block 400s.
            setQueue(q => q.filter(p => p.memberId !== c.memberId));
            setIndex(0);
          }}
        />
      )}

      {filtersOpen && (
        <DiscoverFilters
          initial={filterInitial}
          applying={applyingFilters}
          plainLanguage={plainLanguage}
          onApply={handleApplyFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  );
}
