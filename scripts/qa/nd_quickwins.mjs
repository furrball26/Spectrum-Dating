// Driver for the three ND quick-win features:
//  1. Composer draft persistence (per-conversation localStorage).
//  2. What-to-expect card surfacing the match's helpsMe / hardForMe.
//  3. Discover interested-vs-intro explainer copy.
// Reuses harness.mjs (no hand-rolled browser/API plumbing).
import { api, makeAccount, seedConversation, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";
import fs from "node:fs";

fs.mkdirSync(OUT, { recursive: true });
const tokens = [];

try {
  // Matched pair; Ben (b) carries the "what helps / hard for me" facets.
  const a = await makeAccount("ndqwA", { displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const b = await makeAccount("ndqwB", {
    displayName: "Ben QA", gender: "man", pronouns: "he/him", seeking: "woman",
    helpsMe: ["Clear plans made ahead", "Text before calling"],
    hardForMe: ["Last-minute changes", "Loud, busy places"],
    contextCard: "I take a little while to reply, and that's okay.",
  });
  // Cal (c) is an un-swiped candidate so Ann's Discover deck has someone to
  // view (the explainer only shows in the active viewing stage).
  const c = await makeAccount("ndqwC", { displayName: "Cal QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  tokens.push(a, b, c);
  await api("/matching/swipe", { method: "POST", body: { candidateId: a.userId, decision: "like" } }, b.token);
  const sw = await api("/matching/swipe", { method: "POST", body: { candidateId: b.userId, decision: "like" } }, a.token);
  const matchId = sw.body?.matchId || sw.body?.match?.matchId;
  if (!matchId) throw new Error(`match failed: ${JSON.stringify(sw.body)}`);
  const convId = await seedConversation({ a, b, matchId }, []); // 0 msgs → brand-new thread

  const { browser, page, errors } = await launch();

  // ── Log in as Ann and open the thread with Ben ──
  await login(page, a);
  await page.getByRole("button", { name: /messages/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  // Open the conversation row.
  await page.getByText(/Ben QA/i).first().click().catch(() => {});
  await page.waitForTimeout(2000);

  // ── Feature 2: What-to-expect card shows helpsMe / hardForMe ──
  const helpsVisible = await page.getByText("What helps me").first().isVisible().catch(() => false);
  const hardVisible = await page.getByText("Harder for me").first().isVisible().catch(() => false);
  const helpsEntry = await page.getByText("Clear plans made ahead").first().isVisible().catch(() => false);
  const hardEntry = await page.getByText("Last-minute changes").first().isVisible().catch(() => false);
  check("What-to-expect shows 'What helps me' label", helpsVisible);
  check("What-to-expect shows 'Harder for me' label", hardVisible);
  check("What-to-expect lists a helpsMe entry", helpsEntry);
  check("What-to-expect lists a hardForMe entry", hardEntry);
  await page.getByText("What helps me").first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ndqw_b_what_to_expect.png` });

  // ── Feature 1: composer draft persists across nav ──
  const DRAFT = "A carefully typed message I do not want to lose.";
  const composer = page.locator("textarea").first();
  await composer.click().catch(() => {});
  await composer.fill(DRAFT).catch(() => {});
  await page.waitForTimeout(600);
  const storedAfterType = await page.evaluate((cid) => localStorage.getItem(`spectrum_draft_${cid}`), convId);
  check("Draft written to localStorage on type", storedAfterType === DRAFT, `stored=${JSON.stringify(storedAfterType)}`);

  // Navigate away to Discover, then back to the thread.
  await page.getByRole("button", { name: /discover/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /messages/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText(/Ben QA/i).first().click().catch(() => {});
  await page.waitForTimeout(1800);
  const restored = await page.locator("textarea").first().inputValue().catch(() => "");
  check("Composer text restored after navigate-away-and-back", restored === DRAFT, `restored=${JSON.stringify(restored)}`);
  await page.screenshot({ path: `${OUT}/ndqw_a_draft_restored.png`, fullPage: true });

  // Clearing the composer removes the key (mirrors a successful send).
  await page.locator("textarea").first().fill("").catch(() => {});
  await page.waitForTimeout(400);
  const afterClear = await page.evaluate((cid) => localStorage.getItem(`spectrum_draft_${cid}`), convId);
  check("Draft key removed when composer empties", afterClear === null, `val=${JSON.stringify(afterClear)}`);

  // ── Feature 3: Discover interested-vs-intro explainer ──
  // Fresh QA accounts only have PENDING photos, so the real Discover deck is
  // empty (candidates.js excludes no-approved-photo accounts). Inject one
  // synthetic candidate so the ACTIVE viewing stage renders and the explainer
  // shows. Registered after launch → takes precedence over the harness catch-all.
  await page.route("**/matching/candidates**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify([
        { memberId: "synthetic-cand-1", displayName: "Cal QA", pronouns: "he/him", gender: "man", age: 31, tagline: "Likes quiet cafes", bio: "Board games and long walks.", interests: ["board games"], whyReasons: [], distCity: "Phoenix, AZ", relationshipGoal: "long-term" },
      ]),
    })
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /discover/i }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const explainerVisible = await page.getByText(/match only if they say yes too/i).first().isVisible().catch(() => false);
  check("Discover shows interested-vs-intro explainer", explainerVisible);
  await page.getByText(/match only if they say yes too/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ndqw_c_discover_explainer.png` });

  check("No console pageerrors", errors.length === 0, errors.join(" | "));
  await browser.close();
} finally {
  await cleanupAccounts(tokens);
}

finish();
