// Ad-hoc verification for the contextual trans-safety gender note (not part of
// smoke). Seeds a trans-spectrum member in a flagged home state, opens
// profile-edit, and asserts the inline note shows for a trans-spectrum
// selection, hides when switched to a non-trans value, and never shows for a
// safe-location account.
import { makeAccount, launch, login, openProfileEdit, cleanupAccounts } from "./harness.mjs";

const NOTE_RE = /hide your profile anytime from Safety/i;

async function noteVisible(page) {
  return page.getByText(NOTE_RE).first().isVisible().catch(() => false);
}

async function run() {
  const risky = await makeAccount("gnote-risk", {
    displayName: "Riley QA", gender: "trans-woman", pronouns: "she/her",
    seeking: "man", distCity: "Austin, TX",
  });
  const safe = await makeAccount("gnote-safe", {
    displayName: "Sam QA", gender: "trans-woman", pronouns: "she/her",
    seeking: "man", distCity: "Seattle, WA",
  });
  const results = [];
  const { browser, page, errors } = await launch();
  try {
    // ── Risky account ──
    await login(page, risky);
    await openProfileEdit(page);
    // Bring the gender fieldset into view.
    await page.getByText(/Your gender/i).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const shownForTrans = await noteVisible(page);
    results.push(["risky+trans-woman shows note", shownForTrans === true]);

    // Switch selection to "Woman" (non-trans) → note must vanish.
    await page.getByRole("button", { name: /^Woman$/ }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const shownForWoman = await noteVisible(page);
    results.push(["risky+woman hides note", shownForWoman === false]);

    // Switch back to a trans-spectrum value → note returns. "Nonbinary" is in
    // the common list, always visible.
    await page.getByRole("button", { name: /^Nonbinary$/ }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const shownForNB = await noteVisible(page);
    results.push(["risky+nonbinary shows note", shownForNB === true]);

    // ── Safe account ──
    await login(page, safe);
    await openProfileEdit(page);
    await page.getByText(/Your gender/i).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const shownForSafe = await noteVisible(page);
    results.push(["safe+trans-woman never shows note", shownForSafe === false]);
  } finally {
    results.push(["no pageerrors", errors.length === 0]);
    await browser.close();
    await cleanupAccounts([risky, safe]);
  }

  let ok = true;
  for (const [name, pass] of results) {
    console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
    if (!pass) ok = false;
  }
  console.log(`\n===== ${results.filter((r) => r[1]).length}/${results.length} =====`);
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
