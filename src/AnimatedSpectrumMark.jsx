import { useState, useEffect } from "react";
import SpectrumMark from "./SpectrumMark.jsx";

// AnimatedSpectrumMark — a "living logo" version of the brand mark: the same six
// rounded tiles stepping across the calm green→teal→sand ramp, but they *assemble*
// on mount. Each tile fades + rises a few px + grows from slightly small, staggered
// left→right (~70ms apart) with the brand's gentle deceleration easing, settling
// into the exact static SpectrumMark. The motion is one-shot, opacity-led, ≤6px
// travel — calm by design, never bouncy or looping-distracting.
//
// `idle` (default OFF) adds a *very* subtle, slow brightness "breathing" that
// sweeps once across the tiles on a long ~6.5s loop — a quiet brand heartbeat,
// appropriate only for a moment like the landing hero. The header keeps it OFF.
//
// Reduced motion (system `prefers-reduced-motion: reduce` OR the app's injected
// reduce-motion sheet) → render the plain static SpectrumMark with zero motion.
// Decorative only (aria-hidden); pair with the "Spectrum" wordmark for the name.

// Brand tile ramp — literal hex, intentionally un-themed (matches SpectrumMark /
// Spectrum / MatchMoment).
const TILE_COLORS = [
  "var(--mark-1, #5E9459)", // green
  "var(--mark-2, #4F8A8B)", // teal
  "var(--mark-3, #3E6660)", // deep teal
  "var(--mark-4, #6FA39A)", // soft teal-green
  "var(--mark-5, #C9A875)", // clay
  "var(--mark-6, #E7D9C4)", // sand
];

const STAGGER = 70;        // ms between each tile assembling
const ASSEMBLE_MS = 420;   // per-tile assemble duration (== t.motion.slow)
const GENTLE = "cubic-bezier(0.33,1,0.68,1)"; // == t.motion.gentle
const IDLE_MS = 6500;      // very slow idle "breathing" loop

// Keyframes injected once. We deliberately animate `transform` + `opacity` only
// (compositor-friendly). The global App reduce-motion sheet zeroes
// animation-duration / iteration-count, but we ALSO gate on the hook below so the
// static mark is what renders under reduced motion — no flash of an unsettled frame.
const STYLE_ID = "animated-spectrum-mark-keyframes";
const CSS = `
@keyframes spectrumTileAssemble {
  from { opacity: 0; transform: translateY(6px) scale(0.86); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
@keyframes spectrumTileBreath {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(1.06); }
}`;

function ensureStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Reads the in-app "Reduce motion" / "Low stimulation" preference (localStorage).
function readInAppReduceMotion() {
  try {
    const p = JSON.parse(localStorage.getItem("spectrum_a11y") || "{}");
    return !!(p.reduceMotion || p.reducedSensory);
  } catch { return false; }
}

// Dynamic prefers-reduced-motion — honours BOTH the OS setting and the in-app toggle.
function usePrefersReduced() {
  const [prefersReduced, setPrefersReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches || readInAppReduceMotion()
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setPrefersReduced(mq.matches || readInAppReduceMotion());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return prefersReduced;
}

export default function AnimatedSpectrumMark({
  height = 18,
  idle = false,
  gap,
  radius = 2,
  style,
}) {
  const prefersReduced = usePrefersReduced();

  // Under reduced motion, fall back to the exact static mark — zero motion.
  if (prefersReduced) {
    return <SpectrumMark height={height} gap={gap} radius={radius} style={style} />;
  }

  ensureStyle();

  const tile = height; // square tiles, same geometry as SpectrumMark
  const g = gap == null ? Math.max(1, Math.round(height * 0.16)) : gap;
  const width = TILE_COLORS.length * tile + (TILE_COLORS.length - 1) * g;

  // Total time for the assembly to finish — used to delay the idle so it never
  // overlaps the entrance.
  const assembleDone = (TILE_COLORS.length - 1) * STAGGER + ASSEMBLE_MS;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      {TILE_COLORS.map((c, i) => {
        const assemble = `spectrumTileAssemble ${ASSEMBLE_MS}ms ${GENTLE} ${i * STAGGER}ms both`;
        // Optional idle: gentle sequential brightness sweep, starting only after
        // the assembly settles, looping slowly. Staggered so it reads as a soft
        // wave rather than a flat flicker.
        const breath = idle
          ? `, spectrumTileBreath ${IDLE_MS}ms ease-in-out ${assembleDone + i * STAGGER}ms infinite`
          : "";
        return (
          <rect
            key={i}
            x={i * (tile + g)}
            y={0}
            width={tile}
            height={tile}
            rx={radius}
            ry={radius}
            fill={c}
            // Edge (matches static SpectrumMark) so a WHITE flag tile reads on
            // the white header at real device DPI — a 10% hairline vanished.
            stroke="rgba(0,0,0,0.20)"
            strokeWidth={Math.max(0.75, height * 0.055)}
            style={{
              // transform-box: fill-box makes transform-origin relative to the
              // tile's own bounding box, so it scales in place rather than drifting.
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: assemble + breath,
            }}
          />
        );
      })}
    </svg>
  );
}
