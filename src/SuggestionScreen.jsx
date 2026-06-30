import { useState, useRef, useEffect, useCallback } from "react";
import { getCandidates, swipe, blockUser, reportUser, getProfile, undoSkip } from "./api.js";
import { t } from "./tokens.js";
import VerifiedBadge from "./VerifiedBadge.jsx";
import Avatar from "./Avatar.jsx";

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
    interested: { background: t.positive, color: "#fff", border: `1px solid ${t.positive}` },
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
              background: shared ? t.accentStrong : t.surfaceAlt,
              color: shared ? "#fff" : t.textSoft,
              border: `1px solid ${shared ? t.accentStrong : t.border}`,
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
// comms/sensory prefs, plus an optional "In their words" context card.
// Only set values render; we intentionally skip the noisy "either"/"whenever"
// values to keep a calm 2–4 chip row.
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
  const hasContext = !!(person.contextCard && person.contextCard.trim());
  if (chips.length === 0 && !hasContext) return null;

  return (
    <div style={{ marginTop: 0 }}>
      {chips.length > 0 && (
        <>
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
        </>
      )}

      {hasContext && (
        <div style={{ marginTop: chips.length > 0 ? 16 : 0 }}>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: t.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 8px",
            }}
          >
            In their words
          </h3>
          <blockquote
            style={{
              margin: 0,
              padding: "10px 14px",
              borderLeft: `3px solid ${t.accent}`,
              background: t.surface,
              borderRadius: 8,
              color: t.text,
              fontSize: 15,
              fontStyle: "italic",
              lineHeight: 1.6,
            }}
          >
            {person.contextCard}
          </blockquote>
        </div>
      )}
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

export default function SuggestionScreen({ onOpenMessages, onGoToProfile }) {
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
    setLastChoice(null);
    setLastPerson(null);
    setStage("viewing");
  }

  // Undo the last skip: ask the backend to restore the candidate, then re-fetch
  // the deck so the un-skipped person reappears. A no-op (ok:false) is handled
  // quietly — we simply return to viewing without fuss.
  async function handleUndo() {
    if (undoing) return;
    setUndoing(true);
    try {
      const result = await undoSkip();
      if (result && result.ok) {
        await loadCandidates();
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
  const shell = { maxWidth: 540, margin: "0 auto" };
  const card = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 16,
    boxShadow: "0 2px 8px rgba(36,51,45,0.07), 0 8px 24px rgba(36,51,45,0.04)",
  };

  // Consistent header: same nav in same place every screen (3.2.3 / 3.2.6).
  const Header = () => (
    <div style={{ ...shell, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
      <span style={{ fontFamily: t.serif, fontWeight: 700, fontSize: 19, letterSpacing: "-0.01em" }}>
        Spectrum
      </span>
      <span style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <a href="#help" style={{ color: t.textSoft, fontSize: 15, fontWeight: 500, textDecoration: "none" }}>Help</a>
        <a
          href="#done"
          onClick={(e) => { e.preventDefault(); setStage("done"); }}
          style={{ color: t.accentStrong, fontSize: 15, fontWeight: 600, textDecoration: "none" }}
        >
          Done for now
        </a>
      </span>
    </div>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: '#4E5F58', fontSize: 16 }}>Finding people for you…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: '#4E5F58', fontSize: 16 }}>{loadError}</p>
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
            <h1 ref={endHeadingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700 }}>No new suggestions right now.</h1>
            <p style={{ color: t.textSoft, marginBottom: 24 }}>
              We'll let you know when there are more people to see. There's nothing you need to do.
            </p>
            <p style={{ color: t.textSoft, marginBottom: 16, fontSize: 15 }}>
              Try updating your profile with more interests to widen your matches.
            </p>
            <ActionButton
              label="Go to Profile"
              kind="notnow"
              onClick={onGoToProfile || (() => {})}
            />
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

              {/* Avatar + name lockup */}
              <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 20 }}>
                <Avatar
                  name={person.displayName}
                  userId={person.memberId}
                  photoUrl={person.photoUrl}
                  size={88}
                />
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

            {/* How I communicate — moat comms/sensory prefs + context card.
                Renders only when the candidate has set any of them. */}
            {(commStyleChips(person).length > 0 ||
              (person.contextCard && person.contextCard.trim())) && (
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
              <ActionButton label="I'm interested" kind="interested" onClick={handleInterested} icon="♡" />
              <ActionButton label="Not right now"  kind="notnow"    onClick={handleNotNow} />
              <ActionButton label="Skip"           kind="skip"      onClick={handleSkip} />
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
              {lastChoice === "interested" && `Saved. You said you're interested in ${lastPerson?.displayName}.`}
              {lastChoice === "not_now"    && `Saved. ${lastPerson?.displayName} may come up again later.`}
              {lastChoice === "skip"       && `Saved. You won't see ${lastPerson?.displayName} again.`}
            </p>
            {lastChoice === "interested" && (
              <p style={{ color: t.textSoft, marginBottom: 24 }}>
                If {lastPerson?.displayName} also says they're interested, you'll both be able to message
                each other. Until then, {lastPerson?.displayName} isn't told.
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

        {/* Mutual match */}
        {stage === "confirmed" && mutual && (
          <div style={{ ...card, textAlign: "center" }}>
            <div aria-hidden="true" style={{ fontSize: 36, marginBottom: 16, color: t.accent }}>✦</div>
            <h1
              ref={liveRef}
              tabIndex={-1}
              aria-live="polite"
              style={{ fontFamily: t.serif, fontSize: 26, marginTop: 0, fontWeight: 700, lineHeight: 1.3 }}
            >
              You and {lastPerson?.displayName} both said you're interested.
            </h1>
            <p style={{ color: t.textSoft, marginBottom: 28 }}>
              You can now message each other whenever you're ready. There's no rush.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ActionButton label="Open messages" kind="interested" onClick={onOpenMessages || (() => {})} />
              <ActionButton label="Keep looking"  kind="notnow"    onClick={next} />
            </div>
          </div>
        )}

      </div>
      {reportingCandidate && (
        <ReportModal
          candidate={reportingCandidate}
          onClose={() => setReportingCandidate(null)}
        />
      )}
    </div>
  );
}
