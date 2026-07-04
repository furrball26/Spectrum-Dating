// FE-4..FE-7 regression driver (accessibility batch). Reuses harness.mjs.
// Run FOREGROUND from the repo root:  node scripts/qa/a11y-fe4-7.mjs
//
// Covers, at 390px against the local build + real backend:
//   FE-4  identity-theme quick-revert has a REAL keyboard/SR button
//         (aria-label "Switch back to Warm dim"), is keyboard-activatable,
//         announces via a polite live region, AND the double-tap + logout-reset
//         trust&safety invariants still hold.
//   FE-5  the row ⋯ popover is an honest disclosure (role="group", plain
//         buttons, aria-haspopup!="menu") — opens, items activate, Escape +
//         click-outside close, focus returns to the ⋯ trigger (FE-2 preserved).
//   FE-6  theme cards are aria-pressed buttons (no role=radio/radiogroup);
//         selection + persistence hold; identity disclosure is aria-describedby.
//   FE-7  Undo / clear-filter × are ≥44px; the collapse pills are ≥14px.
import { api, makeAccount, launch, login, check, finish, openProfileEdit, OUT } from "./harness.mjs";

const VP = { width: 390, height: 844 };

// ── Seed: userA + a started conversation with Ben0, plus 7 more matches with no
// conversation (so active(1)+newMatches(7) = 8 > 7 → the name filter renders). ──
const a = await makeAccount("fe47a", { displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man" });
let conv0 = null;
for (let i = 0; i < 8; i++) {
  const b = await makeAccount(`fe47b${i}`, { displayName: `Ben${i} QA`, gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: a.userId, decision: "like" } }, b.token);
  const sw = await api("/matching/swipe", { method: "POST", body: { candidateId: b.userId, decision: "like" } }, a.token);
  const matchId = sw.body?.matchId || sw.body?.match?.matchId;
  if (i === 0 && matchId) {
    const cc = await api("/messaging/conversations", { method: "POST", body: { matchId } }, a.token);
    conv0 = cc.body?.conversation?.id || cc.body?.conversationId || cc.body?.id;
    if (conv0) {
      await api(`/messaging/conversations/${conv0}/messages`, { method: "POST", body: { body: "Hello from QA" } }, a.token);
      await api(`/messaging/conversations/${conv0}/messages`, { method: "POST", body: { body: "Reply from QA" } }, b.token);
    }
  }
}

const { browser, page, errors } = await launch({ viewport: VP });
await login(page, a);

// ── Into Messages ────────────────────────────────────────────────────────────
await page.getByRole("button", { name: /messages/i }).first().click().catch(() => {});
await page.waitForTimeout(1800);

const trigger = page.getByRole("button", { name: /More options for Ben0/ }).first();
check("FE-5: row ⋯ trigger present", (await trigger.count()) > 0);

// ── FE-5: honest disclosure semantics ─────────────────────────────────────────
if (await trigger.count()) {
  const hp = await trigger.getAttribute("aria-haspopup");
  check("FE-5: trigger aria-haspopup is not the (unimplemented) 'menu'", hp !== "menu", `haspopup=${hp}`);

  await trigger.click();
  await page.waitForTimeout(350);
  const groupSel = '[role="group"][aria-label^="Options for"]';
  check("FE-5: popover is role=group, not role=menu",
    (await page.locator(groupSel).count()) > 0 && (await page.locator('[role="menu"]').count()) === 0);
  check("FE-5: no role=menuitem descendants remain",
    (await page.locator(`${groupSel} [role="menuitem"]`).count()) === 0);
  check("FE-5: items are plain buttons (View profile present)",
    (await page.getByRole("button", { name: /^View profile$/ }).count()) > 0);

  // Escape closes + focus returns to the ⋯ trigger.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const afterEsc = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("FE-5: Escape closes the disclosure", (await page.locator(groupSel).count()) === 0);
  check("FE-5: Escape returns focus to the ⋯ trigger", /More options for Ben0/.test(afterEsc || ""), `active=${afterEsc}`);

  // Click-outside closes.
  await trigger.click();
  await page.waitForTimeout(250);
  check("FE-5: reopened", (await page.locator(groupSel).count()) > 0);
  await page.getByRole("heading", { name: /Your matches/ }).click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(250);
  check("FE-5: click-outside closes the disclosure", (await page.locator(groupSel).count()) === 0);

  // Item activates a modal; FE-2 focus-restore (focus → trigger before modal
  // mounts) must survive the disclosure downgrade.
  await trigger.click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /^Block or report$/ }).first().click();
  await page.waitForTimeout(450);
  check("FE-5: item activates (opens the ReportModal dialog)", (await page.getByRole("dialog").count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(450);
  const fb = await page.evaluate(() => ({
    label: document.activeElement?.getAttribute("aria-label"),
    isBody: document.activeElement === document.body,
  }));
  check("FE-5/FE-2: focus restored to the ⋯ trigger after modal close (not <body>)",
    /More options for Ben0/.test(fb.label || "") && !fb.isBody, JSON.stringify(fb));
}

// ── FE-7: clear-filter × is ≥44px in BOTH axes ────────────────────────────────
const filterInput = page.locator("#conversation-filter");
check("FE-7: name filter renders (list long enough)", (await filterInput.count()) > 0);
if (await filterInput.count()) {
  await filterInput.fill("Ben");
  await page.waitForTimeout(300);
  const clearX = page.getByRole("button", { name: /Clear filter/ }).first();
  const xBox = await clearX.boundingBox();
  check("FE-7: clear-filter × ≥44px (width AND height)",
    !!xBox && xBox.width >= 44 && xBox.height >= 44, `w=${xBox?.width} h=${xBox?.height}`);
  await clearX.click().catch(() => {});
  await page.waitForTimeout(300);
}

// ── FE-7: archive Undo button is ≥44px tall ───────────────────────────────────
if (await trigger.count()) {
  await trigger.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Archive conversation/ }).first().click().catch(() => {});
  await page.waitForTimeout(1400);
  const undo = page.getByRole("button", { name: /^Undo$/ }).first();
  check("FE-7: archive Undo affordance present", (await undo.count()) > 0);
  if (await undo.count()) {
    const uBox = await undo.boundingBox();
    check("FE-7: archive Undo ≥44px tall", !!uBox && uBox.height >= 44, `h=${uBox?.height}`);
    await undo.click().catch(() => {});
    await page.waitForTimeout(1600);
  }
}

