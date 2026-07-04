// Driver for the touch/chat UX backlog (CHAT-1/2/3 + UX-TAP). Runs at 390px with
// TOUCH EMULATION (hasTouch → `(pointer: coarse)` matches, touchscreen enabled),
// which is what those fixes are about. Proves:
//   (a) CHAT-1 — the conversation [role="log"] does NOT scroll horizontally, even
//       with a long unbroken message (scrollWidth <= clientWidth), and the
//       Messages-tab invariant still holds (body.scrollHeight === innerHeight).
//   (b) CHAT-3 — the reaction ＋ is VISIBLE without hover on a coarse pointer
//       (computed opacity > 0).
//   (c) CHAT-2 — a simulated long-press (~450ms, no early touchend) on a message
//       BUBBLE opens the ReactionPicker; a scroll (touchmove past threshold) does
//       NOT open it.
//   (d) UX-TAP — tapping a toggle-row LABEL (not the switch) flips the persisted
//       state (localStorage `spectrum_a11y`).
import { mkdirSync } from "node:fs";
import { makeMatchedPair, seedConversation, launch, login, check, finish, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const LONG_UNBROKEN =
  "supercalifragilisticexpialidocious" + "x".repeat(90); // 124 chars, no spaces

const pair = await makeMatchedPair("tcu");
await seedConversation(pair, [
  "React to me please — QA seed.",
  LONG_UNBROKEN,
]);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, hasTouch: true });
await login(page, pair.a);

// Sanity: touch emulation actually took (coarse pointer + no hover).
const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
check("Touch emulation active — (pointer: coarse) matches", coarse === true, `coarse=${coarse}`);

// Into Messages → open the thread with Ben QA.
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2200);
await page.getByRole("button", { name: /Ben QA/ }).first().click();
await page.waitForTimeout(2500);

const log = page.locator('[role="log"]');
check("Conversation log present", (await log.count()) > 0);

// ── (a) CHAT-1: no horizontal scroll even with a long unbroken message ────────
const logMetrics = await log.evaluate((el) => ({
  scrollWidth: Math.round(el.scrollWidth),
  clientWidth: Math.round(el.clientWidth),
  overflowX: getComputedStyle(el).overflowX,
  bodyScrollHeight: document.body.scrollHeight,
  innerHeight: window.innerHeight,
}));
check(
  "CHAT-1: log does NOT scroll horizontally (scrollWidth <= clientWidth)",
  logMetrics.scrollWidth <= logMetrics.clientWidth,
  `scrollWidth=${logMetrics.scrollWidth} clientWidth=${logMetrics.clientWidth}`
);
check("CHAT-1: log overflowX is hidden", logMetrics.overflowX === "hidden", `overflowX=${logMetrics.overflowX}`);
check(
  "Messages-tab invariant holds (body.scrollHeight === innerHeight)",
  logMetrics.bodyScrollHeight === logMetrics.innerHeight,
  `bodyScrollHeight=${logMetrics.bodyScrollHeight} innerHeight=${logMetrics.innerHeight}`
);

// ── (b) CHAT-3: the ＋ is visible on a coarse pointer without any hover ────────
const plus = page.getByRole("button", { name: /^Add reaction$/ }).first();
check("Reaction ＋ button present", (await plus.count()) > 0);
const plusStyle = await plus.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { opacity: parseFloat(cs.opacity), fontSize: cs.fontSize, color: cs.color };
});
check(
  "CHAT-3: ＋ is visible without hover on coarse pointer (opacity > 0)",
  plusStyle.opacity > 0,
  `opacity=${plusStyle.opacity} fontSize=${plusStyle.fontSize}`
);

// ── (c) CHAT-2: long-press opens the picker; a scroll does NOT ────────────────
// Helpers to dispatch synthetic touch sequences at an element's center.
async function touchStart(locator) {
  await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const tp = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y, radiusX: 5, radiusY: 5, force: 1 };
    const tch = new Touch(tp);
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [tch], targetTouches: [tch], changedTouches: [tch] }));
    window.__ts = { x, y, el };
  });
}
async function touchMoveAway(locator) {
  await locator.evaluate((el) => {
    const { x, y } = window.__ts;
    const nx = x + 40, ny = y + 40;
    const tch = new Touch({ identifier: 1, target: el, clientX: nx, clientY: ny, pageX: nx, pageY: ny, screenX: nx, screenY: ny, radiusX: 5, radiusY: 5, force: 1 });
    el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [tch], targetTouches: [tch], changedTouches: [tch] }));
  });
}
async function touchEnd(locator) {
  await locator.evaluate((el) => {
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [] }));
  });
}

const bubble = page.getByText("React to me please — QA seed.").first();
check("Target bubble located", (await bubble.count()) > 0);
// PROD-4 — the picker is now role="group" labelled "React with an emoji"
// (was role="toolbar"). The ＋ trigger button keeps its "Add reaction" label.
const picker = page.getByRole("group", { name: /react with an emoji/i });

// Negative: a touch that moves (a scroll) must NOT open the picker.
await touchStart(bubble);
await touchMoveAway(bubble);
await touchEnd(bubble);
await page.waitForTimeout(650);
check("CHAT-2: a scroll (touchmove) does NOT open the picker", (await picker.count()) === 0, `pickers=${await picker.count()}`);

// Positive: a held touch (~650ms, no early touchend) fires the long-press.
await touchStart(bubble);
await page.waitForTimeout(650); // > 450ms long-press threshold
check("CHAT-2: long-press on a bubble opens the ReactionPicker", (await picker.count()) > 0, `pickers=${await picker.count()}`);

await page.screenshot({ path: `${OUT}/touch-longpress-picker-390.png` });

// Choose an emoji from the long-press-opened picker → a reaction pill appears.
await picker.getByRole("button", { name: /React with/ }).first().click();
await page.waitForTimeout(1200);
check("CHAT-2: picking from the long-press picker adds a reaction", (await page.getByRole("button", { name: /reaction/ }).count()) > 0);

check("No console pageerrors during chat touch flow", errors.length === 0, errors.slice(0, 3).join(" | "));

// ── (d) UX-TAP: tapping a toggle-row LABEL flips persisted state ──────────────
// Navigate to Settings via the Profile hub, then tap the LABEL text (not switch).
await page.getByRole("button", { name: /^profile$/i }).first().click();
await page.waitForTimeout(1500);
// Settings is now the Profile Hub's top-right gear button.
await page.getByRole("button", { name: /^Settings$/ }).first().click();
await page.waitForTimeout(1200);
check("Settings screen opened", (await page.getByRole("group", { name: /theme/i }).count()) > 0);

function readPlainLanguage(p) {
  return p.evaluate(() => {
    try { return !!JSON.parse(localStorage.getItem("spectrum_a11y") || "{}").plainLanguage; }
    catch { return null; }
  });
}
const before = await readPlainLanguage(page);
// Tap the LABEL text specifically (far from the switch button).
await page.getByText("Plain language", { exact: true }).click();
await page.waitForTimeout(600);
const after = await readPlainLanguage(page);
check(
  "UX-TAP: tapping the toggle-row LABEL flips persisted state",
  typeof before === "boolean" && before !== after,
  `before=${before} after=${after}`
);
// And the switch's aria-checked reflects the new state.
const rowSwitch = page.locator('[aria-labelledby="a11y-plain-language-label"]');
const ariaChecked = await rowSwitch.getAttribute("aria-checked");
check("UX-TAP: switch aria-checked reflects the label tap", ariaChecked === String(after), `aria-checked=${ariaChecked} state=${after}`);

await browser.close();
finish();
