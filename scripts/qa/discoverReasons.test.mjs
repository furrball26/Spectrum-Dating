// D-1/D-2 — unit coverage for the Discover "why you fit" moat logic (extracted
// from SuggestionScreen into src/discoverReasons.js). This is our matching-
// presentation differentiation: a regression here silently degrades how fit is
// shown (one-sided context masquerading as a mutual ✓, the comm-note echoing
// twice, or the wrong 1–2 leading above the fold). We test the pure helpers plus
// the exact composition pipeline the component runs.
//
// Run: node --test scripts/qa/discoverReasons.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMutualReason,
  isCommNoteReason,
  sortReasonsMutualFirst,
} from "../../src/discoverReasons.js";

test("isMutualReason — only 'you both' / 'you're both' phrasings are mutual", () => {
  assert.equal(isMutualReason("You both love hiking"), true);
  assert.equal(isMutualReason("You're both early risers"), true);
  assert.equal(isMutualReason("Youre both into board games"), true, "apostrophe optional");
  assert.equal(isMutualReason("you both prefer quiet settings"), true, "case-insensitive");
  assert.equal(isMutualReason("   You both like tea"), true, "leading whitespace trimmed");
});

test("isMutualReason — one-sided / contextual reasons are NOT mutual", () => {
  assert.equal(isMutualReason("Likes long walks"), false);
  assert.equal(isMutualReason("About talking: prefers direct replies"), false);
  assert.equal(isMutualReason("You seem to share an interest"), false, "'you' alone is not 'you both'");
  assert.equal(isMutualReason("Both of you like hiking"), false, "must lead with 'you both'");
});

test("isMutualReason — nullish / empty inputs are false (never throw)", () => {
  assert.equal(isMutualReason(""), false);
  assert.equal(isMutualReason(undefined), false);
  assert.equal(isMutualReason(null), false);
});

test("isCommNoteReason — only the backend 'About talking:' echo matches", () => {
  assert.equal(isCommNoteReason("About talking: I take a while to reply"), true);
  assert.equal(isCommNoteReason("about talking: literal, please"), true, "case-insensitive");
  assert.equal(isCommNoteReason("  About talking: hi"), true, "leading whitespace trimmed");
  assert.equal(isCommNoteReason("You both like talking about films"), false);
  assert.equal(isCommNoteReason("Talking about hiking"), false);
  assert.equal(isCommNoteReason(""), false);
  assert.equal(isCommNoteReason(undefined), false);
});

test("sortReasonsMutualFirst — mutual signals lead, order preserved within groups", () => {
  const input = [
    "Likes board games",
    "You both love hiking",
    "About talking: direct",
    "You're both night owls",
  ];
  assert.deepEqual(sortReasonsMutualFirst(input), [
    "You both love hiking",
    "You're both night owls",
    "Likes board games",
    "About talking: direct",
  ]);
});

test("sortReasonsMutualFirst — is stable and non-mutating", () => {
  const input = ["A one", "You both b", "C one", "You both d"];
  const out = sortReasonsMutualFirst(input);
  assert.deepEqual(out, ["You both b", "You both d", "A one", "C one"]);
  // original array untouched
  assert.deepEqual(input, ["A one", "You both b", "C one", "You both d"]);
});

test("sortReasonsMutualFirst — non-array / empty inputs yield []", () => {
  assert.deepEqual(sortReasonsMutualFirst(undefined), []);
  assert.deepEqual(sortReasonsMutualFirst(null), []);
  assert.deepEqual(sortReasonsMutualFirst("nope"), []);
  assert.deepEqual(sortReasonsMutualFirst([]), []);
});

// The exact pipeline SuggestionScreen runs to build the above-the-fold hook:
//   sortedWhy = sortReasonsMutualFirst(reasons.filter(r => !isCommNoteReason(r)))
//   topWhy    = sortedWhy.slice(0, 2)
//   restWhy   = sortedWhy.slice(2)
function buildWhy(reasons) {
  const sorted = sortReasonsMutualFirst((reasons || []).filter((r) => !isCommNoteReason(r)));
  return { sorted, topWhy: sorted.slice(0, 2), restWhy: sorted.slice(2) };
}

test("composition — comm-note reasons are filtered out of the why list entirely", () => {
  const { sorted } = buildWhy([
    "You both love hiking",
    "About talking: I reply slowly",
    "Likes tea",
  ]);
  assert.ok(!sorted.some(isCommNoteReason), "no 'About talking:' line survives");
  assert.deepEqual(sorted, ["You both love hiking", "Likes tea"]);
});

test("composition — topWhy takes the strongest 1–2 (mutual first), restWhy gets the rest", () => {
  const { topWhy, restWhy } = buildWhy([
    "Likes board games",
    "You both love hiking",
    "About talking: direct",
    "You're both night owls",
    "Enjoys museums",
  ]);
  // Both mutual signals lead and fill the 2-slot hook.
  assert.deepEqual(topWhy, ["You both love hiking", "You're both night owls"]);
  assert.equal(topWhy.length, 2, "topWhy is capped at 2");
  assert.deepEqual(restWhy, ["Likes board games", "Enjoys museums"]);
});

test("composition — a one-sided-only candidate still fills topWhy (reads as 'About them')", () => {
  const { topWhy } = buildWhy(["Likes hiking", "Enjoys quiet cafes", "Reads a lot"]);
  assert.deepEqual(topWhy, ["Likes hiking", "Enjoys quiet cafes"]);
  assert.ok(!topWhy.some(isMutualReason), "no mutual signal — UI labels this 'About them'");
});