// ── FE-7: collapse pills render at ≥14px ──────────────────────────────────────
// Open a brand-new-match thread (zero live messages) so the slow-start region is
// EXPANDED and shows its "Hide" pill — the exact state that regressed to 13px.
await page.getByRole("button", { name: /More options for Ben1/ }).first().count().catch(() => 0);
const ben1Row = page.getByRole("button", { name: /^Ben1 QA/ }).first();
if (await ben1Row.count()) {
  await ben1Row.click().catch(() => {});
  await page.waitForTimeout(1800);
}
const pills = await page.evaluate(() => {
  const texts = ["Hide", "Show what to expect", "Show openers and tips"];
  return [...document.querySelectorAll("button")]
    .filter((b) => texts.includes((b.textContent || "").trim()))
    .map((b) => ({ txt: b.textContent.trim(), fs: parseFloat(getComputedStyle(b).fontSize) }));
});
check("FE-7: collapse pills present", pills.length > 0, JSON.stringify(pills));
check("FE-7: all collapse pills ≥14px", pills.length > 0 && pills.every((p) => p.fs >= 14), JSON.stringify(pills));

// ── Into Settings (Profile hub → Settings) ────────────────────────────────────
await page.getByRole("button", { name: /Profile/ }).first().click().catch(() => {});
await page.waitForTimeout(1800);
await page.getByRole("button", { name: /Settings/ }).first().click().catch(() => {});
await page.waitForTimeout(1800);

// ── FE-6: theme cards are aria-pressed buttons, not radios ────────────────────
check("FE-6: theme container is role=group (not radiogroup)",
  (await page.getByRole("group", { name: /theme/i }).count()) > 0);
check("FE-6: no role=radio theme cards remain", (await page.locator('[role="radio"]').count()) === 0);

