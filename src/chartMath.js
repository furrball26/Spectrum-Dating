// chartMath.js — pure geometry/format helpers for the telemetry charts.
//
// No React, no DOM, no token imports — kept pure so the sparkline projection,
// ranked-bar fraction, and uptime-percent formatting are unit-tested in
// isolation (scripts/qa/chartMath.test.mjs) and can't silently drift. All
// output is static and grounded (calm-by-design): no animation state here.

// Round to 2dp so the SVG point strings stay short and stable.
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Project a numeric series into SVG coordinates inside a (width × height) box
// with `pad` px of vertical breathing room top/bottom. Returns:
//   line   — polyline points string ("x,y x,y …") for the stroked line,
//   area   — polygon points string (line + a baseline) for the soft fill,
//   min/max — resolved data range,
//   points — [[x,y], …] projected coordinates.
// A single point sits centered; a flat series (min===max) rides the vertical
// midline — never a divide-by-zero, never NaN coordinates.
export function sparklineGeometry(values, width = 100, height = 32, pad = 2) {
  const series = Array.isArray(values) ? values : [];
  const n = series.length;
  if (n === 0) return { line: "", area: "", min: 0, max: 0, points: [] };

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const innerH = height - pad * 2;

  const points = series.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = span === 0 ? height / 2 : pad + innerH * (1 - (v - min) / span);
    return [round2(x), round2(y)];
  });

  const line = points.map((p) => p.join(",")).join(" ");
  const firstX = points[0][0];
  const lastX = points[n - 1][0];
  const area = `${firstX},${height} ${line} ${lastX},${height}`;

  return { line, area, min, max, points };
}

// count/max as a clamped 0..1 fraction for a ranked-bar width. Guards a zero or
// missing max (empty dataset) → 0, and clamps out-of-range inputs.
export function barFraction(count, max) {
  const c = Number(count) || 0;
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  const f = c / m;
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  return f;
}

// Uptime percent → a grounded, fixed-2dp string. FLOORS (never rounds up) so a
// value like 99.999 shows "99.99%" instead of an overstated "100.00%": we must
// never round measured downtime away. A genuine 100 (no incidents) stays
// "100.00%", made honest by the "measured at the application layer" label.
export function formatUptimePct(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const clamped = Math.max(0, Math.min(100, Number(n)));
  const floored = Math.floor(clamped * 100) / 100;
  return `${floored.toFixed(2)}%`;
}
