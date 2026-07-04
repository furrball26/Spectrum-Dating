// Standing regression smoke for Spectrum Dating — the QA gate in the ship
// pipeline (CLAUDE.md). Run after EVERY UI change:
//   1. export VITE_API_URL=… && npm run build
//   2. npx vite preview --port 4173   (in the background)
//   3. node scripts/qa/smoke.mjs      (exit 0 = PASS)
// Covers the golden path + layout invariants from past regressions
// (bubble overlap, page growth, hooks crashes, theme system).
import { mkdirSync } from "node:fs";
import { makeMatchedPair, seedConversation, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const pair = await makeMatchedPair("smoke");
await seedConversation(pair, [
  "Hey! How was your weekend?",
  "Pretty calm — I reorganized my workshop and it felt great.",
  "That sounds satisfying. There is something deeply calming about everything having a place.",
  "Exactly! What about you?",
  "I went hiking early Saturday before the trails got busy. The quiet light was worth the alarm.",
  "Nice. Which trail?",
  "The long loop past the reservoir — about nine miles round trip but mostly flat.",
]);

const { browser, page, errors } = await launch();
await login(page, pair.a);

// 1 — boot + nav
const nav = page.locator('nav[aria-label="Primary"]');
const navText = await nav.innerText().catch(() => "");
check("App boots to Discover with primary nav", /Discover/.test(navText) && /Messages/.test(navText) && /Likes/.test(navText));
check("Default theme is dim", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dim");

// 2 — messages list
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2000);
check("Conversation row renders (name visible)", (await page.getByRole("button", { name: /Ben QA/ }).count()) > 0);
await page.screenshot({ path: `${OUT}/smoke_list.png` });

// 3 — open thread + layout invariants
await page.getByRole("button", { name: /Ben QA/ }).first().click();
await page.waitForTimeout(2500);
const layout = await page.evaluate(() => {
  const log = document.querySelector('[role="log"]');
  const rows = log ? [...log.firstElementChild.children] : [];
  let worstOverflow = 0;
  rows.forEach((r) => {
    const rb = r.getBoundingClientRect();
    r.querySelectorAll("*").forEach((el) => {
      const eb = el.getBoundingClientRect();
      if (eb.height > 0) worstOverflow = Math.max(worstOverflow, eb.bottom - rb.bottom);
    });
  });
  return {
    bodyGrowth: document.body.scrollHeight - window.innerHeight,
    logScrolls: !!log && log.scrollHeight > log.clientHeight,
    hasLog: !!log,
    worstOverflow: Math.round(worstOverflow),
    rowCount: rows.length,
  };
});
check("Thread opened (message log present)", layout.hasLog, `rows=${layout.rowCount}`);
check("No bubble overlap (row overflow ≤ 2px)", layout.worstOverflow <= 2, `worst=${layout.worstOverflow}px`);
check("Messages tab does not grow the page", layout.bodyGrowth <= 1, `growth=${layout.bodyGrowth}px`);
check("Log is the internal scroller", layout.logScrolls);
await page.screenshot({ path: `${OUT}/smoke_thread.png` });

// 4 — send a message end to end
await page.getByPlaceholder(/Write a message/i).fill("Smoke test message — please ignore.");
await page.getByRole("button", { name: /^Send$/ }).click();
await page.waitForTimeout(2500);
check("Sent message renders in the thread", (await page.getByText("Smoke test message — please ignore.").count()) > 0);

// 5 — Likes tab renders calmly (empty or with likers, never an error state)
await page.getByRole("button", { name: /Likes/ }).click();
await page.waitForTimeout(2000);
const likesBody = await page.locator("body").innerText();
check("Likes tab renders", /Likes/.test(likesBody) && !/Something went wrong/i.test(likesBody));

// 6 — theme switch round-trip (storage-driven, fail-closed whitelist)
await page.evaluate(() => {
  const a = JSON.parse(localStorage.getItem("spectrum_a11y") || "{}");
  a.theme = "navy";
  localStorage.setItem("spectrum_a11y", JSON.stringify(a));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
check("Saved theme applies on load (navy)", (await page.evaluate(() => document.documentElement.dataset.theme)) === "navy");

// 7 — zero console errors across the whole run
check("No console pageerrors on the golden path", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

// Teardown: delete the qa+ accounts this run seeded so they don't pollute the
// moderation board. Best-effort — never affects the PASS/FAIL result above.
await cleanupAccounts([pair.a.token, pair.b.token]);
