// Evidence driver for the B5a / B6 / B7 calm-design bug fixes.
//   B5a — ReportModal confirmation no longer auto-closes; a "Done" button
//         dismisses when the user is ready.
//   B6  — Safety Center "Withdraw" uses a calm in-app dialog (not window.confirm).
//   B7  — BlockReportScreen opened from a pinned message defaults Block OFF.
// Captures a screenshot for each and asserts the load-bearing state.
import { mkdirSync } from "node:fs";
import {
  makeAccount, makeMatchedPair, seedConversation, api, launch, login, check, finish, OUT,
} from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// ── B5a + B6: report confirmation Done button, then calm withdraw dialog ──────
{
  // One-sided like so Ben lands on Ann's Likes tab (report/block reachable there).
  const ann = await makeAccount("b56a", { displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const ben = await makeAccount("b56b", { displayName: "Ben QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: ann.userId, decision: "like" } }, ben.token);

  // Desktop viewport so the header SafetyLink is available (mobile hides it in
  // the Profile hub); ReportModal renders identically either way.
  const { browser, page, errors } = await launch({ viewport: { width: 1200, height: 900 } });
  await login(page, ann);

  await page.getByRole("button", { name: /Likes/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Block or report/ }).first().click();
  await page.waitForTimeout(400);
  check("ReportModal opened", (await page.getByRole("dialog").count()) > 0);

  // Pick a reason; keep Block+Report (defaults) → submit reads "Block and report".
  await page.locator('input[name="report-reason"]').first().check();
  await page.getByRole("button", { name: /Block and report/ }).click();

  // Wait well past the OLD 1.6s auto-close to prove the confirmation persists.
  await page.waitForTimeout(3000);
  const doneBtn = page.getByRole("button", { name: /^Done$/ });
  const stillOpen = (await page.getByRole("dialog").count()) > 0;
  check("Confirmation dialog still open >3s after submit (no auto-close)", stillOpen);
  check("Calm 'Done' button present on the confirmation", (await doneBtn.count()) > 0);
  const confirmText = await page.getByRole("dialog").getByRole("status").innerText().catch(() => "");
  check("Confirmation copy is shown", /reported|Blocked|report/i.test(confirmText), confirmText.slice(0, 60));
  await page.screenshot({ path: `${OUT}/b5a-report-confirm-done.png` });

  // Dismiss with Done, then open Safety Center → Your reports → Withdraw.
  await doneBtn.click();
  await page.waitForTimeout(400);
  check("Done closes the confirmation", (await page.getByRole("dialog").count()) === 0);

  await page.getByRole("button", { name: /^Safety Center$/ }).click();
  await page.waitForTimeout(1500);
  const withdrawBtn = page.getByRole("button", { name: /^Withdraw$/ }).first();
  check("Open report shows a Withdraw control", (await withdrawBtn.count()) > 0);
  await withdrawBtn.click();
  await page.waitForTimeout(400);

  const wDialog = page.getByRole("dialog");
  check("Calm withdraw dialog opened (no native confirm)", (await wDialog.count()) > 0);
  const wHeading = await wDialog.first().innerText().catch(() => "");
  check("Withdraw dialog carries the calm copy", /Withdraw this report|change your mind/i.test(wHeading), wHeading.slice(0, 80));
  await page.screenshot({ path: `${OUT}/b6-withdraw-confirm-dialog.png` });

  // Escape cancels (accessibility) — dialog closes, report unchanged.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape cancels the withdraw dialog", (await page.getByRole("dialog").count()) === 0);

  check("No console pageerrors (B5a/B6 flow)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── B7: BlockReportScreen from a pinned message defaults Block OFF ────────────
{
  const pair = await makeMatchedPair("b7");
  await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);

  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await login(page, pair.a); // Ann; Ben sent "QA seed two" (a non-own bubble).

  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);

  // Open the per-message menu on BEN's bubble and pick "Report this message".
  // Own bubbles show "Delete message"; only the other person's shows the report
  // item — click each "Message options" until that item appears.
  const optButtons = page.getByRole("button", { name: "Message options" });
  const n = await optButtons.count();
  check("Message options buttons present", n > 0, `count=${n}`);
  let opened = false;
  for (let i = 0; i < n; i++) {
    await optButtons.nth(i).click();
    await page.waitForTimeout(250);
    const reportItem = page.getByRole("menuitem", { name: /Report this message/ });
    if (await reportItem.count()) {
      await reportItem.click();
      opened = true;
      break;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  check("Opened 'Report this message' on the other person's bubble", opened);
  await page.waitForTimeout(1200);

  const screen = page.locator('[data-testid="block-report-scroll"]');
  check("BlockReportScreen mounted from pinned message", (await screen.count()) > 0);
  check("Pinned-message evidence block shown", (await page.getByText(/Reporting this message/).count()) > 0);

  // The two action checkboxes, in DOM order: [0] Block them, [1] Report to our team.
  const checkboxes = screen.locator('input[type="checkbox"]');
  const blockChecked = await checkboxes.nth(0).isChecked();
  const reportChecked = await checkboxes.nth(1).isChecked();
  check("B7: Block defaults OFF when a message is pinned", blockChecked === false, `blockChecked=${blockChecked}`);
  check("B7: Report defaults ON when a message is pinned", reportChecked === true, `reportChecked=${reportChecked}`);

  // Capture with BOTH toggles visible (before picking a reason scrolls the view).
  await page.screenshot({ path: `${OUT}/b7-blockreport-pinned-block-off.png` });

  // Guard still holds: with report on, Submit is enabled once a reason is picked.
  await page.locator('input[name="reason"]').first().check();
  await page.waitForTimeout(200);
  const submit = page.getByRole("button", { name: /Send report/ });
  check("Submit reads 'Send report' (report-only) and enables with a reason",
    (await submit.count()) > 0 && !(await submit.first().isDisabled()));

  check("No console pageerrors (B7 flow)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

finish();
