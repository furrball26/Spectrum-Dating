import { useState, useEffect, useRef } from "react";
import { t } from "./tokens.js";
import { getUserProfile } from "./api.js";
import { commChips } from "./commChips.js";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import PhotoCarousel from "./PhotoCarousel.jsx";
import { genderLabel, orientationLabels } from "./IdentityFields.jsx";

// Read-only view of a MATCHED person's profile. Opened by tapping their avatar
// in Matches or in a conversation. Fetches GET /profile/:userId (match-gated).

export default function MatchProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef(null);
  const headingRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    getUserProfile(userId)
      .then((p) => { if (active) setProfile(p); })
      .catch((e) => { if (active) setError(e?.message || "Couldn't load this profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  // Move focus into the dialog on open, and restore focus to whatever triggered
  // it (the tapped avatar) on close. Mirrors UnmatchSheet's focus discipline. WCAG 2.4.3.
  useEffect(() => {
    const prevFocus = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
    };
  }, []);

  // Escape to close + Tab/Shift+Tab focus trap. The dialog's focusable set is
  // dynamic (varies with loaded content), so query it live on each Tab. WCAG 2.4.3 / 2.1.2.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onClose?.(); return; }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !root.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !root.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chips = profile ? commChips(profile) : [];

  return (
    <>
      <div aria-hidden="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(var(--c-scrimRgb, 36, 51, 45),0.4)", zIndex: 1200 }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "min(94vw, 460px)", maxHeight: "88vh", overflowY: "auto",
          background: t.surface, borderRadius: 20, boxShadow: t.shadow.lg,
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
              {/* PROD-6 — approved photo gallery (primary first). Swipe is fine
                  here (this is not a like/skip card); dots + tap zones too. */}
              {Array.isArray(profile.photos) && profile.photos.length > 0 ? (
                <PhotoCarousel photos={profile.photos} name={profile.displayName} height={300} swipe />
              ) : profile.photoUrl ? (
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
              {(() => {
                const g = profile.gender === "other" && profile.genderCustom
                  ? profile.genderCustom
                  : genderLabel(profile.gender);
                const orients = orientationLabels(profile.orientation);
                if (!g && orients.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 2px" }}>
                    {g && (
                      <span style={{ padding: "3px 11px", borderRadius: 20, fontSize: 13, fontWeight: 500, background: t.surfaceAlt, color: t.textSoft, border: `1px solid ${t.border}` }}>{g}</span>
                    )}
                    {orients.map((o) => (
                      <span key={o} style={{ padding: "3px 11px", borderRadius: 20, fontSize: 13, fontWeight: 500, background: t.surfaceAlt, color: t.textSoft, border: `1px solid ${t.border}` }}>{o}</span>
                    ))}
                  </div>
                );
              })()}
              {profile.tagline && <p style={{ fontFamily: t.serif, fontStyle: "italic", fontSize: 16, color: t.textSoft, margin: "2px 0 6px" }}>{profile.tagline}</p>}
              {profile.distCity && <div style={{ fontSize: 14, color: t.textMuted, marginBottom: 10 }}>Near {profile.distCity}</div>}

              {profile.bio && <p style={{ fontSize: 16, color: t.text, lineHeight: 1.55, margin: "14px 0" }}>{profile.bio}</p>}

              {Array.isArray(profile.interests) && profile.interests.length > 0 && (
                <div style={{ margin: "14px 0" }}>
                  <h2 style={{ fontFamily: t.serif, fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>Interests</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {profile.interests.map((i) => (
                      <span key={i} style={{ padding: "5px 13px", borderRadius: 24, fontSize: 14, background: t.surfaceAlt, color: t.textSoft, border: `1px solid ${t.border}` }}>{i}</span>
                    ))}
                  </div>
                </div>
              )}

              {chips.length > 0 && (
                <div style={{ margin: "14px 0" }}>
                  <h2 style={{ fontFamily: t.serif, fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>How they communicate</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {chips.map((c) => (
                      <span key={c} style={{ padding: "5px 13px", borderRadius: 24, fontSize: 14, background: t.surface, color: t.textSoft, border: `1px solid ${t.border}` }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* F28 — structured "about me" facets. Each renders only when
                  present; the whole block is skipped when all four are empty. */}
              {(() => {
                const occ = (profile.occupation || "").trim();
                const langs = (profile.languages || "").trim();
                const helps = (Array.isArray(profile.helpsMe) ? profile.helpsMe : []).filter((s) => s && s.trim());
                const hard = (Array.isArray(profile.hardForMe) ? profile.hardForMe : []).filter((s) => s && s.trim());
                if (!occ && !langs && helps.length === 0 && hard.length === 0) return null;
                const rowLabel = { fontSize: 13, fontWeight: 600, color: t.textMuted, marginBottom: 4 };
                const pill = { padding: "5px 13px", borderRadius: 24, fontSize: 14, background: t.surfaceAlt, color: t.textSoft, border: `1px solid ${t.border}` };
                const pillRow = (items) => (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {items.map((it, i) => (<span key={i} style={pill}>{it}</span>))}
                  </div>
                );
                return (
                  <div style={{ margin: "14px 0" }}>
                    <h2 style={{ fontFamily: t.serif, fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>About</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {occ && (<div><div style={rowLabel}>Occupation</div><div style={{ fontSize: 15, color: t.text }}>{occ}</div></div>)}
                      {langs && (<div><div style={rowLabel}>Languages</div><div style={{ fontSize: 15, color: t.text }}>{langs}</div></div>)}
                      {helps.length > 0 && (<div><div style={rowLabel}>Things that help me</div>{pillRow(helps)}</div>)}
                      {hard.length > 0 && (<div><div style={rowLabel}>Things that are hard for me</div>{pillRow(hard)}</div>)}
                    </div>
                  </div>
                );
              })()}

              {profile.contextCard && profile.contextCard.trim() && (
                <div style={{ margin: "14px 0", padding: "12px 16px", background: t.green50, borderRadius: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.textSoft, marginBottom: 4 }}>In their words</div>
                  <p style={{ fontStyle: "italic", color: t.text, margin: 0 }}>"{profile.contextCard}"</p>
                </div>
              )}

              {Array.isArray(profile.prompts) && profile.prompts.filter(p => p && p.answer && p.answer.trim()).length > 0 && (
                <div style={{ margin: "14px 0", display: "flex", flexDirection: "column", gap: 14 }}>
                  {profile.prompts.filter(p => p && p.answer && p.answer.trim()).map((p, i) => (
                    <div key={p.promptKey || i}>
                      <div style={{ fontSize: 14, color: t.textMuted, marginBottom: 2 }}>{p.promptText || p.promptKey}</div>
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
