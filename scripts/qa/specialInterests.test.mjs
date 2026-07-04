// D-17 Phase 2 — unit coverage for the structured special-interests helpers.
// These back the "Could talk for hours about" chips: the shared-highlight math
// (a viewer's own special interests visually pop on someone else's card) and the
// save-payload normalisation (caps that MUST match the backend so validation
// never diverges). A regression here would either mis-highlight shared chips,
// let the client submit what the server rejects, or throw on odd input.
//
// Run: node --test scripts/qa/specialInterests.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPECIAL_INTERESTS_MAX,
  SPECIAL_INTEREST_MAX_LEN,
  normalizeSpecialInterests,
  addSpecialInterest,
  sharedSpecialInterests,
} from "../../src/specialInterests.js";

test("caps match the backend (3 items, 40 chars)", () => {
  assert.equal(SPECIAL_INTERESTS_MAX, 3);
  assert.equal(SPECIAL_INTEREST_MAX_LEN, 40);
});

test("sharedSpecialInterests is case-insensitive and returns theirs' casing", () => {
  const shared = sharedSpecialInterests(
    ["Trains", "steam engines"],
    ["steam Engines", "Bird migration", "TRAINS"]
  );
  assert.deepEqual(shared, ["steam Engines", "TRAINS"]);
});

test("sharedSpecialInterests → empty when nothing overlaps", () => {
  assert.deepEqual(sharedSpecialInterests(["cats"], ["dogs", "maps"]), []);
});

test("sharedSpecialInterests never throws on nullish / non-array input", () => {
  for (const [mine, theirs] of [[null, null], [undefined, ["x"]], ["nope", 42], [["x"], undefined]]) {
    assert.deepEqual(sharedSpecialInterests(mine, theirs), []);
  }
});

test("normalizeSpecialInterests trims, drops empties, dedupes (case-insensitive), caps count", () => {
  const out = normalizeSpecialInterests([" Trains ", "trains", "", "  ", "Maps", "Coral reefs", "Birds"]);
  // dedupe keeps first casing ("Trains"), blanks dropped, capped at 3.
  assert.deepEqual(out, ["Trains", "Maps", "Coral reefs"]);
});

test("normalizeSpecialInterests enforces the 40-char per-item cap", () => {
  const long = "a".repeat(60);
  const out = normalizeSpecialInterests([long]);
  assert.equal(out[0].length, SPECIAL_INTEREST_MAX_LEN);
});

test("normalizeSpecialInterests skips non-strings and never throws", () => {
  assert.deepEqual(normalizeSpecialInterests([null, 5, {}, "ok"]), ["ok"]);
  assert.deepEqual(normalizeSpecialInterests(null), []);
  assert.deepEqual(normalizeSpecialInterests("nope"), []);
});

test("addSpecialInterest appends trimmed and returns a new array", () => {
  const items = ["Trains"];
  const next = addSpecialInterest(items, "  Maps ");
  assert.deepEqual(next, ["Trains", "Maps"]);
  assert.notEqual(next, items);
});

test("addSpecialInterest returns the SAME ref on no-op (blank / dup / at cap)", () => {
  const items = ["Trains", "Maps"];
  assert.equal(addSpecialInterest(items, "   "), items, "blank is a no-op");
  assert.equal(addSpecialInterest(items, "trains"), items, "case-insensitive dup is a no-op");
  const full = ["a", "b", "c"];
  assert.equal(addSpecialInterest(full, "d"), full, "at-cap is a no-op");
});

test("addSpecialInterest truncates to the per-item cap", () => {
  const out = addSpecialInterest([], "a".repeat(60));
  assert.equal(out[0].length, SPECIAL_INTEREST_MAX_LEN);
});
