// SpectrumMark — the brand logo motif: a horizontal row of 6 rounded-rectangle
// tiles stepping across a calm green→teal→sand ramp. Decorative only
// (aria-hidden); pair with the "Spectrum" wordmark for the accessible name.
//
// `height` controls tile height (default 18); width is derived from the tiles
// so the mark scales cleanly. Tiles are square-ish with a small gap.

const TILE_COLORS = [
  "#5E9459", // green
  "#4F8A8B", // teal
  "#3E6660", // deep teal
  "#6FA39A", // soft teal-green
  "#C9A875", // clay
  "#E7D9C4", // sand
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
        />
      ))}
    </svg>
  );
}
