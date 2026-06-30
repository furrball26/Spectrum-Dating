import { useState, useRef, useEffect, useCallback } from "react";
import { getCandidates, swipe, blockUser, reportUser, getProfile, undoSkip, getUserId } from "./api.js";
import { t } from "./tokens.js";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";
import MatchMoment from "./MatchMoment.jsx";
import { AllCaughtUp } from "./illustrations.jsx";

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


const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

function ActionButton({ label, kind, onClick, icon }) {
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
      style={{ ...base, ...kinds[kind], ...f.style }}
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
              fontSize: 13,
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
              fontSize: 13,
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
              fontSize: 12,
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

function ReportModal({ candidate, onClose }) {
  const [reason, setReason] = useState("inappropriate");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    // Send the report to moderators (primary action)
    try {
      await reportUser(candidate.memberId, reason, details || undefined);
    } catch {
      // Best-effort — close regardless
    }
    // Also block so the reporter won't see this candidate again
    try {
      await blockUser(candidate.memberId, reason, details || undefined);
    } catch {
      // Best-effort
    }
    setSubmitted(true);
    setTimeout(onClose, 1200);
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(36,51,45,0.35)",
          zIndex: 1100,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-heading"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: t.surface,
          borderRadius: 20,
          padding: "28px 24px",
          width: "min(90vw, 400px)",
          zIndex: 1101,
          boxShadow: "0 8px 40px rgba(36,51,45,0.18)",
          boxSizing: "border-box",
          fontFamily: t.sans,
        }}
      >
        {submitted ? (
          <p style={{ color: t.textSoft, textAlign: "center", margin: 0 }}>
            Report submitted. Thank you.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2
              id="report-modal-heading"
              ref={headingRef}
              tabIndex={-1}
              style={{
                fontFamily: t.serif,
                fontSize: 20,
                fontWeight: 700,
                margin: "0 0 20px",
                color: t.text,
                outline: "none",
              }}
            >
              Report {candidate.displayName}
            </h2>
            <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
              <legend style={{ fontWeight: 600, fontSize: 15, color: t.text, marginBottom: 10 }}>
                Reason
              </legend>
              <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 15, color: t.text, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="report-reason"
                  value="inappropriate"
                  checked={reason === "inappropriate"}
                  onChange={() => setReason("inappropriate")}
                  style={{ minWidth: 18, minHeight: 18 }}
                />
                Inappropriate content
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: t.text, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="report-reason"
                  value="spam"
                  checked={reason === "spam"}
                  onChange={() => setReason("spam")}
                  style={{ minWidth: 18, minHeight: 18 }}
                />
                Spam or fake profile
              </label>
            </fieldset>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={{ display: "block", fontSize: 14, color: t.textSoft, marginBottom: 6 }}>
                Additional details (optional)
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 200))}
                maxLength={200}
                rows={3}
                placeholder="Tell us more…"
                style={{
                  width: "100%",
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 15,
                  color: t.text,
                  fontFamily: t.sans,
                  resize: "none",
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 12, color: t.textMuted }}>{200 - details.length} characters remaining</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
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
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: "#B94040",
                  color: "#fff",
                  border: "none",
                }}
              >
                Submit report
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

