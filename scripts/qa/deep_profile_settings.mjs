// Profile edit / pause / photos, Settings theme switch, Safety — 390px, dim+light.
// Single account reused across themes to respect the register rate-limit.
import { makeAccount, launch, login, check, finish, APP } from "./harness.mjs";
const OUT = "qa-artifacts";

async function run(acct, theme) {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y_prefs", JSON.stringify({ theme: th })), theme);
  await login(page, acct);

  // ---- PROFILE ----
  await page.getByRole("button", { name: /^profile$/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  check(`[${theme}] Profile screen loaded`, (await page.getByText(/pause my profile/i).count()) > 0);

  const pauseSwitch = page.locator('[role="switch"]').first();
  if (await pauseSwitch.count()) {
    await pauseSwitch.scrollIntoViewIfNeeded();
    const before = await pauseSwitch.getAttribute("aria-checked");
    await pauseSwitch.click();
    await page.waitForTimeout(1200);
    const after = await pauseSwitch.getAttribute("aria-checked");
    check(`[${theme}] Pause toggle flips`, before !== after, `before=${before} after=${after}`);
    await pauseSwitch.click();
    await page.waitForTimeout(1000);
  } else {
    check(`[${theme}] Pause switch present`, false, "not found");
  }

  const bio = page.locator("textarea").first();
  if (await bio.count()) { await bio.scrollIntoViewIfNeeded(); await bio.fill("Edited QA bio " + theme); }
  const saveBtn = page.getByRole("button", { name: /save changes|^save$|save & /i }).first();
  if (await saveBtn.count()) {
    await saveBtn.scrollIntoViewIfNeeded();
    const reach = await saveBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: r.top >= 0 && r.bottom <= window.innerHeight + 2, covered: !(el === top || el.contains(top)) };
    });
    check(`[${theme}] Profile Save reachable`, reach.visible && !reach.covered, JSON.stringify(reach));
    await saveBtn.click();
    await page.waitForTimeout(1500);
    check(`[${theme}] Profile Save shows confirmation`, (await page.getByText(/saved/i).count()) > 0);
  } else check(`[${theme}] Profile Save present`, false, "not found");

  check(`[${theme}] Add photo control present`, (await page.getByRole("button", { name: /add photo/i }).count()) > 0);

  // ---- SETTINGS via Profile hub ----
  const settingsRow = page.getByRole("button", { name: /^settings$/i }).first();
  if (await settingsRow.count()) {
    await settingsRow.scrollIntoViewIfNeeded();
    await settingsRow.click();
    await page.waitForTimeout(1200);
    check(`[${theme}] Settings screen opened`, (await page.getByRole("radiogroup", { name: /theme/i }).count()) > 0);
    const navy = page.getByRole("radio", { name: /navy/i }).first();
    if (await navy.count()) {
      await navy.click();
      await page.waitForTimeout(800);
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y_prefs") || "{}").theme);
      check(`[${theme}] Theme switch persists (navy)`, persisted === "navy", `saved=${persisted}`);
      const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      check(`[${theme}] Theme applied to DOM`, applied === "navy", `data-theme=${applied}`);
    } else check(`[${theme}] Navy theme card present`, false, "not found");
    check(`[${theme}] (info) legal links inside Settings`, true, `count=${await page.getByRole("link", { name: /privacy|terms/i }).count()}`);
    await page.getByRole("button", { name: /back|done|profile/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  } else check(`[${theme}] Settings hub row present`, false, "not found");

  // ---- SAFETY via Profile hub ----
  await page.getByRole("button", { name: /^profile$/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const safetyRow = page.getByRole("button", { name: /^safety$/i }).first();
  if (await safetyRow.count()) {
    await safetyRow.scrollIntoViewIfNeeded();
    await safetyRow.click();
    await page.waitForTimeout(1200);
    check(`[${theme}] Safety Center opened`, (await page.getByText(/block|report|emergency|resources|safety/i).count()) > 0);
    await page.screenshot({ path: `${OUT}/safety-${theme}.png` });
  } else check(`[${theme}] Safety hub row present`, false, "not found");

  check(`[${theme}] no pageerrors across profile/settings/safety`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

const acct = await makeAccount("ps", { displayName: "Pat QA", gender: "woman", pronouns: "she/her", seeking: "man", bio: "Original QA bio." });
await run(acct, "dim");
await run(acct, "light");
finish();
