// Driver for two messaging bug fixes shipped together:
//
//  FE-2 (a11y): the per-row ⋯ menu (MatchesListScreen RowMenu) used to close on
//  item-activation BEFORE opening the modal, unmounting the focused menuitem so
//  document.activeElement fell to <body>; the opened modal then snapshotted
//  <body> as its focus-restore target and dumped a keyboard user at the top of
//  the page on close. The fix moves focus to the ⋯ trigger synchronously before
//  the modal mounts, so on close focus returns to the row. We assert exactly
//  that: open ⋯ → activate "Block or report" → ReportModal → Escape-close →
//  document.activeElement is the row's ⋯ button (NOT body), at 390px.
//
//  FE-1 (trust&safety): when a user asks to Block AND Report and the block lands
//  but the report API fails, the flow used to claim plain success ("Blocked")
//  and silently drop the report. The fix keeps the block, does NOT claim the
//  report was sent, and surfaces a calm honest notice. We force the report
//  endpoint to 500 (block still reaches the real backend) and assert the
//  confirmation says the block landed AND that the report couldn't be sent.
import { mkdirSync } from "node:fs";
import { makeMatchedPair, seedConversation, launch, login, check, finish, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const pair = await makeMatchedPair("msa");
await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
await login(page, pair.a);

// Into Messages; the seeded (started) conversation with Ben QA shows in the
// "Active conversations" section, which carries the per-row ⋯ menu.
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2200);

const trigger = page.getByRole("button", { name: /More options for Ben QA/ }).first();
check("Row ⋯ menu trigger present", (await trigger.count()) > 0);

// ── FE-2: focus returns to the ⋯ trigger after a menu-opened modal closes ──────
await trigger.click();
await page.waitForTimeout(250);
const reportItem = page.getByRole("menuitem", { name: /Block or report/ });
check("⋯ menu opened with 'Block or report' item", (await reportItem.count()) > 0);
await reportItem.click();
await page.waitForTimeout(400);

const dialog = page.getByRole("dialog");
check("Row 'Block or report' opened the ReportModal dialog", (await dialog.count()) > 0);

// Close the modal (Escape) — it should restore focus to whatever it snapshotted
// on open. With the fix that snapshot is the ⋯ trigger, not <body>.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

const focusAfterClose = await page.evaluate(() => {
  const el = document.activeElement;
  return {
    tag: el ? el.tagName.toLowerCase() : null,
    label: el ? el.getAttribute("aria-label") : null,
    haspopup: el ? el.getAttribute("aria-haspopup") : null,
    isBody: el === document.body,
  };
});
check(
  "FE-2: dialog closed (not left open)",
  (await dialog.count()) === 0
);
check(
  "FE-2: focus NOT dumped to <body> after modal close",
  !focusAfterClose.isBody,
  `activeElement=<${focusAfterClose.tag}>`
);
check(
  "FE-2: focus restored to the row's ⋯ trigger",
  focusAfterClose.label === "More options for Ben QA" && focusAfterClose.haspopup === "menu",
  `label=${JSON.stringify(focusAfterClose.label)} haspopup=${focusAfterClose.haspopup}`
);

// ── FE-1: block succeeds + report fails → honest, non-silent notice ───────────
// Force the report endpoint to fail (page routes take precedence over the
// harness context route); the block call still reaches the real backend.
await page.route("**/messaging/report", (route) =>
  route.fulfill({
    status: 500,
    headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: '{"error":"forced-failure"}',
  })
);

await trigger.click();
await page.waitForTimeout(250);
await page.getByRole("menuitem", { name: /Block or report/ }).click();
await page.waitForTimeout(400);
check("Re-opened the ReportModal for the forced-failure case", (await page.getByRole("dialog").count()) > 0);

// Block + Report are both ON by default in this modal. Pick a reason so submit
// enables and reads "Block and report", then submit.
await page.locator('input[name="report-reason"]').first().check();
await page.waitForTimeout(150);
const submit = page.getByRole("button", { name: /Block and report/ });
check("Submit reads 'Block and report' (both actions chosen)", (await submit.count()) > 0);
await submit.click();
await page.waitForTimeout(700);

// The confirmation is shown (role=status) inside the dialog before it auto-closes.
const confirmText = await page.evaluate(() => {
  const s = document.querySelector('[role="dialog"] [role="status"]');
  return s ? s.textContent.trim() : "";
});
check(
  "FE-1: confirmation acknowledges the block LANDED",
  /blocked/i.test(confirmText),
  `confirm=${JSON.stringify(confirmText)}`
);
check(
  "FE-1: confirmation is HONEST that the report was NOT sent (no false success)",
  /couldn't send your report/i.test(confirmText) && !/reported\./i.test(confirmText),
  `confirm=${JSON.stringify(confirmText)}`
);
check(
  "FE-1: honest notice points to Safety Center for retry",
  /Safety Center/.test(confirmText),
  `confirm=${JSON.stringify(confirmText)}`
);

await page.screenshot({ path: `${OUT}/messaging-safety-a11y.png` });

// The block genuinely landed: after the modal closes, the conversation row is
// dropped from the list (onBlocked) — i.e. the successful block was NOT undone.
await page.waitForTimeout(1400);
check(
  "FE-1: successful block preserved (conversation dropped from list)",
  (await page.getByRole("button", { name: /More options for Ben QA/ }).count()) === 0
);

check("No console pageerrors during the flow", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
finish();
