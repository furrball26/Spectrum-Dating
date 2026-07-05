// Small, consistent inline-SVG icons for Spectrum Dating.
// All icons: 1.5px stroke (1.75 in the nav at 24px), inherit color via
// `currentColor`, accept a `size` prop (default 18). Light "duotone" feel via
// a subtle currentColor fill at low opacity where it reads well. Nav icons
// additionally accept `filled` — the SAME silhouette rendered solid for the
// active tab (never a different drawing; predictability beats flourish).
// Interior detail on filled glyphs is knocked out in the surface color.
// Decorative by default (aria-hidden) — pair with an accessible label on the
// surrounding control.

const KNOCKOUT = "var(--c-surface, #FFFFFF)";

function Svg({ size = 18, strokeWidth = 1.5, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
}

// ─── Nav tab icons ────────────────────────────────────────────────────────────
// Compass for Discover (a browse-at-your-own-pace feed, not a search box).
export function CompassIcon({ size = 24, filled = false, ...rest }) {
  return (
    <Svg size={size} strokeWidth={1.75} {...rest}>
      <circle cx="12" cy="12" r="8.4" fill={filled ? "currentColor" : "none"} />
      <path
        d="M15.4 8.6l-2.1 4.7-4.7 2.1 2.1-4.7z"
        fill={filled ? KNOCKOUT : "none"}
        stroke={filled ? KNOCKOUT : "currentColor"}
        strokeWidth={filled ? 1.2 : 1.75}
      />
    </Svg>
  );
}

// Rounded speech bubble with one continuous tail (no hard-cornered appendix).
export function MessageBubbleIcon({ size = 24, filled = false, ...rest }) {
  return (
    <Svg size={size} strokeWidth={1.75} {...rest}>
      <path
        d="M12 4.4c4.8 0 8.6 3 8.6 6.7s-3.8 6.7-8.6 6.7c-.8 0-1.6-.1-2.4-.3L6 19.6c-.5.3-1.1-.1-1-.7l.4-2.5c-1.3-1.2-2-2.7-2-4.3C3.4 7.4 7.2 4.4 12 4.4z"
        fill={filled ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function ShieldIcon({ size = 18, filled = false, strokeWidth = 1.5, ...rest }) {
  // Rounder shoulders + fuller bottom curve than the old narrow/pointy draw.
  const d = "M12 2.8l6.6 2.6c.5.2.9.7.9 1.3v4.6c0 4.7-3.1 8-7.2 9.6a.9.9 0 0 1-.6 0c-4.1-1.6-7.2-4.9-7.2-9.6V6.7c0-.6.4-1.1.9-1.3L12 2.8z";
  return (
    <Svg size={size} strokeWidth={strokeWidth} {...rest}>
      {!filled && <path d={d} fill="currentColor" fillOpacity={0.12} />}
      <path d={d} fill={filled ? "currentColor" : "none"} />
      <path d="M9 12l2 2 4-4" stroke={filled ? KNOCKOUT : "currentColor"} />
    </Svg>
  );
}

export function LockIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="currentColor" fillOpacity={0.12} />
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function GearIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity={0.12} />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Svg>
  );
}

// Bell — the "Notifications" affordance on the Profile Hub. No badge/urgency
// dot; calm-by-design keeps this a quiet doorway to the settings, not an alert.
export function BellIcon({ size = 18, ...rest }) {
  const d = "M18 16v-5a6 6 0 1 0-12 0v5l-1.8 2.2c-.3.4 0 1 .5 1h14.6c.5 0 .8-.6.5-1L18 16z";
  return (
    <Svg size={size} {...rest}>
      <path d={d} fill="currentColor" fillOpacity={0.12} />
      <path d={d} />
      <path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" />
    </Svg>
  );
}

export function HeartIcon({ size = 18, filled = false, strokeWidth = 1.5, ...rest }) {
  // Symmetric: equal-radius lobes, point on the vertical center line.
  const d = "M12 20.6C6.9 17.2 3.2 13.8 3.2 9.9 3.2 7.2 5.3 5.2 7.9 5.2c1.7 0 3.2.9 4.1 2.3.9-1.4 2.4-2.3 4.1-2.3 2.6 0 4.7 2 4.7 4.7 0 3.9-3.7 7.3-8.8 10.7z";
  return (
    <Svg size={size} strokeWidth={strokeWidth} {...rest}>
      {!filled && <path d={d} fill="currentColor" fillOpacity={0.12} />}
      <path d={d} fill={filled ? "currentColor" : "none"} />
    </Svg>
  );
}

// Two-row slider control — the "Preferences" affordance (matching-filter tuning).
export function SlidersIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 8h9M17 8h3" />
      <circle cx="15" cy="8" r="2.2" fill="currentColor" fillOpacity={0.12} />
      <circle cx="15" cy="8" r="2.2" />
      <path d="M4 16h3M11 16h9" />
      <circle cx="9" cy="16" r="2.2" fill="currentColor" fillOpacity={0.12} />
      <circle cx="9" cy="16" r="2.2" />
    </Svg>
  );
}

