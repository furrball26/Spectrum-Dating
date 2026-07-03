// Targeted mobile (390x844) functional flows beyond smoke.mjs:
//   A. onboarding-fresh account routes to onboarding (not the app shell)
//   B. Discover swipe: Skip + "I'm interested"
//   C. Likes like-back -> MatchMoment -> Say hello -> thread
//   D. Archive + Undo + Archived view Restore; Block-and-report screen opens
//   E. Theme switching incl. pride/trans, double-tap-logo revert, sign-out reset
// Run: node scripts/qa/flows_mobile.mjs   (vite preview must be on :4173)
import { mkdirSync } from "node:fs";
import { makeAccount, makeMatchedPair, seedConversation, api, launch, login, check, finish, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const VP = { width: 390, height: 844 };

// ── A. Onboarding-fresh account ───────────────────────────────────────────────
{
  const acct = await makeAccount("onbfresh", { onboardingComplete: false, bio: "", displayName: "" });
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, acct);
  const body = await page.locator("body").innerText();
  const hasNav = await page.locator('nav[aria-label="Primary"]').count();
  check("A1 fresh account does NOT land in the app shell", hasNav === 0, `navCount=${hasNav}`);
  check("A2 fresh account sees onboarding content", body.length > 80 && !/Something went wrong/i.test(body), body.slice(0, 60).replace(/\n/g, " "));
  await page.screenshot({ path: `${OUT}/flows_onboarding.png` });
  check("A3 no pageerrors on onboarding-fresh boot", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── B. Discover swipe (Skip + I'm interested) ────────────────────────────────
{
  await makeAccount("cand", { displayName: "Carl QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  const main = await makeAccount("disc", { displayName: "Cass QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, main);
  const interested = page.getByRole("button", { name: /I'm interested|^Yes$/ });
  let cardVisible = false;
  try { await interested.first().waitFor({ timeout: 12000 }); cardVisible = true; } catch { /* no candidates */ }
  check("B1 Discover shows a candidate card with actions", cardVisible);
  if (cardVisible) {
    const before = await page.locator("body").innerText();
    await page.getByRole("button", { name: /^Skip$/ }).click();
    await page.waitForTimeout(1800);
    const after = await page.locator("body").innerText();
    check("B2 Skip advances (page content changed, no error)", after !== before && !/Something went wrong/i.test(after));
    const canLike = (await interested.count()) > 0;
    if (canLike) {
      await interested.first().click();
      await page.waitForTimeout(2200);
      const t3 = await page.locator("body").innerText();
      check("B3 'I'm interested' resolves calmly (no error surface)", !/Couldn't|error|wrong/i.test(t3) || /interested/i.test(t3), t3.slice(0, 80).replace(/\n/g, " "));
    } else {
      check("B3 'I'm interested' resolves calmly (no error surface)", true, "pool exhausted after skip — end state");
    }
    await page.screenshot({ path: `${OUT}/flows_discover.png` });
  }
  check("B4 no pageerrors during Discover swipes", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── C. Likes like-back -> MatchMoment -> Say hello -> thread ─────────────────
{
  const m2 = await makeAccount("lmain", { displayName: "Dana QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const liker = await makeAccount("liker", { displayName: "Liam QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: m2.userId, decision: "like" } }, liker.token);
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, m2);
  await page.getByRole("button", { name: /Likes/ }).click();
  await page.waitForTimeout(2200);
  const likeBack = page.getByRole("button", { name: /I'm interested in Liam QA/ });
  check("C1 incoming like renders in Likes tab", (await likeBack.count()) > 0);
  await likeBack.first().click();
  const dialog = page.getByRole("dialog");
  let momentShown = false;
  try { await dialog.waitFor({ timeout: 8000 }); momentShown = true; } catch { /* absent */ }
  const dtext = momentShown ? await dialog.innerText() : "";
  check("C2 MatchMoment dialog appears with Say hello", momentShown && /Say hello/.test(dtext), dtext.slice(0, 60).replace(/\n/g, " "));
  await page.screenshot({ path: `${OUT}/flows_matchmoment.png` });
  // JRN-3 — the moment now has an explicit "Close" affordance (aria-label="Close",
  // ≥44px) in addition to "Keep looking"/Escape. Measure it without dismissing, so
  // the Say hello → thread path below still runs.
  const closeBtn = dialog.getByRole("button", { name: /^close$/i }).first();
  const hasClose = (await closeBtn.count()) > 0;
  const closeBox = hasClose ? await closeBtn.boundingBox() : null;
  check("C2a MatchMoment has an explicit Close button ≥44px",
    hasClose && closeBox && closeBox.width >= 44 && closeBox.height >= 44,
    JSON.stringify(closeBox));
  await page.getByRole("button", { name: /Say hello/ }).click();
  await page.waitForTimeout(3000);
  const composer = await page.getByPlaceholder(/Write a message/i).count();
  const bodyC = await page.locator("body").innerText();
  check("C3 Say hello opens the thread (composer + name)", composer > 0 && /Liam QA/.test(bodyC));
  await page.screenshot({ path: `${OUT}/flows_sayhello_thread.png` });
  check("C4 no pageerrors on like-back golden path", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── C'. JRN-3: the explicit Close button DISMISSES the MatchMoment ────────────
// Fresh like-back pair (dismissing consumes the moment), so section C's Say hello
// path stays intact above.
{
  const m3 = await makeAccount("clmain", { displayName: "Remy QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const liker2 = await makeAccount("cliker", { displayName: "Theo QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: m3.userId, decision: "like" } }, liker2.token);
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, m3);
  await page.getByRole("button", { name: /Likes/ }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /I'm interested in Theo QA/ }).first().click();
  const dialog = page.getByRole("dialog");
  let shown = false;
  try { await dialog.waitFor({ timeout: 8000 }); shown = true; } catch { /* absent */ }
  check("C'1 MatchMoment shown for close-dismiss test", shown);
  const closeBtn = dialog.getByRole("button", { name: /^close$/i }).first();
  check("C'2 Close button present", (await closeBtn.count()) > 0);
  await closeBtn.click();
  await page.waitForTimeout(900);
  check("C'3 Close dismisses the MatchMoment (dialog gone)", (await page.getByRole("dialog").count()) === 0);
  check("C'4 no pageerrors during close-dismiss test", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── D. Archive/Undo/Restore + Block-and-report screen ────────────────────────
{
  const pair = await makeMatchedPair("arch");
  await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);
  const row = page.getByRole("button", { name: /Ben QA/ });
  check("D1 conversation row visible", (await row.count()) > 0);

  // Archive via the row ⋯ menu
  await page.getByRole("button", { name: /More options for Ben QA/ }).click();
  await page.getByRole("button", { name: /Archive conversation/ }).click();
  await page.waitForTimeout(1500);
  check("D2 row disappears after archive", (await page.getByRole("button", { name: /^Ben QA/ }).count()) === 0);
  const undo = page.getByRole("button", { name: /^Undo$/ });
  check("D3 calm Undo affordance appears", (await undo.count()) > 0);
  await page.screenshot({ path: `${OUT}/flows_archive_undo.png` });
  await undo.first().click();
  await page.waitForTimeout(2000);
  check("D4 Undo restores the row", (await page.getByRole("button", { name: /Ben QA/ }).count()) > 0);

  // Archive again -> Archived view -> Restore
  await page.getByRole("button", { name: /More options for Ben QA/ }).click();
  await page.getByRole("button", { name: /Archive conversation/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Archived conversations/ }).click();
  await page.waitForTimeout(1800);
  const restore = page.getByRole("button", { name: /Restore conversation with Ben QA/ });
  check("D5 archived view lists the thread with Restore", (await restore.count()) > 0);
  await page.screenshot({ path: `${OUT}/flows_archived_view.png` });
  await restore.first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Back to active conversations/ }).click();
  await page.waitForTimeout(1800);
  check("D6 restored row back in active list", (await page.getByRole("button", { name: /Ben QA/ }).count()) > 0);

  // Block-and-report screen opens from the thread header menu
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Conversation options/ }).click();
  await page.getByRole("menuitem", { name: /Block and report/ }).click();
  await page.waitForTimeout(1500);
  const brBody = await page.locator("body").innerText();
  check("D7 block/report screen opens with reasons", /Block Ben QA|Block or report Ben QA|Report Ben QA/.test(brBody) && /reason/i.test(brBody), brBody.slice(0, 70).replace(/\n/g, " "));
  await page.screenshot({ path: `${OUT}/flows_blockreport.png` });
  check("D8 no pageerrors across archive/report flows", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── E. Themes: pride/trans, double-tap revert, sign-out reset ────────────────
{
  const acct = await makeAccount("theme", { displayName: "Tess QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, acct);
  await page.getByRole("button", { name: /Profile/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Settings/ }).first().click();
  await page.waitForTimeout(2000);
  const prideCard = page.getByRole("button", { name: /Pride theme/ });
  check("E1 theme picker shows Pride card", (await prideCard.count()) > 0);
  await prideCard.first().scrollIntoViewIfNeeded();
  await prideCard.first().click();
  await page.waitForTimeout(800);
  check("E2 pride theme applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "pride");
  const disclosure = await page.locator("body").innerText();
  check("E3 identity-theme disclosure visible", /sign.?out|logged.?out|reset|visible/i.test(disclosure));
  await page.screenshot({ path: `${OUT}/flows_theme_pride.png` });

  // Double-tap the header mark -> instant revert to dim
  await page.getByText("Spectrum", { exact: true }).first().dblclick();
  await page.waitForTimeout(600);
  check("E4 double-tap logo reverts identity theme to dim", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dim");

  // Trans theme + sign out -> reset to dim (shared-device safety)
  const transCard = page.getByRole("button", { name: /Trans pride theme/ });
  await transCard.first().scrollIntoViewIfNeeded();
  await transCard.first().click();
  await page.waitForTimeout(800);
  check("E5 trans theme applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "trans");
  await page.getByRole("button", { name: /Profile/ }).click();
  await page.waitForTimeout(1500);
  const signOut = page.getByRole("button", { name: /Sign out/ });
  await signOut.first().scrollIntoViewIfNeeded();
  await signOut.first().click();
  await page.waitForTimeout(2500);
  const post = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    saved: (JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").theme) || null,
    token: localStorage.getItem("spectrum_token"),
  }));
  check("E6 sign-out resets identity theme (rendered)", post.theme === "dim", `theme=${post.theme}`);
  check("E7 sign-out resets identity theme (persisted)", post.saved === "dim" || post.saved === null, `saved=${post.saved}`);
  check("E8 sign-out clears auth", !post.token);
  await page.screenshot({ path: `${OUT}/flows_signedout.png` });
  check("E9 no pageerrors across theme flows", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

finish();