export default function SuggestionScreen({ onOpenMessages, onGoToProfile, plainLanguage = false }) {
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

  const person = queue[index];
  const atEnd = index >= queue.length;

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
    const current = queue[index];
    if (!current) return;
    setLastChoice("interested");
    setLastPerson(current);
    setQueue(q => q.slice(1));
    setIndex(0);
    try {
      const result = await swipe(current.memberId, 'like');
      if (result.matched) {
        setMutual(true);
        setMatchId(result.matchId || null);
      }
    } catch {
      // Swipe failed — already removed from queue, proceed gracefully
    }
    setStage("confirmed");
  }

  async function handleNotNow() {
    // Explicit action only — never triggered by focus, hover, or scroll (3.2.1 / 3.2.2).
    const current = queue[index];
    if (!current) return;
    setLastChoice("not_now");
    setLastPerson(current);
    setQueue(q => q.slice(1));
    setIndex(0);
    try {
      await swipe(current.memberId, 'skip');
    } catch {
      // Swipe failed silently — queue already advanced
    }
    setStage("confirmed");
  }

  async function handleSkip() {
    // Explicit action only — never triggered by focus, hover, or scroll (3.2.1 / 3.2.2).
    const current = queue[index];
    if (!current) return;
    setLastChoice("skip");
    setLastPerson(current);
    setQueue(q => q.slice(1));
    setIndex(0);
    try {
      await swipe(current.memberId, 'skip');
    } catch {
      // Swipe failed silently — queue already advanced, don't show error for a skip
    }
    setStage("confirmed");
  }

  function next() {
    setMutual(false);
    setMatchId(null);
    setLastChoice(null);
    setLastPerson(null);
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
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: "0 2px 8px rgba(36,51,45,0.07), 0 8px 24px rgba(36,51,45,0.04)",
  };

  // The app shell now owns the wordmark + primary nav, so this screen no longer
  // renders its own "Spectrum" header (was a duplicate landmark) or the dead
  // "#help" link. Just the real "Done for now" action, as a proper button.
  const Header = () => (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setStage("done")}
        style={{
          background: "none",
          border: "none",
          color: t.accentStrong,
          fontSize: 15,
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
          <div style={card}>
            <h1 ref={doneHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>You're done for now.</h1>
            <p style={{ color: t.textSoft, marginBottom: 24 }}>
              Your place is saved. When you come back, you'll start exactly where you left off.
              Nobody was told you looked at them.
            </p>
            <ActionButton label="See suggestions again" kind="interested" onClick={() => setStage("viewing")} />
          </div>
        </div>
      </div>
    );
  }

  if (atEnd) {
    return (
      <div style={page}>
        <Header />
        <div style={shell}>
          <div style={card}>
            <div style={{ marginBottom: 12 }}>
              <AllCaughtUp size={110} />
            </div>
            <h1 ref={endHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>
              {plainLanguage ? "You've seen everyone." : "You're all caught up."}
            </h1>
            <p style={{ color: t.textSoft, marginBottom: 20 }}>
              {plainLanguage
                ? "You've seen everyone in your search for now. We will show more people as they join."
                : "You've seen everyone who matches your search for now. There's nothing you need to do — we'll have more people as folks join."}
            </p>
            <p style={{ color: t.textSoft, marginBottom: 18, fontSize: 15 }}>
              Want to see more? Widening your <strong>search radius</strong>, <strong>age range</strong>, or who you're seeking in your profile can help.
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
                onClick={onGoToProfile || (() => {})}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <Header />
      <div style={shell}>

        {stage === "viewing" && (
          <>
            {/* Profile card — one person at a time. No grid, no auto-advance, no timer. */}
            <div style={card}>

              {/* Hero photo when the person has one — real faces get prominence
                  instead of a tiny circle. Decorative (name is in the adjacent
                  heading). Falls back to the gradient-monogram lockup below. */}
              {person.photoUrl && (
                <img
                  src={person.photoUrl}
                  alt={`Photo of ${person.displayName}`}
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
                    fontSize: 15,
                    color: t.textSoft,
                    fontStyle: "italic",
                    margin: "4px 0 6px",
                    lineHeight: 1.4,
                  }}>
                    {person.tagline}
                  </p>
                  <span style={{ fontSize: 13, color: t.textMuted, fontWeight: 500, letterSpacing: "0.02em" }}>
                    {person.distanceLabel}
                  </span>
                </div>
              </div>

              <Divider />

              {/* Bio */}
              <p style={{ margin: 0, color: t.text, lineHeight: 1.75 }}>{person.bio}</p>

              <Divider />

              {/* Communication note */}
              <p style={{ margin: 0, color: t.textSoft, fontSize: 15, lineHeight: 1.6 }}>
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
                <span style={{ fontSize: 12, color: t.textMuted }}>
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
                    fontSize: 15,
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
            {/* Next loads only on explicit press (3.2.5). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ActionButton label="Next person" kind="interested" onClick={next} />
              {/* Undo is offered after a skip-style choice; a no-op resolves quietly. */}
              {(lastChoice === "not_now" || lastChoice === "skip") && (
                <ActionButton
                  label={undoing ? "Undoing…" : "Undo"}
                  kind="notnow"
                  onClick={handleUndo}
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
          onOpenChat={() => {
            // Land the pair in Messages. (matchId is available as `matchId` if a
            // future flow wants to deep-link / create the conversation here.)
            next();
            (onOpenMessages || (() => {}))();
          }}
          onContinue={next}
        />
      )}

      {reportingCandidate && (
        <ReportModal
          candidate={reportingCandidate}
          onClose={() => setReportingCandidate(null)}
        />
      )}
    </div>
  );
}
