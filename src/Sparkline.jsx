import { t } from "./tokens.js";
import { sparklineGeometry } from "./chartMath.js";

// Inline-SVG area+line sparkline for a numeric series (visits over time).
// STATIC and reduced-motion-safe by construction — there is no animation, no
// interaction, no live ticker. It's decorative: the grounded totals live in the
// StatCards beside it, so the SVG carries a plain-language aria-label and the
// numbers are never conveyed by the shape alone. Single accent color from
// tokens (theme-aware). preserveAspectRatio="none" lets it stretch to width.
export default function Sparkline({ values, width = 320, height = 56, ariaLabel }) {
  const series = Array.isArray(values)
    ? values.filter((v) => typeof v === "number" && !Number.isNaN(v))
    : [];

  if (series.length === 0) {
    return (
      <div style={{ fontSize: 14, color: t.textMuted }}>
        No visits in this window yet.
      </div>
    );
  }

  const { line, area } = sparklineGeometry(series, width, height, 3);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel || "Visits over time"}
      style={{ display: "block", overflow: "visible" }}
    >
      <polygon points={area} fill={t.accentFill} fillOpacity="0.14" />
      <polyline
        points={line}
        fill="none"
        stroke={t.accentFill}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
