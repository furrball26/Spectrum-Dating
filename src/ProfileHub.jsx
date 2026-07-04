import { t } from "./tokens.js";
import Avatar from "./Avatar.jsx";
import VerifiedBadge from "./VerifiedBadge.jsx";
import { useFocusable } from "./useFocusable.js";
import { getUserId } from "./api.js";
import {
  SlidersIcon,
  GearIcon,
  PencilIcon,
  ChevronRightIcon,
  EyeIcon,
  SparkleIcon,
  StarIcon,
  ShieldIcon,
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

export default function ProfileHub({
  displayName,
  photoUrl,
  verified = false,
  tier = "free",
  onEditProfile,
  onOpenPreferences,
  onOpenSettings,
  onOpenPreview,
  onOpenMembership,
  onOpenTopPicks,
  onOpenSafety,
}) {
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
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <IconButton label="Preferences" onClick={onOpenPreferences}>
            <SlidersIcon size={22} />
          </IconButton>
          <IconButton label="Settings" onClick={onOpenSettings}>
            <GearIcon size={22} />
          </IconButton>
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
            Tap the pencil to edit your full profile.
          </p>
        </div>

        {/* Calm hub rows — destinations, in a single quiet scroll. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
          <HubRow
            icon={<EyeIcon size={22} />}
            title="How others see you"
            subtitle="Preview your card the way matches do."
            onClick={onOpenPreview}
          />
          <HubRow
            icon={<SparkleIcon size={22} />}
            title="Membership"
            subtitle={isCompanion ? "Spectrum Companion" : "See what Companion adds — everything you use daily is free."}
            tag={isCompanion ? "Companion" : "Free"}
            onClick={onOpenMembership}
          />
          <HubRow
            icon={<StarIcon size={22} />}
            title="Top Picks"
            subtitle="A calm, curated set of people who may fit well."
            tag={isCompanion ? undefined : "Companion"}
            onClick={onOpenTopPicks}
          />
          <HubRow
            icon={<ShieldIcon size={22} />}
            title="Safety Center"
            subtitle="Blocking, reporting, and support resources."
            onClick={onOpenSafety}
          />
        </div>
      </div>
    </div>
  );
}
