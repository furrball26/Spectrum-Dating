// Focused re-run of flows_mobile.mjs sections D + E only (archive/undo/restore +
// block-report screen; themes incl. pride/trans, double-tap revert, sign-out
// reset). Split out so a regression pass can confirm these golden-path flows
// without re-registering the whole A–E account set (auth-limiter friendly).
import { mkdirSync } from "node:fs";
import { makeAccount, makeMatchedPair, seedConversation, launch, login, openProfileEdit, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const VP = { width: 390, height: 844 };
const cleanup = [];

// ── D. Archive/Undo/Restore + Block-and-report screen ────────────────────────
{
  const pair = await makeMatchedPair("arch");
  cleanup.push(pair.a.token, pair.b.token);
  await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);
  const row = page.getByRole("button", { name: /Ben QA/ });
  check("D1 conversation row visible", (await row.count()) > 0);

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
  cleanup.push(acct.token);
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

  await page.getByText("Spectrum", { exact: true }).first().dblclick();
  await page.waitForTimeout(600);
  check("E4 double-tap logo reverts identity theme to dim", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dim");

  const transCard = page.getByRole("button", { name: /Trans pride theme/ });
  await transCard.first().scrollIntoViewIfNeeded();
  await transCard.first().click();
  await page.waitForTimeout(800);
  check("E5 trans theme applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "trans");
  // The Profile-hub refactor moved Sign out off the hub into the full editor
  // (reached via the avatar "Edit profile" pencil). openProfileEdit taps Profile
  // (returning from Settings to the hub) then opens that editor.
  await openProfileEdit(page);
  await page.waitForTimeout(800);
  const signOut = page.getByRole("button", { name: /Sign out/ });
  check("E5a Sign out control reachable in the profile editor", (await signOut.count()) > 0, `count=${await signOut.count()}`);
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
await cleanupAccounts(cleanup);
