// Unit coverage for src/commChips.js — the shared comms/sensory/social
// preference → plain-language chip mapping used by both MatchProfileModal and
// the conversation "What to expect" card. The two views MUST stay identical, so
// this pins every enum branch, the intentionally-skipped "either/whenever/medium"
// low-signal values, and the nullish guard.
//
// Run: node --test scripts/qa/commChips.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import { commChips } from "../../src/commChips.js";

test("nullish / empty profile yields an empty chip list", () => {
  assert.deepEqual(commChips(null), []);
  assert.deepEqual(commChips(undefined), []);
  assert.deepEqual(commChips({}), []);
});

test("each recognised enum value maps to its exact chip", () => {
  const cases = [
    [{ commDirectness: "direct" }, "Direct"],
    [{ commDirectness: "softened" }, "Softened"],
    [{ commLiteral: "literal" }, "Literal"],
    [{ commLiteral: "playful" }, "Playful"],
    [{ commCadence: "instant" }, "Quick replies"],
    [{ commCadence: "daily" }, "Replies once a day"],
    [{ sensoryEnvironment: "quiet" }, "Quiet settings"],
    [{ sensoryEnvironment: "lively" }, "Lively settings"],
    [{ sensoryLighting: "dim" }, "Dim lighting"],
    [{ sensoryLighting: "bright" }, "Bright lighting"],
    [{ socialDuration: "short" }, "Short meetups"],
    [{ socialDuration: "long" }, "Longer meetups"],
  ];
  for (const [profile, chip] of cases) {
    assert.deepEqual(commChips(profile), [chip], `${JSON.stringify(profile)} → ${chip}`);
  }
});

test("low-signal / unknown enum values produce no chip", () => {
  assert.deepEqual(commChips({ commCadence: "whenever" }), []);
  assert.deepEqual(commChips({ sensoryEnvironment: "either" }), []);
  assert.deepEqual(commChips({ sensoryLighting: "either" }), []);
  assert.deepEqual(commChips({ socialDuration: "medium" }), []);
  assert.deepEqual(commChips({ commDirectness: "somethingelse" }), []);
  assert.deepEqual(
    commChips({ commDirectness: "", commLiteral: "", commCadence: "" }),
    [],
    "empty-string fields (the backend default) map to nothing",
  );
});

test("a fully-specified profile emits all six chips in field order", () => {
  const profile = {
    commDirectness: "direct",
    commLiteral: "playful",
    commCadence: "instant",
    sensoryEnvironment: "quiet",
    sensoryLighting: "dim",
    socialDuration: "long",
  };
  assert.deepEqual(commChips(profile), [
    "Direct",
    "Playful",
    "Quick replies",
    "Quiet settings",
    "Dim lighting",
    "Longer meetups",
  ]);
});

test("only the set fields render; unset/low-signal ones are skipped, order preserved", () => {
  const profile = {
    commDirectness: "softened",
    commLiteral: "either", // not a mapped value → skipped
    commCadence: "daily",
    sensoryEnvironment: "either", // skipped
    socialDuration: "short",
  };
  assert.deepEqual(commChips(profile), [
    "Softened",
    "Replies once a day",
    "Short meetups",
  ]);
});