const navy = page.getByRole("button", { name: /Navy theme/ }).first();
check("FE-6: theme card is a button", (await navy.count()) > 0);
if (await navy.count()) {
  await navy.scrollIntoViewIfNeeded();
  check("FE-6: unselected card aria-pressed=false", (await navy.getAttribute("aria-pressed")) === "false");
  await navy.click();
  await page.waitForTimeout(700);
  check("FE-6: selected card aria-pressed=true", (await navy.getAttribute("aria-pressed")) === "true");
  const applied = await page.evaluate(() => ({
    dom: document.documentElement.dataset.theme,
    saved: JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").theme,
  }));
  check("FE-6: theme applies + persists (navy)", applied.dom === "navy" && applied.saved === "navy", JSON.stringify(applied));
}

// ── FE-4 + FE-6: identity theme → describedby disclosure + real revert button ──
const pride = page.getByRole("button", { name: /Pride theme/ }).first();
check("FE-4/6: Pride theme card present", (await pride.count()) > 0);
if (await pride.count()) {
  await pride.scrollIntoViewIfNeeded();
  await pride.click();
  await page.waitForTimeout(700);
  check("FE-4/6: Pride applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "pride");
  check("FE-6: Pride card aria-describedby the identity disclosure",
    (await pride.getAttribute("aria-describedby")) === "identity-theme-note");
  check("FE-6: identity disclosure paragraph present with that id",
    (await page.locator("#identity-theme-note").count()) > 0);

  // FE-4: real keyboard/SR revert button exists and is keyboard-activatable.
  const revertBtn = page.getByRole("button", { name: /^Switch back to Warm dim$/ }).first();
  check("FE-4: identity theme active → real revert button with aria-label", (await revertBtn.count()) > 0);
  if (await revertBtn.count()) {
    await revertBtn.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    check("FE-4: keyboard Enter reverts identity theme to dim",
      (await page.evaluate(() => document.documentElement.dataset.theme)) === "dim");
    const note = await page.evaluate(() => {
      const rs = [...document.querySelectorAll('[role="status"][aria-live="polite"]')];
      return rs.map((r) => (r.textContent || "").trim()).find(Boolean) || "";
    });
    check("FE-4: revert announced via a polite live region",
      /Switched back to Warm dim/.test(note), `note=${JSON.stringify(note)}`);
  }

  // FE-4 invariant: the pointer double-tap path still reverts.
  await pride.scrollIntoViewIfNeeded();
  await pride.click();
  await page.waitForTimeout(600);
  check("FE-4 invariant: Pride re-applied", (await page.evaluate(() => document.documentElement.dataset.theme)) === "pride");
  const revertBtn2 = page.getByRole("button", { name: /^Switch back to Warm dim$/ }).first();
  if (await revertBtn2.count()) {
    await revertBtn2.dblclick();
    await page.waitForTimeout(600);
    check("FE-4 invariant: double-tap still reverts to dim",
      (await page.evaluate(() => document.documentElement.dataset.theme)) === "dim");
  }
}

// ── FE-4 invariant: logout resets identity theme (shared-device safety) ───────
await page.getByRole("button", { name: /Pride theme/ }).first().click().catch(() => {});
await page.waitForTimeout(600);
check("FE-4 invariant: Pride set before sign-out",
  (await page.evaluate(() => document.documentElement.dataset.theme)) === "pride");
// Sign out lives in the edit form's footer (Hub → avatar pencil).
await openProfileEdit(page);
await page.waitForTimeout(800);
const signOut = page.getByRole("button", { name: /Sign out/ }).first();
if (await signOut.count()) {
  await signOut.scrollIntoViewIfNeeded();
  await signOut.click();
  await page.waitForTimeout(2500);
  const post = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    saved: JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").theme || null,
    token: localStorage.getItem("spectrum_token"),
  }));
  check("FE-4 invariant: sign-out resets identity theme (rendered)", post.theme === "dim", `theme=${post.theme}`);
  check("FE-4 invariant: sign-out resets identity theme (persisted)",
    post.saved === "dim" || post.saved === null, `saved=${post.saved}`);
  check("FE-4 invariant: sign-out clears auth", !post.token);
} else {
  check("FE-4 invariant: Sign out control present", false, "not found");
}

check("No console pageerrors across the FE-4..FE-7 golden path", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();
