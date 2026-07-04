// Deeper compatibility filters — the locked (free) state, proven end-to-end.
// A fresh (free) QA account opens Discover → Filters and must see:
//   • the "Advanced filters · Companion" locked panel copy, and
//   • an Upgrade link ("See Companion plans") that routes into Membership.
//
// The Companion path (persist + re-rank) can't be exercised here — harness
// accounts are free by design and can't self-grant Companion (the backend PUT is
// requirePaid-gated). That path is covered by server/test/advanced_filters.test.js
// + code correctness + live bundle markers. This driver proves the locked UX and
// that opening it doesn't throw a pageerror.
import { makeAccount, launch, login, check, finish, cleanupAccounts } from "./harness.mjs";

// A displayName is required for onboardingComplete → the app lands on Discover
// (which carries the Filters entry point) rather than the onboarding flow.
const acct = await makeAccount("advlock", { displayName: "Avery QA" });
const { browser, page, errors } = await launch();

try {
  await login(page, acct);

  // Open the Discover Filters sheet.
  await page.getByRole("button", { name: "Filters" }).first().click();
  await page.waitForTimeout(500);

  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.waitFor({ state: "visible", timeout: 5000 });

  // The advanced section header + Companion pill are present.
  const advHeader = await sheet.getByText("Advanced filters", { exact: true }).count();
  check("Advanced filters section renders in the sheet", advHeader > 0);

  // Free member → the locked panel copy is shown (not the functional controls).
  const lockedCopy = await sheet
    .getByText("Advanced filters are part of Spectrum Companion", { exact: false })
    .count();
  check("Free member sees the locked advanced-filters panel", lockedCopy > 0);

  // Free member must NOT get the functional Save control.
  const saveBtn = await sheet.getByRole("button", { name: "Save advanced filters" }).count();
  check("Free member does NOT see the Save control (gated)", saveBtn === 0);

  // The calm Upgrade link is present and routes into Membership.
  const upgrade = sheet.getByRole("button", { name: "See Companion plans" });
  check("Upgrade link is present", (await upgrade.count()) > 0);

  await upgrade.first().click();
  await page.waitForTimeout(1200);

  // Membership screen shows its plans (the honest Companion price / plan copy).
  const onMembership = await page
    .getByText("Spectrum Companion", { exact: false })
    .count();
  check("Upgrade link routes into the Membership screen", onMembership > 0);

  check("No console pageerrors while opening/using the locked sheet", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await cleanupAccounts([acct.token]);
}

finish();
