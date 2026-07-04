// Unit coverage for the traveler / at-risk region banner gating.
// shouldShowRegionAlert is the single source of truth for whether the calm
// "you may be somewhere LGBTQ+ people face risk" banner appears. A regression
// here would either nag the member (showing after dismissal) or fail to warn
// an at-risk member.
//
// Run: node --test scripts/qa/regionSafety.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowRegionAlert, REGION_ALERT_SESSION_KEY } from "../../src/regionSafety.js";

test("shows when at-risk and not yet seen this session", () => {
  assert.equal(shouldShowRegionAlert(true, null), true);
  assert.equal(shouldShowRegionAlert(true, undefined), true);
  assert.equal(shouldShowRegionAlert(true, ""), true);
});

test("does NOT show once seen/dismissed this session", () => {
  assert.equal(shouldShowRegionAlert(true, "1"), false);
});

test("never shows when not at-risk, regardless of the seen flag", () => {
  assert.equal(shouldShowRegionAlert(false, null), false);
  assert.equal(shouldShowRegionAlert(false, "1"), false);
});

test("only a strict boolean true trips the alert (no truthy coercion)", () => {
  for (const v of [1, "true", "yes", {}, [], "US"]) {
    assert.equal(shouldShowRegionAlert(v, null), false, `atRisk=${JSON.stringify(v)} must not show`);
  }
  assert.equal(shouldShowRegionAlert(null, null), false);
  assert.equal(shouldShowRegionAlert(undefined, null), false);
});

test("exports a stable session-storage key", () => {
  assert.equal(REGION_ALERT_SESSION_KEY, "spectrum:regionAlertSeen");
});
