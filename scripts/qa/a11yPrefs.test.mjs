// Unit coverage for src/a11yPrefs.js — the accessibility-pref read/normalise
// helpers on the critical path (App applies these globally on every load). The
// safety property here is FAIL-CLOSED theme resolution: a garbage/unknown theme
// must normalise to the neutral `dim` default and never to a surprise (esp. an
// identity theme) — plus the legacy calmMode→reducedSensory migration.
//
// a11yPrefs reads the global `localStorage`; Node has none, so we install a tiny
// stub. osPrefersReducedMotion is guarded by `typeof window` (undefined here),
// so seededDefaults().reduceMotion is deterministically false in this runner.
//
// Run: node --test scripts/qa/a11yPrefs.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  IDENTITY_THEMES,
  DEFAULT_A11Y,
  A11Y_KEY,
  seededDefaults,
  readA11y,
} from "../../src/a11yPrefs.js";

// Minimal localStorage stub — only getItem is exercised by readA11y.
const store = { value: null };
globalThis.localStorage = {
  getItem(key) {
    return key === A11Y_KEY ? store.value : null;
  },
};
function saved(raw) {
  store.value = raw;
}

test("THEMES lists the seven selectable ids and includes the dim default", () => {
  assert.deepEqual(THEMES, ["dim", "light", "navy", "lightblue", "pink", "pride", "trans"]);
  assert.ok(THEMES.includes("dim"));
});

test("IDENTITY_THEMES are exactly the pride + trans flags", () => {
  assert.deepEqual(IDENTITY_THEMES, ["pride", "trans"]);
  for (const id of IDENTITY_THEMES) assert.ok(THEMES.includes(id), `${id} is selectable`);
});

test("DEFAULT_A11Y is the calm baseline (dim theme, everything else off)", () => {
  assert.equal(DEFAULT_A11Y.theme, "dim");
  assert.equal(DEFAULT_A11Y.reduceMotion, false);
  assert.equal(DEFAULT_A11Y.highContrast, false);
  assert.equal(DEFAULT_A11Y.largerText, false);
  assert.equal(DEFAULT_A11Y.plainLanguage, false);
  assert.equal(DEFAULT_A11Y.reducedSensory, false);
});

test("seededDefaults returns dim + no reduce-motion when there's no window", () => {
  const d = seededDefaults();
  assert.equal(d.theme, "dim");
  assert.equal(d.reduceMotion, false);
});

test("readA11y falls back to seeded defaults when nothing is saved", () => {
  saved(null);
  assert.deepEqual(readA11y(), seededDefaults());
});

test("readA11y falls back to seeded defaults on unparseable or non-object JSON", () => {
  saved("not json {{{");
  assert.deepEqual(readA11y(), seededDefaults(), "parse error → defaults");
  saved("123");
  assert.deepEqual(readA11y(), seededDefaults(), "non-object → defaults");
  saved("null");
  assert.deepEqual(readA11y(), seededDefaults(), "literal null → defaults");
});

test("readA11y honours an explicitly saved valid theme verbatim (incl. identity themes)", () => {
  saved(JSON.stringify({ theme: "pride" }));
  assert.equal(readA11y().theme, "pride");
  saved(JSON.stringify({ theme: "light" }));
  assert.equal(readA11y().theme, "light");
  saved(JSON.stringify({ theme: "trans" }));
  assert.equal(readA11y().theme, "trans");
});

test("readA11y FAILS CLOSED: an unknown theme normalises to dim, never a surprise", () => {
  saved(JSON.stringify({ theme: "rainbow-unicorn" }));
  assert.equal(readA11y().theme, "dim");
  saved(JSON.stringify({ theme: 42 }));
  assert.equal(readA11y().theme, "dim");
  saved(JSON.stringify({})); // theme absent
  assert.equal(readA11y().theme, "dim");
});

test("readA11y coerces every flag to a real boolean", () => {
  saved(JSON.stringify({
    reduceMotion: 1,
    highContrast: "yes",
    largerText: {},
    plainLanguage: 0,
    reducedSensory: "",
  }));
  const a = readA11y();
  assert.strictEqual(a.reduceMotion, true);
  assert.strictEqual(a.highContrast, true);
  assert.strictEqual(a.largerText, true);
  assert.strictEqual(a.plainLanguage, false);
  assert.strictEqual(a.reducedSensory, false);
});

test("readA11y migrates the legacy calmMode flag into reducedSensory", () => {
  saved(JSON.stringify({ calmMode: true }));
  assert.equal(readA11y().reducedSensory, true, "calmMode:true → reducedSensory:true");
  saved(JSON.stringify({ reducedSensory: false, calmMode: true }));
  assert.equal(readA11y().reducedSensory, true, "either flag being true wins");
  saved(JSON.stringify({ reducedSensory: true, calmMode: false }));
  assert.equal(readA11y().reducedSensory, true);
});
