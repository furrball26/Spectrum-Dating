// Driver for production-bug fix: the full-page in-conversation "Block or report"
// screen (src/messaging/BlockReportScreen.jsx, NOT the ReportModal) was clipped
// behind the bottom nav at 390px with no way to scroll to Submit. It mounts
// inside the height-locked Messages tab, and had minHeight:"100%" with no
// overflow, so tall content was unreachable.
//
// Repro path: a matched pair with a seeded conversation → open the thread →
// Conversation options → "Block and report" (the FULL PAGE) → tick both actions
// + pick a reason so Submit enables → assert Submit is reachable via the
// screen's OWN internal scroll, in-viewport, enabled, and topmost at its center
// (not covered by the nav) — while body.scrollHeight === innerHeight still holds.
import { mkdirSync } from "node:fs";
import { makeMatchedPair, seedConversation, launch, login, check, finish, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const pair = await makeMatchedPair("brr");
await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
await login(page, pair.a);

// Into Messages → open the conversation with Ben QA.
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2200);
const row = page.getByRole("button", { name: /Ben QA/ }).first();
check("Conversation row visible", (await row.count()) > 0);
await row.click();
await page.waitForTimeout(2500);

// Open the full-page Block-and-report screen from the thread header menu.
await page.getByRole("button", { name: /Conversation options/ }).click();
await page.getByRole("menuitem", { name: /Block and report/ }).click();
await page.waitForTimeout(1500);

const screen = page.locator('[data-testid="block-report-scroll"]');
check("Full-page BlockReportScreen mounted", (await screen.count()) > 0);

// The screen must be its own bounded scroll container (the fix).
const style = await screen.evaluate((el) => {
  const cs = getComputedStyle(el);
  return {
    overflowY: cs.overflowY,
    height: Math.round(el.clientHeight),
    scrollHeight: Math.round(el.scrollHeight),
    innerHeight: window.innerHeight,
  };
});
check("Screen scrolls internally (overflowY auto/scroll)", /(auto|scroll)/.test(style.overflowY), `overflowY=${style.overflowY}`);
check("Screen is bounded to ≈viewport (not content height)", style.height <= style.innerHeight + 2, `clientH=${style.height} vh=${style.innerHeight}`);

// doBlock defaults ON; tick Report too so both actions are chosen.
await page.getByText(/Report to our team/).click();
// Pick the first reason so Submit enables + reads "Block and report".
await page.locator('input[name="reason"]').first().check();
await page.waitForTimeout(200);

const submit = page.getByRole("button", { name: /Block and report/ });
check("Submit button labelled 'Block and report'", (await submit.count()) > 0);

// Reachability: scroll the submit into view WITHIN the screen's own scroller,
// then confirm it sits inside the viewport AND is the topmost element at its
// center (genuinely tappable — not clipped or covered by the bottom nav).
await submit.evaluate((el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(200);

const reach = await submit.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    innerHeight: window.innerHeight,
    disabled: el.disabled,
    hitIsSubmit: el.contains(hit) || hit === el,
    bodyScrollHeight: document.body.scrollHeight,
  };
});
check(
  "Submit is inside the viewport after internal scroll",
  reach.top >= 0 && reach.bottom <= reach.innerHeight,
  `top=${reach.top} bottom=${reach.bottom} vh=${reach.innerHeight}`
);
check("Submit is enabled (both actions + reason chosen)", !reach.disabled);
check("Submit is topmost/tappable at its center (not covered by nav)", reach.hitIsSubmit);
check(
  "Messages-tab invariant holds (body.scrollHeight === innerHeight)",
  reach.bodyScrollHeight === reach.innerHeight,
  `bodyScrollHeight=${reach.bodyScrollHeight} innerHeight=${reach.innerHeight}`
);

await page.screenshot({ path: `${OUT}/block-report-390-submit-reachable.png` });

// ── Second fix: bottom-nav "Messages" returns to the LIST from a sub-screen ──
// From the block-report page, tapping the already-active Messages nav must drop
// back to the conversation list (block-report gone, list visible).
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(1200);
check("Nav tap from block-report clears the block-report screen",
  (await page.locator('[data-testid="block-report-scroll"]').count()) === 0);
check("Nav tap from block-report lands on the conversation list",
  (await page.getByRole("button", { name: /Ben QA/ }).count()) > 0);

// Also verify it works from a plain conversation sub-screen.
await page.getByRole("button", { name: /Ben QA/ }).first().click();
await page.waitForTimeout(2000);
check("Re-opened the conversation", (await page.getByRole("button", { name: /Conversation options/ }).count()) > 0);
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(1200);
check("Nav tap from a conversation returns to the list",
  (await page.getByRole("button", { name: /Conversation options/ }).count()) === 0 &&
  (await page.getByRole("button", { name: /Ben QA/ }).count()) > 0);

await page.screenshot({ path: `${OUT}/block-report-nav-return-list.png` });
check("No console pageerrors during block-report flow", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
finish();
