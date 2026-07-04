// Profile edit / pause / photos, Settings theme switch, Safety — 390px, dim+light.
// Single account reused across themes to respect the register rate-limit.
import { makeAccount, launch, login, check, finish, openProfileEdit, APP } from "./harness.mjs";
const OUT = "qa-artifacts";

async function run(acct, theme) {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y", JSON.stringify({ theme: th })), theme);
  await login(page, acct);

  // ---- PROFILE ---- (Hub → avatar pencil → the full edit form)
  await openProfileEdit(page);
  await page.waitForTimeout(800);
  check(`[${theme}] Profile screen loaded`, (await page.getByText(/pause my profile/i).count()) > 0);

  // Age range now lives inside the "Looking for" GROUP (post-regroup). Open it
  // first so the slider thumbs are visible/focusable — a display:none (hidden
  // panel) thumb can't take keyboard focus. Open only if collapsed.
  const lookingForGrp = page.getByRole("button", { name: /^Looking for/i }).first();
  if (await lookingForGrp.count()) {
    await lookingForGrp.scrollIntoViewIfNeeded();
    if ((await lookingForGrp.getAttribute("aria-expanded")) !== "true") {
      await lookingForGrp.click();
      await page.waitForTimeout(400);
    }
  }

  // AgeRangeSlider now supports Home/End/PageUp/PageDown (not just arrows).
  // Assert Home jumps the min thumb to the floor (18) and End jumps the max
  // thumb to the ceiling (99), respecting the two-thumb clamp + aria-valuenow.
  const minThumb = page.getByRole("slider", { name: /minimum age/i }).first();
  const maxThumb = page.getByRole("slider", { name: /maximum age/i }).first();
  if ((await minThumb.count()) && (await maxThumb.count())) {
    await minThumb.scrollIntoViewIfNeeded();
    await minThumb.focus();
    await page.keyboard.press("Home");
    await page.waitForTimeout(150);
    const minNow = await minThumb.getAttribute("aria-valuenow");
    check(`[${theme}] AgeRangeSlider Home jumps min thumb to 18`, minNow === "18", `valuenow=${minNow}`);
    await maxThumb.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const maxNow = await maxThumb.getAttribute("aria-valuenow");
    check(`[${theme}] AgeRangeSlider End jumps max thumb to 99`, maxNow === "99", `valuenow=${maxNow}`);
  } else {
    check(`[${theme}] AgeRangeSlider present`, false, "sliders not found");
  }

  // JRN-2 — the redundant collapsed "Pause my profile" section was removed; the
  // single discoverable top "Take a break" card is now the ONLY pause control.
  // Its button is an aria-pressed toggle labelled "Pause my profile" /
  // "Turn profile back on" (not a role="switch"). Assert exactly one, and that
  // pausing works from that top card.
  const pauseBtn = page.getByRole("button", { name: /^(pause my profile|turn profile back on)$/i });
  const pauseCount = await pauseBtn.count();
  check(`[${theme}] exactly one pause control (top card)`, pauseCount === 1, `count=${pauseCount}`);
  if (pauseCount >= 1) {
    const top = pauseBtn.first();
    await top.scrollIntoViewIfNeeded();
    const before = await top.getAttribute("aria-pressed");
    await top.click();
    await page.waitForTimeout(1200);
    const after = await pauseBtn.first().getAttribute("aria-pressed");
    check(`[${theme}] Pause works from top card (aria-pressed flips)`, before !== after, `before=${before} after=${after}`);
    await pauseBtn.first().click();
    await page.waitForTimeout(1000);
  } else {
    check(`[${theme}] Pause control present`, false, "not found");
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
  // HubRow accessible name is title + description ("Settings Appearance,
  // accessibility, feedback."), so anchor to the start, not an exact match.
  const settingsRow = page.getByRole("button", { name: /^settings\b/i }).first();
  if (await settingsRow.count()) {
    await settingsRow.scrollIntoViewIfNeeded();
    await settingsRow.click();
    await page.waitForTimeout(1200);
    check(`[${theme}] Settings screen opened`, (await page.getByRole("group", { name: /theme/i }).count()) > 0);
    const navy = page.getByRole("button", { name: /navy/i }).first();
    if (await navy.count()) {
      await navy.click();
      await page.waitForTimeout(800);
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").theme);
      check(`[${theme}] Theme switch persists (navy)`, persisted === "navy", `saved=${persisted}`);
      const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      check(`[${theme}] Theme applied to DOM`, applied === "navy", `data-theme=${applied}`);
    } else check(`[${theme}] Navy theme card present`, false, "not found");
    // PROD-1 — "About & legal" block links to the privacy + terms pages from
    // inside the logged-in app (previously only reachable from logged-out footers).
    const privacyLink = page.getByRole("link", { name: /privacy policy/i }).first();
    const termsLink = page.getByRole("link", { name: /terms of service/i }).first();
    await privacyLink.scrollIntoViewIfNeeded().catch(() => {});
    const privacyHref = (await privacyLink.count()) ? await privacyLink.getAttribute("href") : null;
    const termsHref = (await termsLink.count()) ? await termsLink.getAttribute("href") : null;
    check(`[${theme}] PROD-1 Privacy link in Settings → /privacy.html`, privacyHref === "/privacy.html", `href=${privacyHref}`);
    check(`[${theme}] PROD-1 Terms link in Settings → /terms.html`, termsHref === "/terms.html", `href=${termsHref}`);
    await page.getByRole("button", { name: /back|done|profile/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  } else check(`[${theme}] Settings hub row present`, false, "not found");

  // ---- SAFETY via Profile hub ----
  await page.getByRole("button", { name: /^profile$/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const safetyRow = page.getByRole("button", { name: /^safety\b/i }).first();
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
