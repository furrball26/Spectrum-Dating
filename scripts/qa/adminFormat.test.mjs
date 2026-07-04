// Unit coverage for src/adminFormat.js — the Moderation Console's duration/SLA
// helpers. These back the calm, grounded queue labels ("waiting 3 days",
// "oldest 5 hours") and the amber past-SLA threshold. A regression here would
// either mis-state how stale a backlog is, or flip a calm queue to amber (or
// hide a genuinely-stale one) — both erode moderator trust. Calm-by-design law:
// coarse, static, single-unit labels; amber ONLY past the SLA; never a ticker.
//
// Run: node --test scripts/qa/adminFormat.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLA_MS,
  formatDuration,
  waitingLabel,
  oldestLabel,
  accountAgeLabel,
  isPastSla,
} from "../../src/adminFormat.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;

test("SLA is 48 hours", () => {
  assert.equal(SLA_MS, 48 * HR);
});

test("formatDuration picks one coarse, rounded-down unit", () => {
  assert.equal(formatDuration(0), "less than a minute");
  assert.equal(formatDuration(30 * SEC), "less than a minute");
  assert.equal(formatDuration(59 * SEC), "less than a minute");
  assert.equal(formatDuration(MIN), "1 minute");
  assert.equal(formatDuration(2 * MIN), "2 minutes");
  assert.equal(formatDuration(59 * MIN), "59 minutes");
  assert.equal(formatDuration(HR), "1 hour");
  assert.equal(formatDuration(5 * HR + 40 * MIN), "5 hours", "rounds down, one unit only");
  assert.equal(formatDuration(23 * HR), "23 hours");
  assert.equal(formatDuration(DAY), "1 day");
  assert.equal(formatDuration(3 * DAY), "3 days");
  assert.equal(formatDuration(29 * DAY), "29 days");
  assert.equal(formatDuration(30 * DAY), "1 month");
  assert.equal(formatDuration(90 * DAY), "3 months");
  assert.equal(formatDuration(365 * DAY), "1 year");
  assert.equal(formatDuration(800 * DAY), "2 years");
});

test("formatDuration is safe on nullish / NaN / negative spans", () => {
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(formatDuration(-5000), "less than a minute", "negative clamps to 0");
});

test("waitingLabel composes 'waiting <duration>' from an epoch + now", () => {
  const now = 1_000_000_000_000;
  assert.equal(waitingLabel(now - 3 * DAY, now), "waiting 3 days");
  assert.equal(waitingLabel(now - 90 * MIN, now), "waiting 1 hour");
  assert.equal(waitingLabel(null, now), "", "null epoch → empty (nothing waiting)");
});

test("oldestLabel composes 'oldest <duration>', null epoch → null (empty queue)", () => {
  const now = 1_000_000_000_000;
  assert.equal(oldestLabel(now - 5 * HR, now), "oldest 5 hours");
  assert.equal(oldestLabel(null, now), null, "empty queue → null so caller shows 'All clear'");
});

test("accountAgeLabel is a bare duration, null epoch → ''", () => {
  const now = 1_000_000_000_000;
  assert.equal(accountAgeLabel(now - 400 * DAY, now), "1 year");
  assert.equal(accountAgeLabel(null, now), "");
});

test("isPastSla: amber only past the SLA, and only for a non-empty queue", () => {
  const now = 1_000_000_000_000;
  assert.equal(isPastSla(now - 47 * HR, now), false, "under 48h is calm");
  assert.equal(isPastSla(now - 48 * HR, now), false, "exactly at the threshold is not yet past");
  assert.equal(isPastSla(now - 49 * HR, now), true, "past 48h is amber");
  assert.equal(isPastSla(null, now), false, "empty queue (null epoch) is never amber");
  assert.equal(isPastSla(now - 10 * DAY, now, 5 * DAY), true, "custom SLA honored");
});
