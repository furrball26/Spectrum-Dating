// Unit coverage for src/chartMath.js — the pure math behind the telemetry
// charts (Sparkline projection, RankedBars fraction, uptime-% formatting).
// These render admin-only screens the QA browser harness can't reach (admin
// gating → 403), so this node --test suite is the regression net for the math.
//
// Run: node --test scripts/qa/chartMath.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import { sparklineGeometry, barFraction, formatUptimePct } from "../../src/chartMath.js";

test("sparklineGeometry: empty series → empty strings, no NaN", () => {
  const g = sparklineGeometry([], 100, 32);
  assert.equal(g.line, "");
  assert.equal(g.area, "");
  assert.deepEqual(g.points, []);
});

test("sparklineGeometry: single point sits centered horizontally", () => {
  const g = sparklineGeometry([5], 100, 32, 2);
  assert.equal(g.points.length, 1);
  assert.equal(g.points[0][0], 50); // width/2
});

test("sparklineGeometry: flat series rides the vertical midline", () => {
  const g = sparklineGeometry([7, 7, 7], 100, 40, 2);
  // span === 0 → every y is height/2, never divide-by-zero
  for (const [, y] of g.points) assert.equal(y, 20);
});

test("sparklineGeometry: endpoints span the full width; peak is at the top pad", () => {
  const g = sparklineGeometry([0, 10], 100, 32, 3);
  assert.equal(g.points[0][0], 0);   // first x
  assert.equal(g.points[1][0], 100); // last x
  // Max value maps to the top → y = pad; min → bottom (height - pad).
  assert.equal(g.points[1][1], 3);   // pad
  assert.equal(g.points[0][1], 29);  // height - pad
});

test("sparklineGeometry: area polygon closes back to the baseline", () => {
  const g = sparklineGeometry([1, 2, 3], 90, 30, 2);
  assert.ok(g.area.startsWith("0,30 "), g.area);
  assert.ok(g.area.endsWith(" 90,30"), g.area);
});

test("barFraction: count/max, clamped, zero-max safe", () => {
  assert.equal(barFraction(5, 10), 0.5);
  assert.equal(barFraction(10, 10), 1);
  assert.equal(barFraction(3, 0), 0);   // no divide-by-zero
  assert.equal(barFraction(0, 8), 0);
  assert.equal(barFraction(20, 10), 1); // clamped
  assert.equal(barFraction(-4, 10), 0); // clamped
});

test("formatUptimePct: fixed 2dp, floored so downtime is never rounded away", () => {
  assert.equal(formatUptimePct(100), "100.00%");
  assert.equal(formatUptimePct(99.999), "99.99%"); // floored, not "100.00%"
  assert.equal(formatUptimePct(99.985), "99.98%"); // floored, not rounded up
  assert.equal(formatUptimePct(0), "0.00%");
});

test("formatUptimePct: clamps range and handles bad input", () => {
  assert.equal(formatUptimePct(120), "100.00%");
  assert.equal(formatUptimePct(-5), "0.00%");
  assert.equal(formatUptimePct(null), "—");
  assert.equal(formatUptimePct(NaN), "—");
});
