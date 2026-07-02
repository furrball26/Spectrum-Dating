import { t } from "./tokens.js";

// Spectrum — the brand tile motif promoted to a small system primitive.
// Reuses the 6-colour green→teal→sand ramp from SpectrumMark.jsx. Decorative
// by default (aria-hidden); pass an `aria-label` to give a variant a name.
//
// Variants:
//  - progress: `count` tiles; the first `value` filled with their ramp colour,
//              the rest at 12% opacity. For calm step indicators.
//  - loader:   3 tiles that cross-fade green↔teal↔sand on a ~1400ms loop. Static
//              under reduce-motion (the global App sheet zeroes the duration; we
//              also start from a settled frame so it reads fine frozen).
//  - meter:    `count` tiles, `value` lit across the ramp (compatibility view —
//              never a number).
//  - divider:  a 1px rule that becomes 6 tiny 3px tiles at its centre.
//
// Colours come from the brand ramp constant (literal hex — these are the fixed
// brand tile colours, intentionally NOT themed, same as SpectrumMark).

const RAMP = [
  "var(--mark-1, #5E9459)", // green
  "var(--mark-2, #4F8A8B)", // teal
  "var(--mark-3, #3E6660)", // deep teal
  "var(--mark-4, #6FA39A)", // soft teal-green
  "var(--mark-5, #C9A875)", // clay
  "var(--mark-6, #E7D9C4)", // sand
];

// Pick a colour from the ramp for index i out of n tiles, spread across the ramp.
function rampColor(i, n) {
  if (n <= 1) return RAMP[0];
  const pos = (i / (n - 1)) * (RAMP.length - 1);
  return RAMP[Math.round(pos)];
}

// Keyframes for the loader cross-fade. Injected once.
const LOADER_STYLE_ID = "spectrum-loader-keyframes";
const LOADER_CSS = `
@keyframes spectrumTileFade {
  0%, 100% { opacity: 0.25; }
  40%      { opacity: 1; }
}`;

function ensureLoaderStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(LOADER_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = LOADER_STYLE_ID;
  el.textContent = LOADER_CSS;
  document.head.appendChild(el);
}

export default function Spectrum({
  variant = "progress",
  value = 0,
  count = 6,
  size = 8,
  gap = 4,
  radius = 2,
  style,
  ...rest
}) {
  const a11y = rest["aria-label"]
    ? { role: "img", "aria-label": rest["aria-label"] }
    : { "aria-hidden": "true" };
  const passThrough = { ...rest };
  delete passThrough["aria-label"];

  if (variant === "loader") {
    ensureLoaderStyle();
    // 3 tiles spanning green → teal → sand, staggered cross-fade.
    const loaderColors = [RAMP[0], RAMP[1], RAMP[5]];
    return (
      <div
        {...a11y}
        {...passThrough}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap,
          verticalAlign: "middle",
          ...style,
        }}
      >
        {loaderColors.map((c, i) => (
          <span
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              background: c,
              display: "inline-block",
              animation: `spectrumTileFade 1400ms ${t.motion.gentle} ${i * 200}ms infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "divider") {
    // A hairline rule that swells into 6 tiny 3px tiles at its centre.
    const dot = 3;
    return (
      <div
        {...a11y}
        {...passThrough}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          ...style,
        }}
      >
        <span style={{ flex: 1, height: 1, background: t.border }} />
        <span style={{ display: "inline-flex", gap: 3 }}>
          {RAMP.map((c, i) => (
            <span
              key={i}
              style={{ width: dot, height: dot, borderRadius: 1, background: c }}
            />
          ))}
        </span>
        <span style={{ flex: 1, height: 1, background: t.border }} />
      </div>
    );
  }

  // progress + meter share the lit/unlit tile layout.
  const n = Math.max(1, count);
  const lit = Math.max(0, Math.min(n, Math.round(value)));
  return (
    <div
      {...a11y}
      {...passThrough}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        verticalAlign: "middle",
        ...style,
      }}
    >
      {Array.from({ length: n }).map((_, i) => {
        const isLit = i < lit;
        const c = rampColor(i, n);
        return (
          <span
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              background: c,
              opacity: isLit ? 1 : 0.12,
              display: "inline-block",
              transition: `opacity ${t.motion.base} ${t.motion.standard}`,
            }}
          />
        );
      })}
    </div>
  );
}
