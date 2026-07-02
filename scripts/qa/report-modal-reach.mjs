// Driver for production-bug fix #1: ReportModal submit reachable at 390px.
// A one-sided like (B → A) puts B on A's Likes tab; A opens "Block or report",
// picks a reason, focuses the details textarea, and we verify the primary
// submit ("Block and report") is inside a scrollable dialog and reachable/
// tappable (in-viewport after scrollIntoView, and hit-testable — not clipped).
import { mkdirSync } from "node:fs";
import { makeAccount, api, launch, login, check, finish, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// One-sided like: Ben likes Ann, Ann has not liked back → Ann sees Ben on Likes.
const ann = await makeAccount("rma", { displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man" });
const ben = await makeAccount("rmb", { displayName: "Ben QA", gender: "man", pronouns: "he/him", seeking: "woman" });
await api("/matching/swipe", { method: "POST", body: { candidateId: ann.userId, decision: "like" } }, ben.token);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
await login(page, ann);

// Go to Likes and open the report modal on the liker.
await page.getByRole("button", { name: /Likes/ }).click();
await page.waitForTimeout(800);
const reportBtn = page.getByRole("button", { name: /Block or report/ }).first();
check("Liker's 'Block or report' control present", (await reportBtn.count()) > 0);
await reportBtn.click();
await page.waitForTimeout(400);

const dialog = page.getByRole("dialog");
check("ReportModal dialog opened", (await dialog.count()) > 0);

// Pick the first reason so the submit becomes enabled + reads "Block and report".
await page.locator('input[name="report-reason"]').first().check();
// Focus the details textarea (the keyboard-open condition on a real phone).
await page.locator('textarea').first().focus();
await page.waitForTimeout(150);

// The dialog must cap its height and scroll internally (the fix).
const style = await dialog.evaluate((el) => {
  const cs = getComputedStyle(el);
  return {
    maxHeight: cs.maxHeight,
    overflowY: cs.overflowY,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
});
const capped = style.maxHeight !== "none" && parseFloat(style.maxHeight) > 0;
check("Dialog caps height (maxHeight set)", capped, `maxHeight=${style.maxHeight}`);
check("Dialog scrolls internally (overflowY auto/scroll)", /(auto|scroll)/.test(style.overflowY), `overflowY=${style.overflowY}`);

// Reachability: scroll the submit into view within the dialog, then confirm it
// sits inside the viewport AND is the topmost element at its center (not clipped
// or covered) — i.e. genuinely tappable.
const submit = page.getByRole("button", { name: /Block and report/ });
check("Submit button labelled 'Block and report'", (await submit.count()) > 0);
await submit.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
await page.waitForTimeout(150);

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
  };
});
check(
  "Submit is inside the viewport after scroll",
  reach.top >= 0 && reach.bottom <= reach.innerHeight,
  `top=${reach.top} bottom=${reach.bottom} vh=${reach.innerHeight}`
);
check("Submit is enabled (reason chosen)", !reach.disabled);
check("Submit is topmost/tappable at its center (not clipped/covered)", reach.hitIsSubmit);

await page.screenshot({ path: `${OUT}/report-modal-390-submit-reachable.png` });
check("No console pageerrors during report flow", errors.length === 0, errors.join(" | "));

await browser.close();
finish();
