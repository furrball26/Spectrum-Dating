// QA driver — static profile-writing assist ("ways to start" starters).
// Proves the free, client-side scaffolding in ProfileScreen's prompt UI:
//   1. On an empty answer box the calm "Need a starting point?" affordance +
//      tappable example starters render.
//   2. Tapping a starter drops it into the answer textarea as an editable draft.
//   3. Once the box has the user's own text, the starters disappear — so a tap
//      can never clobber what they wrote (the calm no-clobber guarantee).
// Run: build + preview on :4173, then `node scripts/qa/profile-starters.mjs`.
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const acct = await makeAccount("starters", { displayName: "Sam QA", gender: "nonbinary", pronouns: "they/them", seeking: "woman" });

const { browser, page, errors } = await launch();
await login(page, acct);

// Go to Profile.
await page.getByRole("button", { name: /Profile/ }).first().click();
await page.waitForTimeout(1500);

// The Prompts collapsible section is open by default. If it happens to be
// collapsed, open it; otherwise leave it as-is (toggling would close it).
const addBtn = page.getByRole("button", { name: /Add a prompt/i });
if ((await addBtn.count()) === 0) {
  await page.getByRole("button", { name: /^Prompts/ }).first().click();
  await page.waitForTimeout(600);
}

// Open the prompt chooser.
await addBtn.first().click();
await page.waitForTimeout(400);

// Pick a prompt whose starters we know ("Something I could talk about for hours…").
await page.locator("#prompt-chooser-select").selectOption("talk_for_hours");
await page.waitForTimeout(400);

// 1 — starters render on the empty box.
const framing = await page.getByText(/just a starting point you can change/i).count();
check("Framing copy renders on empty answer", framing > 0);

const starterBtn = page.getByRole("button", { name: /Use this starting point/i });
const starterCount = await starterBtn.count();
check("Example starters render (1–2 buttons)", starterCount >= 1 && starterCount <= 2, `count=${starterCount}`);

await page.screenshot({ path: `${OUT}/starters_empty.png` });

// Grab the first starter's text so we can assert exact insertion.
const firstStarterLabel = await starterBtn.first().getAttribute("aria-label");
const expected = (firstStarterLabel || "").replace(/^Use this starting point:\s*/, "");

// 2 — tapping inserts it into the textarea as an editable draft.
await starterBtn.first().click();
await page.waitForTimeout(400);
const inserted = await page.locator("#prompt-chooser-answer").inputValue();
check("Tapping a starter inserts it into the answer box", inserted === expected, `value="${inserted}"`);
check("Answer respects the 200-char cap", inserted.length <= 200, `len=${inserted.length}`);

// After insertion the box is non-empty → starters must be gone (no-clobber).
const startersAfter = await page.getByRole("button", { name: /Use this starting point/i }).count();
check("Starters disappear once the box has text (no clobber)", startersAfter === 0);

await page.screenshot({ path: `${OUT}/starters_inserted.png` });

// 3 — explicit no-clobber: type over it, confirm the user's own text is intact
// and that no starter can overwrite it (they stay hidden while text is present).
await page.locator("#prompt-chooser-answer").fill("My own words about steam trains.");
await page.waitForTimeout(300);
const typed = await page.locator("#prompt-chooser-answer").inputValue();
check("User's own typed text is preserved", typed === "My own words about steam trains.");
check("No starters offered while user text present", (await page.getByRole("button", { name: /Use this starting point/i }).count()) === 0);

// Fallback map coverage: every catalog key must yield 1–2 starters client-side.
// (Static assertion via the page's bundled constant is not exported, so we just
// confirm the golden path had no console errors.)
check("No console pageerrors during the flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([acct.token]);
