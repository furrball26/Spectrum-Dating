import { t } from "./tokens.js";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import { useFocusable } from "./useFocusable.js";
import { getUserId } from "./api.js";
import { usePlainLanguage } from "./PlainLanguageContext.jsx";
import {
  SlidersIcon,
  GearIcon,
  BellIcon,
  PencilIcon,
  ChevronRightIcon,
  EyeIcon,
  SparkleIcon,
  StarIcon,
  ShieldIcon,
  LockIcon,
} from "./icons.jsx";

// ── Profile Hub (Hinge-pattern) ──────────────────────────────────────────────
// The calm HOME view for the Profile tab. Editing, preferences, and settings are
// deliberate drill-ins, NOT the default surface:
//   • Two top-right icon buttons — Preferences (sliders) and Settings (gear).
//   • A circular avatar hero with a pencil overlay → opens the full Edit form.
//   • Name + Reviewed badge under the avatar.
//   • A short list of calm destination rows (a hub, never an upsell funnel):
//       How others see you · Membership · Top Picks · Safety Center.
// This is a navigation layer — every destination is an existing screen; nothing
// about their behavior changes here. Product law: no urgency, no fabricated
// metrics, no "get seen sooner" banners (see audit/PROFILE_REDESIGN.md).

// A round icon-only button (Preferences / Settings up top, and the avatar
// pencil). Its own component so useFocusable's hook is never called in a loop or
// after an early return in the parent (React #310 discipline).
function IconButton({ label, onClick, children, size = 44, style }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: t.radius.pill,
        border: `1px solid ${t.border}`,
        background: t.surface,
        color: t.accentStrong,
        cursor: "pointer",
        padding: 0,
        ...style,
        ...f.style,
      }}
    >
      {children}
    </button>
  );
}

// A labelled header control — the round icon button with a short visible caption
// beneath it. The three top-right controls (Preferences / Settings /
// Notifications) were icon-only and ambiguous; the caption names each one in
// plain words while the IconButton keeps its matching aria-label (the caption is
// aria-hidden so the accessible name isn't doubled).
function HeaderControl({ label, onClick, children }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
      <IconButton label={label} onClick={onClick}>
        {children}
      </IconButton>
      <span
        aria-hidden="true"
        style={{ fontSize: 12, fontWeight: 500, color: t.textSoft, letterSpacing: "0.01em", lineHeight: 1.2 }}
      >
        {label}
      </span>
    </span>
  );
}

// A calm tappable destination row (icon · title/subtitle · chevron). Its own
// component so useFocusable is one-hook-per-instance, above any early return.
function HubRow({ icon, title, subtitle, tag, onClick }) {
  const f = useFocusable();
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        textAlign: "left",
        background: t.surface,
        border: `1px solid ${t.cardBorder}`,
        borderRadius: t.radius.lg,
        padding: "16px 18px",
        minHeight: 64,
        cursor: "pointer",
        fontFamily: t.sans,
        color: t.text,
        boxShadow: t.shadow.sm,
        ...f.style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: t.radius.md,
          background: t.green50,
          color: t.accentStrong,
        }}
      >
        {icon}
      </span>
      {/* minWidth:0 so the label column can shrink/truncate beside the chevron
          (flex-row truncation invariant). */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: t.text }}>{title}</span>
          {tag && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: t.clayText,
                border: `1px solid ${t.border}`,
                borderRadius: t.radius.pill,
                padding: "1px 8px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tag}
            </span>
          )}
        </span>
        {subtitle && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 14,
              color: t.textSoft,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      <span aria-hidden="true" style={{ color: t.textMuted, flexShrink: 0, display: "inline-flex" }}>
        <ChevronRightIcon size={20} />
      </span>
    </button>
  );
}

// Calm completeness cue for the Hub. A first-timer landing on the calm hub
// otherwise gets NO signal there's more they could add; this quietly names a few
// OPTIONAL things they could fill in and offers the next one — tapping jumps the
// editor straight to that field. Calm-by-design: a gentle, optional checklist —
// never a grade to chase. NO fraction ("3 of 7"), no meter, no "%", no urgency,
// no nagging (the fraction read like a score, flagged in the audit). Renders
// nothing before the first load (null) or once every field is filled. Own
// component so useFocusable stays one-hook-per-instance, above the early return.
function CompletenessCue({ completeness, onOpenEditField }) {
  const f = useFocusable();
  if (!completeness || completeness.score >= completeness.total) return null;
  const { missing } = completeness;
  const next = missing[0];
  return (
    <button
      type="button"
      onClick={() => onOpenEditField(next.key)}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        textAlign: "left",
        background: t.surface,
        border: `1px solid ${t.cardBorder}`,
        borderRadius: t.radius.lg,
        padding: "14px 18px",
        cursor: "pointer",
        fontFamily: t.sans,
        color: t.text,
        boxShadow: t.shadow.sm,
        ...f.style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
          A few optional things you could add
        </span>
        <span style={{ display: "block", marginTop: 2, fontSize: 14, color: t.textSoft, lineHeight: 1.4 }}>
          {/* Name the missing items as a gentle list (not a count/score); tapping
              opens the editor on the first one. Whenever there's more than one
              left, list the first two and stop — never a running tally. The
              field labels are already imperative ("Add a photo"), so present them
              directly. */}
          For example, {next.label.toLowerCase()}
          {missing[1] ? `, or ${missing[1].label.toLowerCase()}` : ""}. Only if you
          feel like it — it just helps matches picture you.
        </span>
      </span>
      <span aria-hidden="true" style={{ color: t.textMuted, flexShrink: 0, display: "inline-flex" }}>
        <ChevronRightIcon size={20} />
      </span>
    </button>
  );
}

