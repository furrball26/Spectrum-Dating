import { useState, useEffect, useRef } from "react";
import { t } from "./tokens.js";
import { getUserProfile } from "./api.js";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";

// Read-only view of a MATCHED person's profile. Opened by tapping their avatar
// in Matches or in a conversation. Fetches GET /profile/:userId (match-gated).
function commChips(p) {
  const c = [];
  if (p.commDirectness === "direct") c.push("Direct");
  if (p.commDirectness === "softened") c.push("Softened");
  if (p.commLiteral === "literal") c.push("Literal");
  if (p.commLiteral === "playful") c.push("Playful");
  if (p.commCadence === "instant") c.push("Quick replies");
  if (p.commCadence === "daily") c.push("Replies once a day");
  if (p.sensoryEnvironment === "quiet") c.push("Quiet settings");
  if (p.sensoryEnvironment === "lively") c.push("Lively settings");
  if (p.sensoryLighting === "dim") c.push("Dim lighting");
  if (p.sensoryLighting === "bright") c.push("Bright lighting");
  if (p.socialDuration === "short") c.push("Short meetups");
  if (p.socialDuration === "long") c.push("Longer meetups");
  return c;
}

export default function MatchProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    getUserProfile(userId)
      .then((p) => { if (active) setProfile(p); })
      .catch((e) => { if (active) setError(e?.message || "Couldn't load this profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chips = profile ? commChips(profile) : [];

  return (
    <>
      <div aria-hidden="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(36,51,45,0.4)", zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "min(94vw, 460px)", maxHeight: "88vh", overflowY: "auto",
          background: t.surface, borderRadius: 20, boxShadow: "0 12px 48px rgba(36,51,45,0.22)",
          zIndex: 1201, boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 12px 0" }}>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close profile"
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, color: t.textSoft, cursor: "pointer", padding: "6px 10px", minHeight: 44, minWidth: 44, borderRadius: 8 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "0 24px 28px" }}>
          {loading ? (
            <p style={{ color: t.textSoft, padding: "16px 0" }}>Loading…</p>
          ) : error ? (
            <p role="alert" style={{ color: t.textSoft, padding: "16px 0" }}>{error}</p>
          ) : profile ? (
            <>
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt={`Photo of ${profile.displayName}`} style={{ width: "100%", height: 300, objectFit: "cover", borderRadius: 16, display: "block", background: t.surfaceAlt }} />
              ) : (
                <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
                  <Avatar name={profile.displayName} userId={profile.userId} size={96} />
                </div>
              )}

              <h1 ref={headingRef} tabIndex={-1} style={{ fontFamily: t.serif, fontSize: 26, fontWeight: 700, margin: "16px 0 2px", color: t.text, outline: "none" }}>
                {profile.displayName}{typeof profile.age === "number" ? `, ${profile.age}` : ""}
                {profile.verified && <VerifiedBadge style={{ marginLeft: 10, position: "relative", top: -3 }} />}
              </h1>
              {profile.pronouns && <div style={{ fontSize: 14, color: t.textMuted, marginBottom: 2 }}>{profile.pronouns}</div>}
              {profile.tagline && <p style={{ fontFamily: t.serif, fontStyle: "italic", fontSize: 15, color: t.textSoft, margin: "2px 0 6px" }}>{profile.tagline}</p>}
              {profile.distCity && <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 10 }}>Near {profile.distCity}</div>}

              {profile.bio && <p style={{ fontSize: 16, color: t.text, lineHeight: 1.55, margin: "14px 0" }}>{profile.bio}</p>}

              {Array.isArray(profile.interests) && profile.interests.length > 0 && (
                <div style={{ margin: "14px 0" }}>
                  <h2 style={{ fontFamily: t.serif, fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>Interests</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {profile.interests.map((i) => (
                      <span key={i} style={{ padding: "5px 13px", borderRadius: 24, fontSize: 13, background: t.surfaceAlt, color: t.textSoft, border: `1px solid ${t.border}` }}>{i}</span>
                    ))}
                  </div>
                </div>
              )}

              {chips.length > 0 && (
                <div style={{ margin: "14px 0" }}>
                  <h2 style={{ fontFamily: t.serif, fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>How they communicate</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {chips.map((c) => (
                      <span key={c} style={{ padding: "5px 13px", borderRadius: 24, fontSize: 13, background: t.surface, color: t.textSoft, border: `1px solid ${t.border}` }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {profile.contextCard && profile.contextCard.trim() && (
                <div style={{ margin: "14px 0", padding: "12px 16px", background: t.green50, borderRadius: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.textSoft, marginBottom: 4 }}>In their words</div>
                  <p style={{ fontStyle: "italic", color: t.text, margin: 0 }}>"{profile.contextCard}"</p>
                </div>
              )}

              {Array.isArray(profile.prompts) && profile.prompts.filter(p => p && p.answer && p.answer.trim()).length > 0 && (
                <div style={{ margin: "14px 0", display: "flex", flexDirection: "column", gap: 14 }}>
                  {profile.prompts.filter(p => p && p.answer && p.answer.trim()).map((p, i) => (
                    <div key={p.promptKey || i}>
                      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 2 }}>{p.promptText || p.promptKey}</div>
                      <div style={{ fontFamily: t.serif, fontSize: 17, color: t.text }}>{p.answer}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
