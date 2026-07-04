// D-17 Phase 0 — unit coverage for the "Could talk for hours about" reframe.
// splitFeaturedPrompt is the single source of truth for pulling the answered
// talk_for_hours prompt out of the generic list (so it gets ONE home — the hero
// — and never duplicates in PromptCards). A regression here would either lose
// the hero, double-render the answer, or reorder/drop the other 11 prompts.
//
// Run: node --test scripts/qa/featuredPrompt.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitFeaturedPrompt,
  FEATURED_PROMPT_KEY,
  FEATURED_PROMPT_TITLE,
} from "../../src/featuredPrompt.js";

test("features an answered talk_for_hours prompt and removes it from rest", () => {
  const prompts = [
    { promptKey: "a_perfect_day", answer: "A quiet morning" },
    { promptKey: "talk_for_hours", answer: "The history of trains" },
    { promptKey: "small_joy", answer: "Fresh coffee" },
  ];
  const { featured, rest } = splitFeaturedPrompt(prompts);
  assert.equal(featured.promptKey, FEATURED_PROMPT_KEY);
  assert.equal(featured.answer, "The history of trains");
  assert.equal(rest.length, 2);
  assert.ok(!rest.some((p) => p.promptKey === FEATURED_PROMPT_KEY), "no dup in rest");
  assert.deepEqual(rest.map((p) => p.promptKey), ["a_perfect_day", "small_joy"]);
});

test("preserves the order of the remaining prompts", () => {
  const prompts = [
    { promptKey: "talk_for_hours", answer: "Bird migration" },
    { promptKey: "recharge", answer: "A long walk" },
    { promptKey: "green_flag", answer: "Patience" },
    { promptKey: "weekend", answer: "The library" },
  ];
  const { rest } = splitFeaturedPrompt(prompts);
  assert.deepEqual(rest.map((p) => p.promptKey), ["recharge", "green_flag", "weekend"]);
});

test("does NOT feature an unanswered / whitespace-only talk_for_hours prompt", () => {
  for (const answer of ["", "   ", null, undefined]) {
    const { featured, rest } = splitFeaturedPrompt([
      { promptKey: "talk_for_hours", answer },
      { promptKey: "small_joy", answer: "Rain" },
    ]);
    assert.equal(featured, null, `answer=${JSON.stringify(answer)} must not feature`);
    // The empty talk_for_hours stays in rest so downstream valid-answer filters
    // drop it exactly as they do today — we don't silently swallow the row.
    assert.equal(rest.length, 2);
  }
});

test("no talk_for_hours present → featured null, rest is the full list unchanged", () => {
  const prompts = [
    { promptKey: "a_perfect_day", answer: "Sunshine" },
    { promptKey: "small_joy", answer: "Tea" },
  ];
  const { featured, rest } = splitFeaturedPrompt(prompts);
  assert.equal(featured, null);
  assert.deepEqual(rest, prompts);
});

test("only the FIRST answered talk_for_hours is featured (defensive against dup keys)", () => {
  const prompts = [
    { promptKey: "talk_for_hours", answer: "First" },
    { promptKey: "talk_for_hours", answer: "Second" },
  ];
  const { featured, rest } = splitFeaturedPrompt(prompts);
  assert.equal(featured.answer, "First");
  assert.equal(rest.length, 1);
  assert.equal(rest[0].answer, "Second");
});

test("nullish / non-array input never throws", () => {
  for (const input of [null, undefined, {}, "nope", 42]) {
    const { featured, rest } = splitFeaturedPrompt(input);
    assert.equal(featured, null);
    assert.deepEqual(rest, []);
  }
});

test("skips malformed entries without throwing", () => {
  const prompts = [null, undefined, { promptKey: "talk_for_hours", answer: "Maps" }, {}];
  const { featured, rest } = splitFeaturedPrompt(prompts);
  assert.equal(featured.answer, "Maps");
  assert.equal(rest.length, 3);
});

test("exports a calm hero title that is NOT the raw prompt sentence", () => {
  assert.equal(FEATURED_PROMPT_TITLE, "Could talk for hours about");
  assert.ok(!FEATURED_PROMPT_TITLE.includes("…"), "not the raw ellipsis prompt");
});
