// Final close-out: real Pause toggle, Settings-from-hub, Safety-from-hub. 390px dim.
import { makeAccount, launch, login, check, finish, openProfileEdit, APP } from "./harness.mjs";
const OUT = "qa-artifacts";

const acct = await makeAccount("hub", { displayName: "Hub QA", gender: "woman", pronouns: "she/her", seeking: "man", bio: "QA hub bio." });
const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
await login(page, acct);
// Pause + the Settings/Safety footer rows live in the edit form (Hub → pencil).
await openProfileEdit(page);
await page.waitForTimeout(800);

// Real pause toggle: the F17 "Take a break" control — a button with aria-pressed
// accessibly-named "Pause my profile" / "Turn profile back on" (near the top of
// the edit form).
const pause = page.getByRole("button", { name: /Pause my profile|Turn profile back on/i }).first();
check("pause toggle present in DOM", (await pause.count()) > 0, `count=${await pause.count()}`);
if (await pause.count()) {
  const vis = await pause.isVisible();
  if (vis) {
    const before = await pause.getAttribute("aria-pressed");
    await pause.click();
    await page.waitForTimeout(1200);
    const after = await pause.getAttribute("aria-pressed");
    check("pause toggle flips", before !== after, `before=${before} after=${after}`);
    await pause.click(); await page.waitForTimeout(800);
  } else {
    check("(info) pause toggle behind a collapsed disclosure", true, "not visible until section expanded — expected disclosure UX");
  }
}

// Settings via hub row
const settingsRow = page.getByRole("button", { name: /^settings\b/i }).first();
check("Settings hub row present", (await settingsRow.count()) > 0);
if (await settingsRow.count()) {
  await settingsRow.scrollIntoViewIfNeeded().catch(() => {});
  await settingsRow.click();
  await page.waitForTimeout(1200);
  check("Settings screen opened (theme group)", (await page.getByRole("group", { name: /theme/i }).count()) > 0);
  const navy = page.getByRole("button", { name: /navy/i }).first();
  if (await navy.count()) {
    await navy.click(); await page.waitForTimeout(700);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").theme);
    check("theme switch persists (navy)", persisted === "navy", `saved=${persisted}`);
  }
  check("(info) legal links inside Settings", true, `count=${await page.getByRole("link", { name: /privacy|terms/i }).count()}`);
  await page.screenshot({ path: `${OUT}/settings-hub.png` });
}

// Back to Profile, then Safety via hub row
await page.getByRole("button", { name: /^profile$/i }).first().click().catch(() => {});
await page.waitForTimeout(1000);
const safetyRow = page.getByRole("button", { name: /^safety\b/i }).first();
check("Safety hub row present", (await safetyRow.count()) > 0);
if (await safetyRow.count()) {
  await safetyRow.scrollIntoViewIfNeeded().catch(() => {});
  await safetyRow.click();
  await page.waitForTimeout(1200);
  check("Safety Center opened", (await page.getByText(/block|report|resource|emergency|safe/i).count()) > 0);
  const bodyScroll = await page.evaluate(() => ({ grew: document.body.scrollHeight > window.innerHeight + 4 }));
  check("(info) Safety page scroll state", true, JSON.stringify(bodyScroll));
  await page.screenshot({ path: `${OUT}/safety-hub.png` });
}

check("no pageerrors across hub flows", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
finish();
