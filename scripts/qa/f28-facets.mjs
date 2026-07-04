// F28 — verify the "About me" facets editor renders in Profile, is fillable, and
// that the local Preview modal reflects the typed facets. Uses the shared harness
// (local build + API forwarding). NOTE: the harness forwards profile writes to the
// LIVE Railway backend, which does not yet have the F28 migration — so a backend
// round-trip cannot be asserted pre-deploy. The Preview modal reads React state
// (not the backend), so it is the meaningful frontend round-trip here.
// Run: node scripts/qa/f28-facets.mjs
import { makeAccount, launch, login, check, finish, openProfileEdit } from "./harness.mjs";

const acct = await makeAccount("f28", { displayName: "Facet QA" });
const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

try {
  await login(page, acct);

  // Navigate to the Profile editor (Hub → avatar pencil); facets live there.
  await openProfileEdit(page);
  await page.waitForTimeout(600);

  // Ensure the "About me" GROUP is open (post-regroup the F28 facets are a
  // headed block inside it). It auto-opens for an incomplete profile, so a blind
  // click would TOGGLE it shut — open only if the facet field isn't visible yet.
  const occVisible = await page.locator("#occupation").isVisible().catch(() => false);
  if (!occVisible) {
    await page.getByRole("button", { name: /^About me/i }).first().click();
    await page.waitForTimeout(400);
  }

  check("Occupation input renders", await page.locator("#occupation").count() === 1);
  check("Languages input renders", await page.locator("#languages").count() === 1);

  // Fill the two text facets.
  await page.locator("#occupation").fill("Librarian");
  await page.locator("#languages").fill("English, ASL");

  // Add two "helps me" rows, then fill them.
  const addHelps = page.getByRole("button", { name: /Add something that helps/i });
  check("Helps-me add button renders", await addHelps.count() === 1);
  await addHelps.click();
  await page.waitForTimeout(200);
  await page.locator("#helps-me-item-0").fill("Clear plans");
  await page.getByRole("button", { name: /^Add another$/ }).first().click();
  await page.waitForTimeout(200);
  await page.locator("#helps-me-item-1").fill("Text over calls");

  // Add one "hard for me" row.
  await page.getByRole("button", { name: /Add something that's hard/i }).click();
  await page.waitForTimeout(200);
  await page.locator("#hard-for-me-item-0").fill("Loud places");

  // Save completes without a console error and surfaces the calm confirmation.
  await page.getByRole("button", { name: /^Save changes$/i }).first().click();
  await page.waitForTimeout(1200);
  check("Save shows confirmation", await page.getByText(/^Saved\.$/).count() >= 1);

  // Open the Preview modal — it reflects the typed facets from React state.
  await page.getByRole("button", { name: /Preview my card/i }).click();
  await page.waitForTimeout(600);
  const dialog = page.getByRole("dialog", { name: /profile preview|preview/i }).first();
  const body = await page.locator('[role="dialog"]').last().innerText();
  check("Preview shows occupation", /Librarian/.test(body));
  check("Preview shows languages", /English, ASL/.test(body));
  check("Preview shows helps-me item", /Clear plans/.test(body) && /Text over calls/.test(body));
  check("Preview shows hard-for-me item", /Loud places/.test(body));
  check("Preview labels the About me section", /About me/i.test(body));
  void dialog;

  check("No console pageerrors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

finish();
