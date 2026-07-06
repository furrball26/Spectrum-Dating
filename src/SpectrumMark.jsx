// SpectrumMark — the brand logo motif: a horizontal row of 6 rounded-rectangle
// tiles stepping across a calm green→teal→sand ramp. Decorative only
// (aria-hidden); pair with the "Spectrum" wordmark for the accessible name.
//
// `height` controls tile height (default 18); width is derived from the tiles
// so the mark scales cleanly. Tiles are square-ish with a small gap.

// Tile colors come from the --mark-* CSS vars (index.html, defined once for
// both themes — the logo stays constant). Fallbacks are the canonical ramp.
const TILE_COLORS = [
  "var(--mark-1, #5E9459)", // green
  "var(--mark-2, #4F8A8B)", // teal
  "var(--mark-3, #3E6660)", // deep teal
  "var(--mark-4, #6FA39A)", // soft teal-green
  "var(--mark-5, #C9A875)", // clay
  "var(--mark-6, #E7D9C4)", // sand
];

export default function SpectrumMark({ height = 18, gap, radius = 2, style }) {
  const tile = height;                       // square tiles
  const g = gap == null ? Math.max(1, Math.round(height * 0.16)) : gap;
  const width = TILE_COLORS.length * tile + (TILE_COLORS.length - 1) * g;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      {TILE_COLORS.map((c, i) => (
        <rect
          key={i}
          x={i * (tile + g)}
          y={0}
          width={tile}
          height={tile}
          rx={radius}
          ry={radius}
          fill={c}
          // Edge so a WHITE flag tile (trans theme) reads on the white header
          // surface — a 10% hairline vanished at real device DPI, so this is a
          // firmer ~1px line. Still subtle on colored tiles (their fill already
          // contrasts the surface); it only becomes load-bearing for white tiles.
          stroke="rgba(0,0,0,0.20)"
          strokeWidth={Math.max(0.75, height * 0.055)}
        />
      ))}
    </svg>
  );
}
