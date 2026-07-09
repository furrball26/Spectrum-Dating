// One-off-ish verification for the consistency-audit batch. Reuses harness.mjs.
// Asserts: (2) editor completeness nudge is de-scored (chips, NO progressbar/%),
// (4) self-preview shows "Near {city}", (5) editor has a "Still figuring it out"
// goal option that reflects relationshipGoal="".
import { makeAccount, login, launch, openProfileEdit, check, finish, cleanupAccounts } from "./harness.mjs";

const acct = await makeAccount("auditfix", {
  displayName: "Sam Rivers",
  distCity: "Denver, CO",
  relationshipGoal: "",           // "Still figuring it out" (unset)
  // leave tagline/gender/pronouns/seeking/comm/sensory unset so the
  // completeness nudge renders (it hides once everything is filled).
});

const { browser, page, errors } = await launch();
try {
  await login(page, acct);
  await openProfileEdit(page);

  // (2) De-scored completeness nudge.
  const region = page.locator('[role="region"][aria-label="Profile completeness"]');
  await region.first().waitFor({ timeout: 8000 }).catch(() => {});
  const regionCount = await region.count();
  check("Completeness nudge renders", regionCount > 0, `regions=${regionCount}`);
  const progressbars = await region.locator('[role="progressbar"]').count();
  check("Nudge has NO progress meter", progressbars === 0, `progressbars=${progressbars}`);
  const chipButtons = await region.locator("button").count();
  check("Nudge still shows actionable chips", chipButtons > 0, `chips=${chipButtons}`);
  const regionText = (await region.first().innerText().catch(() => "")) || "";
  const hasPercent = /\d+%/.test(regionText) || /\d+\s*\/\s*\d+/.test(regionText);
  check("Nudge shows no %/fraction score", !hasPercent, `text=${JSON.stringify(regionText.slice(0, 80))}`);

  // (4) Self-preview shows coarse location.
  await page.getByRole("button", { name: /^How others see you$/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const dialog = page.getByRole("dialog");
  await dialog.first().waitFor({ timeout: 8000 }).catch(() => {});
  const dialogText = (await dialog.first().innerText().catch(() => "")) || "";
  check("Self-preview shows 'Near {city}'", /Near\s+Denver/.test(dialogText), `has=${/Near\s+Denver/.test(dialogText)}`);
  await page.getByRole("button", { name: /^Close preview$/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);

  // (5) "Still figuring it out" editor option maps to relGoal="".
  // Expand the "Looking for" section if collapsed, then read the radio.
  await page.getByRole("button", { name: /Looking for/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const figuring = page.locator("#rel-figuring");
  const figExists = (await figuring.count()) > 0;
  check("Editor has 'Still figuring it out' radio", figExists);
  if (figExists) {
    const checked = await figuring.isChecked().catch(() => false);
    check("'Still figuring it out' reflects relGoal=''", checked, `checked=${checked}`);
    const label = (await page.locator('label[for="rel-figuring"]').first().innerText().catch(() => "")) || "";
    check("Radio labelled 'Still figuring it out'", /Still figuring it out/.test(label), `label=${JSON.stringify(label)}`);
  }

  check("No console pageerrors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await cleanupAccounts([acct]);
}
finish();
