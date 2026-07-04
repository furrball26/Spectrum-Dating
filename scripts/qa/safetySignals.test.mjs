// F26 — unit coverage for the client-side safety-signal detector.
//
// hasSafetySignal is a HEURISTIC boolean used to surface ONE calm, informational
// note per conversation (anti-scam / anti-grooming). It never blocks or alters a
// message, so broad matching is by design. These tests pin the ACTUAL patterns
// in src/messaging/safetySignals.js — positives (each signal family), negatives
// (benign chat), and the input edge cases (empty/undefined/non-string/casing) —
// so a regex regression that silently stops flagging a scam ask is caught.
//
// Run: node --test scripts/qa/safetySignals.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSafetySignal, shouldNudgeBeforeSend } from "../../src/messaging/safetySignals.js";

test("off-platform contact — URLs, emails, phones are flagged", () => {
  assert.equal(hasSafetySignal("check my site https://sketchy.example/win"), true);
  assert.equal(hasSafetySignal("go to www.freegiftz.io now"), true);
  assert.equal(hasSafetySignal("my page is coolprofile.app"), true, "bare domain.tld");
  assert.equal(hasSafetySignal("email me at scammer@totally.legit"), true);
  assert.equal(hasSafetySignal("call me at 555-123-4567 tonight"), true, "10-digit phone");
  assert.equal(hasSafetySignal("+1 (415) 867 5309 is my cell"), true, "intl phone w/ separators");
});

test("off-platform contact — external app names are flagged", () => {
  for (const msg of [
    "let's move to whatsapp",
    "I'm on WhatsApp too",
    "add me on telegram",
    "you have signal?",
    "dm me on instagram",
    "find me on insta",
    "snapchat is easier",
    "my snap is better",
    "we should use discord",
    "are you on kik",
  ]) {
    assert.equal(hasSafetySignal(msg), true, `expected flag: ${msg}`);
  }
});

test("off-platform contact — handoff phrasing is flagged", () => {
  assert.equal(hasSafetySignal("add me on my other app"), true);
  assert.equal(hasSafetySignal("text me sometime"), true);
  assert.equal(hasSafetySignal("hit me up later"), true);
  assert.equal(hasSafetySignal("my number is easier to reach"), true);
  assert.equal(hasSafetySignal("my handle is the same everywhere"), true);
  assert.equal(hasSafetySignal("let's move this off app"), true);
  assert.equal(hasSafetySignal("can we get off this app"), true);
});

test("money / scam — payment apps, crypto, and asks are flagged", () => {
  // Payment apps
  assert.equal(hasSafetySignal("send it to my venmo"), true);
  assert.equal(hasSafetySignal("I use cash app"), true);
  assert.equal(hasSafetySignal("do you have zelle"), true);
  assert.equal(hasSafetySignal("PayPal works for me"), true);
  assert.equal(hasSafetySignal("pay me on western union"), true);
  // Crypto
  assert.equal(hasSafetySignal("invest in bitcoin with me"), true);
  assert.equal(hasSafetySignal("just send BTC"), true);
  assert.equal(hasSafetySignal("what's your wallet address"), true);
  assert.equal(hasSafetySignal("never share your seed phrase"), true);
  // Money asks
  assert.equal(hasSafetySignal("can you buy me a gift card"), true);
  assert.equal(hasSafetySignal("please send me money"), true);
  assert.equal(hasSafetySignal("could you help me out this month"), true);
  assert.equal(hasSafetySignal("I need to wire transfer some funds"), true);
  assert.equal(hasSafetySignal("grab a steam card please"), true);
});

test("detection is case-insensitive", () => {
  assert.equal(hasSafetySignal("SEND ME MONEY"), true);
  assert.equal(hasSafetySignal("Venmo"), true);
  assert.equal(hasSafetySignal("TELEGRAM"), true);
  assert.equal(hasSafetySignal("BITCOIN"), true);
});

test("benign, on-platform messages are NOT flagged", () => {
  for (const msg of [
    "I love hiking and board games on quiet weekends",
    "Let's meet for coffee this weekend",
    "That movie was so good, we should watch the sequel",
    "I'm a software engineer and I like sci-fi",
    "How was your day today?",
    "I'm 24 and I work nights",
    "Sounds great, talk soon!",
  ]) {
    assert.equal(hasSafetySignal(msg), false, `should NOT flag: ${msg}`);
  }
});

test("short digit runs (ages, 24/7) do not trip the phone heuristic", () => {
  assert.equal(hasSafetySignal("I'm 24 and open 24/7"), false);
  assert.equal(hasSafetySignal("apartment 12 on floor 3"), false);
});

test("edge cases — empty, whitespace, non-string, nullish return false (never throw)", () => {
  assert.equal(hasSafetySignal(""), false);
  assert.equal(hasSafetySignal("   "), false);
  assert.equal(hasSafetySignal(undefined), false);
  assert.equal(hasSafetySignal(null), false);
  assert.equal(hasSafetySignal(12345678), false, "non-string is rejected before regex");
  assert.equal(hasSafetySignal({}), false);
  assert.equal(hasSafetySignal([]), false);
});

// --- Needed #6: shouldNudgeBeforeSend (sender pre-send nudge decision) ---------

test("shouldNudgeBeforeSend — a first-time scam-signal send is nudged", () => {
  assert.equal(shouldNudgeBeforeSend("let's move to whatsapp", null), true);
  assert.equal(shouldNudgeBeforeSend("send it to my venmo", null), true);
  assert.equal(shouldNudgeBeforeSend("add me on telegram", null), true);
});

test("shouldNudgeBeforeSend — benign / empty text is never nudged", () => {
  assert.equal(shouldNudgeBeforeSend("want to grab coffee this weekend?", null), false);
  assert.equal(shouldNudgeBeforeSend("", null), false);
  assert.equal(shouldNudgeBeforeSend("   ", null), false);
});

test("shouldNudgeBeforeSend — once confirmed, the SAME text is not re-nudged", () => {
  const text = "add me on telegram";
  assert.equal(shouldNudgeBeforeSend(text, null), true, "first attempt prompts");
  assert.equal(shouldNudgeBeforeSend(text, text), false, "confirmed text is not re-prompted");
  // The caller compares trimmed bodies, so surrounding whitespace still matches.
  assert.equal(shouldNudgeBeforeSend("  add me on telegram  ", "add me on telegram"), false);
  // Editing the message after confirming re-arms the nudge.
  assert.equal(shouldNudgeBeforeSend("add me on telegram now", "add me on telegram"), true);
});

test("shouldNudgeBeforeSend — non-string input is safe (never throws, never nudges)", () => {
  assert.equal(shouldNudgeBeforeSend(undefined, null), false);
  assert.equal(shouldNudgeBeforeSend(null, null), false);
  assert.equal(shouldNudgeBeforeSend(12345, null), false);
  assert.equal(shouldNudgeBeforeSend({}, null), false);
});