// Sign out — a calm, quiet control at the very bottom of the hub. Matches the
// SignOutButton in the profile editor (transparent, bordered, soft text, 44px
// tap target) so the two read as the same action. Full-width on the hub so it's
// easy to reach as the last thing on the page.
function HubSignOut({ onSignOut }) {
  const f = useFocusable();
  return (
    <div style={{ marginTop: 28, display: "flex", justifyContent: "center" }}>
      <button
        type="button"
        onClick={onSignOut}
        {...f}
        style={{
          background: "transparent",
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          color: t.textSoft,
          fontSize: 16,
          fontWeight: 500,
          cursor: "pointer",
          padding: "10px 24px",
          minHeight: 44,
          width: "100%",
          maxWidth: 320,
          ...f.style,
        }}
      >
        Sign out
      </button>
    </div>
  );
}

export default function ProfileHub({
  displayName,
  photoUrl,
  verified = false,
  tier = "free",
  completeness = null,
  onEditProfile,
  onOpenEditField,
  onOpenPreferences,
  onOpenSettings,
  onOpenNotifications,
  onOpenPreview,
  onOpenMembership,
  onOpenTopPicks,
  onOpenSafety,
  onOpenAccount,
  onSignOut,
}) {
  const plain = usePlainLanguage();
  const isCompanion = tier === "companion";
  const name = displayName || "Your profile";

  return (
    <div
      style={{
        background: t.bgGradient,
        color: t.text,
        fontFamily: t.sans,
        fontSize: 16,
        lineHeight: 1.65,
        padding: "20px 16px 60px",
        boxSizing: "border-box",
        minHeight: "100%",
      }}
    >
      <div style={{ maxWidth: t.layout.maxContent, margin: "0 auto" }}>
        {/* Top bar — the two deliberate drill-ins, top-right. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            gap: 16,
            marginBottom: 8,
          }}
        >
          <HeaderControl label="Preferences" onClick={onOpenPreferences}>
            <SlidersIcon size={22} />
          </HeaderControl>
          <HeaderControl label="Settings" onClick={onOpenSettings}>
            <GearIcon size={22} />
          </HeaderControl>
          <HeaderControl label="Notifications" onClick={onOpenNotifications}>
            <BellIcon size={22} />
          </HeaderControl>
        </div>

        {/* Avatar hero + pencil-to-edit overlay. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ position: "relative", width: 132, height: 132 }}>
            <Avatar
              name={name}
              userId={getUserId()}
              photoUrl={photoUrl}
              size={132}
              style={{ boxShadow: `0 0 0 3px ${t.surface}, 0 0 0 4px ${t.border}` }}
            />
            <IconButton
              label="Edit profile"
              onClick={onEditProfile}
              size={44}
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                background: t.accentFill,
                border: `2px solid ${t.surface}`,
                color: "#fff",
                boxShadow: t.shadow.md,
              }}
            >
              <PencilIcon size={20} />
            </IconButton>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
            <h1
              style={{
                fontFamily: t.serif,
                fontSize: 28,
                fontWeight: 700,
                margin: 0,
                color: t.text,
              }}
            >
              {name}
            </h1>
            {verified && <VerifiedBadge />}
          </div>
          <p style={{ margin: "6px 0 0", color: t.textSoft, fontSize: 15 }}>
            {plain ? "Tap the pencil to edit your profile." : "Tap the pencil to edit your full profile."}
          </p>
        </div>

        {/* Calm hub rows — destinations, in a single quiet scroll. The
            completeness cue leads (only when there's something still to add). */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
          <CompletenessCue completeness={completeness} onOpenEditField={onOpenEditField} />
          <HubRow
            icon={<EyeIcon size={22} />}
            title="How others see you"
            subtitle={plain ? "See your card the way matches do." : "Preview your card the way matches do."}
            onClick={onOpenPreview}
          />
          <HubRow
            icon={<SparkleIcon size={22} />}
            title="Membership"
            subtitle={isCompanion
              ? "Spectrum Companion"
              : (plain
                ? "See what Companion adds. Everything you use daily is free."
                : "See what Companion adds — everything you use daily is free.")}
            tag={isCompanion ? "Companion" : "Free"}
            onClick={onOpenMembership}
          />
          <HubRow
            icon={<StarIcon size={22} />}
            title="Best fits"
            // Free tier: make the locked state legible on the row so the tap is a
            // known, chosen action (preview what Companion adds) rather than an
            // inviting row that dead-ends at a gate.
            subtitle={isCompanion
              ? (plain
                ? "A calm set of people who may be a good fit."
                : "A calm, curated set of people who may fit well.")
              : (plain
                ? "Part of Companion — see what it adds."
                : "Part of Companion — preview what it adds.")}
            tag={isCompanion ? undefined : "Companion"}
            onClick={onOpenTopPicks}
          />
          <HubRow
            icon={<LockIcon size={22} />}
            title="Account & Security"
            subtitle={plain ? "Password, email, and account settings." : "Password, email, and account controls."}
            onClick={onOpenAccount}
          />
          <HubRow
            icon={<ShieldIcon size={22} />}
            title="Safety Center"
            subtitle={plain ? "Block, report, and get help." : "Blocking, reporting, and support resources."}
            onClick={onOpenSafety}
          />
        </div>
        {onSignOut && <HubSignOut onSignOut={onSignOut} />}
      </div>
    </div>
  );
}