// Pencil — the "edit your profile" affordance overlaid on the avatar hero.
export function PencilIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M14.8 5.2l4 4L9 19l-4.4.9.9-4.4z" fill="currentColor" fillOpacity={0.12} />
      <path d="M14.8 5.2l4 4L9 19l-4.4.9.9-4.4z" />
      <path d="M13.3 6.7l4 4" />
    </Svg>
  );
}

// Small chevron — row "opens a destination" affordance for hub cards.
export function ChevronRightIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// Eye — the "How others see you" preview entry.
export function EyeIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="currentColor" fillOpacity={0.12} />
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  );
}

// Sparkle — the calm Membership entry (Companion). No burst/urgency.
export function SparkleIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M12 3.5c.4 3.6 1.9 5.1 5.5 5.5-3.6.4-5.1 1.9-5.5 5.5-.4-3.6-1.9-5.1-5.5-5.5 3.6-.4 5.1-1.9 5.5-5.5z" fill="currentColor" fillOpacity={0.12} />
      <path d="M12 3.5c.4 3.6 1.9 5.1 5.5 5.5-3.6.4-5.1 1.9-5.5 5.5-.4-3.6-1.9-5.1-5.5-5.5 3.6-.4 5.1-1.9 5.5-5.5z" />
      <path d="M18.5 15.5c.2 1.5.8 2.1 2.3 2.3-1.5.2-2.1.8-2.3 2.3-.2-1.5-.8-2.1-2.3-2.3 1.5-.2 2.1-.8 2.3-2.3z" />
    </Svg>
  );
}

// Star (outline) — the "Top Picks" curated best-fits entry.
export function StarIcon({ size = 18, ...rest }) {
  const d = "M12 3.6l2.5 5.1 5.6.8-4.1 4 1 5.6L12 16.4l-5 2.7 1-5.6-4.1-4 5.6-.8z";
  return (
    <Svg size={size} {...rest}>
      <path d={d} fill="currentColor" fillOpacity={0.12} />
      <path d={d} />
    </Svg>
  );
}

export function SealCheckIcon({ size = 18, ...rest }) {
  // A scalloped "seal" with a checkmark — for the Verified pill.
  return (
    <Svg size={size} {...rest}>
      <path
        d="M12 2.6l2.1 1.5 2.6-.3 1.1 2.4 2.4 1.1-.3 2.6 1.5 2.1-1.5 2.1.3 2.6-2.4 1.1-1.1 2.4-2.6-.3L12 21.4l-2.1-1.5-2.6.3-1.1-2.4-2.4-1.1.3-2.6L2.6 12l1.5-2.1-.3-2.6 2.4-1.1 1.1-2.4 2.6.3L12 2.6z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path d="M12 2.6l2.1 1.5 2.6-.3 1.1 2.4 2.4 1.1-.3 2.6 1.5 2.1-1.5 2.1.3 2.6-2.4 1.1-1.1 2.4-2.6-.3L12 21.4l-2.1-1.5-2.6.3-1.1-2.4-2.4-1.1.3-2.6L2.6 12l1.5-2.1-.3-2.6 2.4-1.1 1.1-2.4 2.6.3L12 2.6z" />
      <path d="M8.5 12l2.3 2.3 4.7-4.6" />
    </Svg>
  );
}
