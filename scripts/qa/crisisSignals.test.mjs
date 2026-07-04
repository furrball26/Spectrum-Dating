// Crisis-line auto-routing — unit coverage for the client-side crisis detector.
//
// hasCrisisSignal is a HIGH-CONFIDENCE, conservative boolean used ONLY to gently
// surface existing crisis resources (988 / Crisis Text Line) to the person who
// expressed distress. It never blocks, alters, reports, or logs a message. The
// design bias is FALSE NEGATIVES over false positives, so these tests pin both
// the phrases that MUST trip it and the everyday hyperbole that must NOT.
//
// Run: node --test scripts/qa/crisisSignals.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCrisisSignal } from "../../src/messaging/crisisSignals.js";

test("high-confidence self-harm / suicidal-intent phrases → true", () => {
  for (const msg of [
    "i want to kill myself",
    "sometimes i think about killing myself",
    "i just want to die",
    "i wanna die honestly",
    "i want to be dead",
    "i don't want to be here anymore",
    "i dont want to be alive",
    "i don't want to live",
    "i don't wanna live anymore",
    "i want to end my life",
    "i've been thinking about ending my life",
    "i want to end it all",
    "i might take my own life",
    "i keep hurting myself",
    "i've been cutting myself",
    "i want to harm myself",
    "this is self-harm",
    "i feel suicidal",
    "i've had suicidal thoughts",
    "i've been thinking about suicide",
    "there's no reason to live",
    "i have nothing to live for",
    "there's no point in living",
    "everyone would be better off without me",
    "they'd all be better off dead",
  ]) {
    assert.equal(hasCrisisSignal(msg), true, `expected crisis signal: ${msg}`);
  }
});

test("case / punctuation / whitespace variants → true", () => {
  assert.equal(hasCrisisSignal("I WANT TO DIE"), true, "uppercase");
  assert.equal(hasCrisisSignal("I don’t want to be here anymore"), true, "curly apostrophe");
  assert.equal(hasCrisisSignal("i want   to   die"), true, "collapsed whitespace");
  assert.equal(hasCrisisSignal("thinking about\nkilling myself"), true, "newline between words");
  assert.equal(hasCrisisSignal("   i feel suicidal   "), true, "surrounding whitespace");
});

test("everyday hyperbole and idioms → false (favor false negatives)", () => {
  for (const msg of [
    "this traffic is killing me",
    "you're killing me with these puns",
    "ugh my boss is killing me",
    "i'd die for a slice of pizza right now",
    "i'm dying laughing at this",
    "i'm dying to see the new movie",
    "that workout killed me",
    "these heels are killing me",
    "i'm dead tired tonight",
    "he's drop dead gorgeous",
    "that joke killed",
    "let's kill some time before the date",
    "running for office there would be career suicide",
    "asking my ex back is social suicide",
    "i could murder a burger",
    "i want to dye my hair blue",
    "i'm on a diet so no fries",
  ]) {
    assert.equal(hasCrisisSignal(msg), false, `should NOT flag: ${msg}`);
  }
});

test("benign chat → false", () => {
  for (const msg of [
    "hey! how was your weekend?",
    "i love hiking and quiet coffee shops",
    "no rush, take your time replying",
    "that sounds like a lovely plan",
  ]) {
    assert.equal(hasCrisisSignal(msg), false, `should NOT flag: ${msg}`);
  }
});

test("empty / non-string / edge inputs → false, never throws", () => {
  assert.equal(hasCrisisSignal(""), false);
  assert.equal(hasCrisisSignal("   "), false);
  assert.equal(hasCrisisSignal(null), false);
  assert.equal(hasCrisisSignal(undefined), false);
  assert.equal(hasCrisisSignal(42), false);
  assert.equal(hasCrisisSignal({}), false);
  assert.equal(hasCrisisSignal([]), false);
  assert.equal(hasCrisisSignal(["i want to die"]), false, "array is not a string");
});
