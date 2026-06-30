// Calm, single-weight line illustrations for empty states.
// Soft, rounded, generous negative space, transparent background. Strokes use
// the themed accent/clay tokens so they adapt to light/dim. Decorative only
// (aria-hidden) — always pair with the surrounding copy for meaning.
//
// All accept a `size` prop (default 112) and keep a 1.5px stroke to match the
// app's icon language.

function Frame({ size = 112, children, label }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
      role="img"
      aria-label={label}
      style={{ display: "block", margin: "0 auto" }}
    >
      {children}
    </svg>
  );
}

// EmptyMatches — two simple cups beside a small sprig: a calm "share a cuppa"
// motif for when there are no matches yet.
export function EmptyMatches({ size = 112, color = "var(--c-accent, #5B8A82)", accent = "var(--c-clay, #C9A875)" }) {
  return (
    <Frame size={size}>
      {/* Left cup */}
      <path
        d="M30 58 h26 v14 a13 13 0 0 1 -13 13 a13 13 0 0 1 -13 -13 z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M56 62 a8 8 0 0 1 0 14"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Right cup */}
      <path
        d="M68 62 h22 v11 a11 11 0 0 1 -11 11 a11 11 0 0 1 -11 -11 z"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M90 65 a7 7 0 0 1 0 12"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Gentle steam */}
      <path d="M40 46 q4 -5 0 -10" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
      <path d="M48 46 q4 -5 0 -10" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
      <path d="M78 50 q3 -4 0 -8" stroke={accent} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
    </Frame>
  );
}

// EmptyMessages — a soft, rounded speech shape with a few resting dots.
export function EmptyMessages({ size = 112, color = "var(--c-accent, #5B8A82)", accent = "var(--c-clay, #C9A875)" }) {
  return (
    <Frame size={size}>
      <path
        d="M32 38 h56 a12 12 0 0 1 12 12 v22 a12 12 0 0 1 -12 12 h-30 l-16 14 v-14 h-10 a12 12 0 0 1 -12 -12 v-22 a12 12 0 0 1 12 -12 z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="61" r="3" fill={color} />
      <circle cx="60" cy="61" r="3" fill={accent} />
      <circle cx="72" cy="61" r="3" fill={color} />
    </Frame>
  );
}

// AllCaughtUp — a calm sun resting on a soft horizon.
export function AllCaughtUp({ size = 112, color = "var(--c-accent, #5B8A82)", accent = "var(--c-clay, #C9A875)" }) {
  return (
    <Frame size={size}>
      {/* Sun */}
      <path
        d="M42 70 a18 18 0 0 1 36 0"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Rays */}
      <path d="M60 40 v-8" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M40 48 l-5 -5" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M80 48 l5 -5" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      {/* Horizon */}
      <path d="M24 70 h72" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M34 80 h24" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.6} />
      <path d="M66 80 h20" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.6} />
    </Frame>
  );
}

// GenericError — a gently tilted rounded square with a calm "!" resting inside:
// a quiet "something's off" glyph. No alarm, no faces; just slightly out-of-true.
export function GenericError({ size = 112, color = "var(--c-accent, #5B8A82)", accent = "var(--c-clay, #C9A875)" }) {
  return (
    <Frame size={size}>
      {/* Tilted rounded square */}
      <rect
        x="36"
        y="36"
        width="48"
        height="48"
        rx="12"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        transform="rotate(-8 60 60)"
      />
      {/* A quiet "!" laid out gently inside — never shouting */}
      <path d="M60 50 v14" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx="60" cy="72" r="2" fill={accent} />
    </Frame>
  );
}

// Offline — a soft cloud with a gentle gap below it: a calm "disconnected" motif.
export function Offline({ size = 112, color = "var(--c-accent, #5B8A82)", accent = "var(--c-clay, #C9A875)" }) {
  return (
    <Frame size={size}>
      {/* Cloud */}
      <path
        d="M42 70 a14 14 0 0 1 2 -27 a16 16 0 0 1 30 4 a11 11 0 0 1 2 23 z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Disconnected dashes drifting below — the "no signal" rest */}
      <path d="M44 82 h10" stroke={accent} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
      <path d="M62 82 h6"  stroke={accent} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <path d="M74 82 h4"  stroke={accent} strokeWidth={1.5} strokeLinecap="round" opacity={0.35} />
    </Frame>
  );
}
