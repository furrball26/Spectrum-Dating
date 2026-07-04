// Regression driver for the Profile-completeness nudge "jump to section" fix.
// Before the fix only the "Answer a prompt" chip was a real <button>; the other
// seven missing-field chips were inert <span>s, so clicking them did nothing
// (the reported "button not working to jump to sections" bug). This drives the
// real Profile screen with an INCOMPLETE profile so the nudge shows every chip,
// clicks each one, and asserts it opens/scrolls/moves focus to the right control.
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/profile-completeness-jump.mjs
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, openProfileEdit, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// Deliberately incomplete profile. The server marks onboarding complete once
// display_name + bio + an interest + a valid 18+ DOB exist (see
// server/src/routes/profile.js), so we keep those filled to reach the main app —
// then leave every OTHER completeness field empty: no photo, tagline,
// gender/pronouns, comms style, sensory prefs, or prompts. That renders 6 chips
// (bio is always present post-onboarding, so its chip never shows; `seeking` is
// no longer a completeness field — "open to everyone"/empty is a valid, complete
// preference, so nagging for it was the bug we removed).
const acct = await makeAccount("pcjump", {
  displayName: "Incomplete QA",
  bio: "A short bio so onboarding is complete.",
  commNote: "",
  tagline: "",
  gender: "",
  pronouns: "",
  seeking: "",
  interests: ["hiking"], // required for onboarding; not a completeness field
});

// label → { expectedFocusId, section } (section = the collapsible GROUP panel
// that must un-hide when the chip is clicked; null for always-visible top-area
// fields). Post-regroup, pronouns/comms/sensory/prompt all live inside the
// single "About me" group; `jumpToField` scrolls to the specific field id, so
// landing deep inside the large group still focuses the right control.
const EXPECT = {
  "Add a photo":                 { focusId: "add-photo-tile",     section: null },
  "Add a tagline":               { focusId: "tagline",            section: null },
  "Write your bio":              { focusId: "bio",                section: null },
  "Add pronouns / gender":       { focusId: "pronouns",           section: "aboutMe" },
  "Fill in comms style":         { focusId: "comm-directness",    section: "aboutMe" },
  "Add sensory preferences":     { focusId: "sensory-environment",section: "aboutMe" },
  "Answer a prompt":             { focusId: null,                 section: "aboutMe" },
};

const { browser, page, errors } = await launch();
await login(page, acct);

// Navigate to the Profile tab's editor (Hub → avatar pencil). The completeness
// nudge lives on the edit form, now reached via the pencil.
await openProfileEdit(page);
await page.waitForTimeout(1000);

const region = page.locator('[aria-label="Profile completeness"]');
check("Completeness nudge is visible", (await region.count()) > 0);

// Every missing chip must be a real <button> (not an inert <span>) — the crux
// of the bug. Enumerate the chip labels present.
const chipButtons = region.locator("ul button");
const labels = await chipButtons.allInnerTexts();
check("Multiple chips render as <button>s", labels.length >= 6, `chips=${labels.length} :: ${labels.join(" | ")}`);

let jumpedNonPrompt = 0;

for (const label of labels) {
  const exp = EXPECT[label];
  if (!exp) { check(`Unexpected chip label "${label}"`, false); continue; }

  // Click via the DOM so it fires regardless of current scroll position, then
  // let the bounded-rAF settle (section open + smooth scroll) resolve.
  await region.locator("ul button", { hasText: label }).first().evaluate((el) => el.click());
  await page.waitForTimeout(500);

  const state = await page.evaluate(({ focusId, section }) => {
    const active = document.activeElement;
    const panel = section ? document.getElementById(`section-${section}-panel`) : null;
    return {
      activeId: active ? active.id : null,
      activeTag: active ? active.tagName : null,
      panelHidden: panel ? panel.hidden : null,
      focusInPanel: panel && active ? panel.contains(active) : null,
      focusVisible: active ? (() => {
        const r = active.getBoundingClientRect();
        return r.top >= -2 && r.top < window.innerHeight && r.height > 0;
      })() : false,
    };
  }, exp);

  // Section chips: panel must have un-hidden and focus must land inside it.
  if (exp.section) {
    check(`"${label}" opens section "${exp.section}"`, state.panelHidden === false,
      `panelHidden=${state.panelHidden}`);
    check(`"${label}" moves focus into the section`, state.focusInPanel === true,
      `activeId=${state.activeId} tag=${state.activeTag}`);
  }
  // Specific-control chips: focus must land on the exact input we mapped.
  if (exp.focusId) {
    const ok = state.activeId === exp.focusId;
    check(`"${label}" focuses #${exp.focusId}`, ok, `activeId=${state.activeId}`);
    if (ok && label !== "Answer a prompt") jumpedNonPrompt++;
  }
  check(`"${label}" scrolls the target into view`, state.focusVisible === true,
    `activeId=${state.activeId}`);
}

// The regression class: the previously-inert non-prompt chips now jump.
check("At least 5 previously-broken (non-prompt) chips now jump", jumpedNonPrompt >= 5,
  `jumped=${jumpedNonPrompt}`);

check("No console pageerrors during chip navigation", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.screenshot({ path: `${OUT}/profile_completeness_jump.png` });

await browser.close();
finish();
await cleanupAccounts([acct.token]);
