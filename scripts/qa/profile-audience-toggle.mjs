// feature-gap #6 — verify the "New people" vs "Your matches" audience toggle in
// the profile Preview modal. Asserts the post-match-gated fields (contextCard,
// helpsMe, hardForMe) are ABSENT in the "New people" (pre-match) view and PRESENT
// in the "Your matches" (post-match) view, while a non-gated field (occupation,
// which IS on the Discover card) stays visible in both. Presentation-only: this
// reads React state, mirroring the backend gate in server/src/routes/matching.js
// (mapCandidateToCard omits contextCard/helpsMe/hardForMe pre-match).
// Run: node scripts/qa/profile-audience-toggle.mjs
import { makeAccount, launch, login, check, finish, openProfileEdit } from "./harness.mjs";

// Distinctive values chosen so they can NEVER collide with the toggle's
// explanatory copy (which mentions the words "helps me"/"hard for me").
const OCC = "Cartographer";
const HELP = "Clear written plans";
const HARD = "Sudden loud rooms";
const CTX = "I info-dump when I'm happy";

const acct = await makeAccount("audtoggle", { displayName: "Toggle QA" });
const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

try {
  await login(page, acct);
  await openProfileEdit(page);
  await page.waitForTimeout(600);

  // Open the "About me" group if collapsed (it holds occupation + the gated
  // facets + the "How to talk to me" context card). Auto-opens for an incomplete
  // profile, so only click when the fields aren't already visible.
  const occVisible = await page.locator("#occupation").isVisible().catch(() => false);
  if (!occVisible) {
    await page.getByRole("button", { name: /^About me/i }).first().click();
    await page.waitForTimeout(400);
  }

  // Fill a non-gated field (occupation → shown pre-match) and the gated ones.
  await page.locator("#occupation").fill(OCC);
  await page.getByRole("button", { name: /Add something that helps/i }).click();
  await page.waitForTimeout(200);
  await page.locator("#helps-me-item-0").fill(HELP);
  await page.getByRole("button", { name: /Add something that's hard/i }).click();
  await page.waitForTimeout(200);
  await page.locator("#hard-for-me-item-0").fill(HARD);
  await page.locator("#context-card").fill(CTX);

  // Open the Preview modal (reads React state — no backend round-trip needed).
  await page.getByRole("button", { name: /Preview my card/i }).click();
  await page.waitForTimeout(600);

  // ── Toggle exists as a real radiogroup with two radios ──
  const group = page.locator('[data-audience-toggle]');
  check("Audience toggle radiogroup renders", await group.count() === 1);
  const newRadio = page.getByRole("radio", { name: "New people" });
  const matchRadio = page.getByRole("radio", { name: "Your matches" });
  check("Both audience radios render", (await newRadio.count()) === 1 && (await matchRadio.count()) === 1);

  const dialogText = async () => (await page.locator('[role="dialog"]').last().innerText());

  // ── Default = "New people" (pre-match) ──
  check("Defaults to New people", (await newRadio.getAttribute("aria-checked")) === "true");
  let body = await dialogText();
  check("New people: occupation IS shown (not gated)", body.includes(OCC));
  check("New people: contextCard is HIDDEN (gated)", !body.includes(CTX));
  check("New people: helpsMe is HIDDEN (gated)", !body.includes(HELP));
  check("New people: hardForMe is HIDDEN (gated)", !body.includes(HARD));

  // ── Switch to "Your matches" (post-match) ──
  await matchRadio.click();
  await page.waitForTimeout(300);
  check("Your matches now selected", (await matchRadio.getAttribute("aria-checked")) === "true");
  body = await dialogText();
  check("Your matches: occupation still shown", body.includes(OCC));
  check("Your matches: contextCard IS shown", body.includes(CTX));
  check("Your matches: helpsMe IS shown", body.includes(HELP));
  check("Your matches: hardForMe IS shown", body.includes(HARD));

  // ── Switch back to "New people" — the gated fields hide again ──
  await newRadio.click();
  await page.waitForTimeout(300);
  body = await dialogText();
  check("Back to New people re-hides contextCard", !body.includes(CTX));
  check("Back to New people re-hides helpsMe/hardForMe", !body.includes(HELP) && !body.includes(HARD));

  check("No console pageerrors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

finish();
