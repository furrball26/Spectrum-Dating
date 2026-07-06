// Spot-checks for the backlog-cleanup batch (branch production-bugs-backlog-okvown).
// Verifies: B4 (gender opt-out completes + candidates), B1/T1 (block severs
// profile both ways), B2 (desktop draft bleed), B21 (avatar fallback), T2
// (block/report in match-profile modal), B20 (no duplicate Liked-you in Messages).
// Run: node scripts/qa/spotcheck_backlog.mjs   (vite preview must be on :4173)
import { mkdirSync } from "node:fs";
import {
  api, makeAccount, makeMatchedPair, launch, login, check, finish,
  cleanupAccounts, API, OUT,
} from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const cleanup = [];

// ───────────────────────────────────────────────────────────────────────────
// B4 — "Prefer not to say" gender opt-out can COMPLETE onboarding + get candidates
// ───────────────────────────────────────────────────────────────────────────
{
  const optout = await makeAccount("b4optout", {
    displayName: "Opt Out QA", gender: "", pronouns: "they/them",
    orientation: "queer", seeking: "woman",
  });
  cleanup.push(optout.token);

  const me = await api("/profile/me", {}, optout.token);
  check("B4 profile persists gender='' (opt-out)", me.body?.gender === "" || me.body?.gender == null,
    `gender=${JSON.stringify(me.body?.gender)}`);
  check("B4 opt-out account is onboardingComplete", me.body?.onboardingComplete === true,
    `onboardingComplete=${me.body?.onboardingComplete}`);

  const cand = await api("/matching/candidates", {}, optout.token);
  check("B4 /matching/candidates returns 200 for opt-out account", cand.status === 200,
    `status=${cand.status}`);
  check("B4 candidates payload is a usable array (no crash on empty gender)",
    Array.isArray(cand.body?.candidates) || Array.isArray(cand.body),
    `keys=${cand.body ? Object.keys(cand.body).join(",") : "null"}`);

  // Reach the main app in a real browser (onboardingComplete → app shell nav).
  const { browser, page, errors } = await launch();
  await login(page, optout);
  const nav = await page.locator('nav[aria-label="Primary"]').count();
  check("B4 opt-out account reaches the main app shell (nav present)", nav > 0, `nav=${nav}`);
  check("B4 no pageerrors for opt-out account", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ───────────────────────────────────────────────────────────────────────────
// B1/T1 — a block severs full-profile visibility in BOTH directions (403)
// ───────────────────────────────────────────────────────────────────────────
{
  const pair = await makeMatchedPair("b1blk");
  cleanup.push(pair.a.token, pair.b.token);
  const ctrl = await makeMatchedPair("b1ctl");
  cleanup.push(ctrl.a.token, ctrl.b.token);

  // Baseline: matched pair can read each other's profile.
  const a2b = await api(`/profile/${pair.b.userId}`, {}, pair.a.token);
  const b2a = await api(`/profile/${pair.a.userId}`, {}, pair.b.token);
  check("B1 baseline: A reads B's profile (200)", a2b.status === 200, `status=${a2b.status}`);
  check("B1 baseline: B reads A's profile (200)", b2a.status === 200, `status=${b2a.status}`);

  // A blocks B.
  const blk = await api("/messaging/block",
    { method: "POST", body: { blockedUserId: pair.b.userId, reason: "other" } }, pair.a.token);
  check("B1 A blocks B (200/201)", blk.status === 200 || blk.status === 201, `status=${blk.status}`);

  const a2bAfter = await api(`/profile/${pair.b.userId}`, {}, pair.a.token);
  const b2aAfter = await api(`/profile/${pair.a.userId}`, {}, pair.b.token);
  check("T1 after block: A→B profile is 403", a2bAfter.status === 403, `status=${a2bAfter.status}`);
  check("T1 after block: B→A profile is 403 (both directions)", b2aAfter.status === 403, `status=${b2aAfter.status}`);

  // Control pair unaffected.
  const c2d = await api(`/profile/${ctrl.b.userId}`, {}, ctrl.a.token);
  check("B1 control matched pair still 200 (block is scoped)", c2d.status === 200, `status=${c2d.status}`);
}

// ───────────────────────────────────────────────────────────────────────────
// B2 — desktop draft bleed: typing in convo A must not appear in convo B
// ───────────────────────────────────────────────────────────────────────────
{
  const x = await makeAccount("b2x", { displayName: "Xavier QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  const p = await makeAccount("b2p", { displayName: "Pia QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const q = await makeAccount("b2q", { displayName: "Quinn QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  cleanup.push(x.token, p.token, q.token);

  async function match(u1, u2) {
    await api("/matching/swipe", { method: "POST", body: { candidateId: u2.userId, decision: "like" } }, u1.token);
    const sw = await api("/matching/swipe", { method: "POST", body: { candidateId: u1.userId, decision: "like" } }, u2.token);
    return sw.body?.matchId || sw.body?.match?.matchId;
  }
  const mXP = await match(x, p);
  const mXQ = await match(x, q);
  async function seed(matchId, tok, text) {
    const cc = await api("/messaging/conversations", { method: "POST", body: { matchId } }, tok);
    const cid = cc.body?.conversation?.id || cc.body?.conversationId || cc.body?.id;
    await api(`/messaging/conversations/${cid}/messages`, { method: "POST", body: { body: text } }, tok);
    return cid;
  }
  await seed(mXP, x.token, "Hello Pia — QA seed, please ignore.");
  await seed(mXQ, x.token, "Hello Quinn — QA seed, please ignore.");

  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 900 } });
  await login(page, x);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);

  const DRAFT = "DRAFT-FOR-PIA-do-not-leak-9271";
  // Open Pia's conversation.
  await page.getByRole("button", { name: /Pia QA/ }).first().click();
  await page.waitForTimeout(1500);
  const composerP = page.getByPlaceholder(/Write a message/i).first();
  const composerReachable = await composerP.count();
  check("B2 desktop: composer reachable in Pia's thread", composerReachable > 0, `count=${composerReachable}`);
  await composerP.fill(DRAFT);
  await page.waitForTimeout(400);

  // Switch to Quinn's conversation (back to list if single-pane, then row).
  let quinnRow = page.getByRole("button", { name: /Quinn QA/ });
  if ((await quinnRow.count()) === 0) {
    const back = page.getByRole("button", { name: /Back to|Messages|conversations/i }).first();
    if (await back.count()) { await back.click(); await page.waitForTimeout(1200); }
    quinnRow = page.getByRole("button", { name: /Quinn QA/ });
  }
  await quinnRow.first().click();
  await page.waitForTimeout(1500);
  const composerQval = await page.getByPlaceholder(/Write a message/i).first().inputValue().catch(() => "<none>");
  check("B2 Quinn's composer does NOT contain Pia's draft (no bleed)",
    !composerQval.includes(DRAFT), `quinnComposer=${JSON.stringify(composerQval)}`);
  await page.screenshot({ path: `${OUT}/spotcheck_b2_draft.png` });
  check("B2 no pageerrors on desktop draft flow", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ───────────────────────────────────────────────────────────────────────────
// B21 — Avatar with a broken photo URL renders initials, not literal "Photo of X"
// ───────────────────────────────────────────────────────────────────────────
{
  const m = await makeAccount("b21m", { displayName: "Mara QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const liker = await makeAccount("b21L", { displayName: "Zed QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  cleanup.push(m.token, liker.token);
  await api("/matching/swipe", { method: "POST", body: { candidateId: m.userId, decision: "like" } }, liker.token);

  const { browser, page, ctx, errors } = await launch();
  // Override the activity endpoint to inject a broken photoUrl into the liker's
  // row (page.route wins over the harness ctx.route as the newest handler).
  const apiHost = new URL(API).host;
  await page.route((url) => url.href.includes(apiHost) && url.href.includes("/matching/activity"), async (route) => {
    try {
      const r = await fetch(route.request().url(), {
        headers: { authorization: route.request().headers().authorization || "" },
      });
      const data = await r.json();
      if (Array.isArray(data.incomingLikes)) {
        data.incomingLikes = data.incomingLikes.map((p) => ({ ...p, photoUrl: "https://invalid.example.test/broken-photo.jpg" }));
      }
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {
      await route.fallback();
    }
  });

  await login(page, m);
  await page.getByRole("button", { name: /Likes/ }).click();
  await page.waitForTimeout(3000); // allow the broken <img> to fire onError → monogram
  const likerVisible = await page.getByText(/Zed QA/).count();
  check("B21 liker row renders", likerVisible > 0, `count=${likerVisible}`);
  const brokenImgs = await page.locator('img[alt="Photo of Zed QA"]').count();
  check("B21 broken photo does NOT leave a literal 'Photo of X' img (fell back)", brokenImgs === 0, `imgs=${brokenImgs}`);
  // The deterministic monogram uses the first initial ("Z"); assert it rendered.
  const hasInitial = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span")];
    return spans.some((s) => s.textContent.trim() === "Z");
  });
  check("B21 initials monogram ('Z') rendered as fallback", hasInitial);
  await page.screenshot({ path: `${OUT}/spotcheck_b21_avatar.png` });
  check("B21 no pageerrors on avatar fallback", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
  void ctx;
}

// ───────────────────────────────────────────────────────────────────────────
// T2 — matched-person full-profile modal has a "Block or report {name}" control
// ───────────────────────────────────────────────────────────────────────────
{
  const pair = await makeMatchedPair("t2");
  cleanup.push(pair.a.token, pair.b.token);
  const { browser, page, errors } = await launch();
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);

  // Open the full profile from the thread header (avatar/name → View profile).
  let opened = false;
  const viewProfile = page.getByRole("button", { name: /View (full )?profile|Ben QA'?s profile|About Ben/i }).first();
  if (await viewProfile.count()) { await viewProfile.click(); opened = true; }
  else {
    // Fall back: tapping the header name/avatar opens the modal in most layouts.
    const header = page.getByRole("button", { name: /Ben QA/ }).first();
    if (await header.count()) { await header.click(); opened = true; }
  }
  await page.waitForTimeout(1800);
  const bodyText = await page.locator("body").innerText();
  check("T2 full-profile modal opened", opened && /Ben QA/.test(bodyText));
  const blockCtl = page.getByRole("button", { name: /Block or report Ben QA/i });
  const blockCount = await blockCtl.count();
  check("T2 modal has a 'Block or report {name}' control", blockCount > 0, `count=${blockCount}`);
  await page.screenshot({ path: `${OUT}/spotcheck_t2_modal.png` });
  check("T2 no pageerrors opening profile modal", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ───────────────────────────────────────────────────────────────────────────
// B20 — Messages tab shows the merge banner but NO duplicate "Liked you" block
// ───────────────────────────────────────────────────────────────────────────
{
  const m = await makeAccount("b20m", { displayName: "Nadia QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const liker = await makeAccount("b20L", { displayName: "Owen QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  cleanup.push(m.token, liker.token);
  // Owen likes Nadia — an incoming like that must NOT appear on the Messages tab.
  await api("/matching/swipe", { method: "POST", body: { candidateId: m.userId, decision: "like" } }, liker.token);

  const { browser, page, errors } = await launch();
  await login(page, m);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2500);
  const msgBody = await page.locator("body").innerText();
  // The truthful banner mentions the Likes tab...
  check("B20 Messages banner points to the Likes tab", /Likes tab/i.test(msgBody), msgBody.slice(0, 120).replace(/\n/g, " "));
  // ...and there is NO liker row / "I'm interested in Owen" block contradicting it.
  const likerBlock = await page.getByRole("button", { name: /I'm interested in Owen QA/ }).count();
  const likedYouHeading = /Liked you|People who liked you/i.test(msgBody) && !/in the Likes tab/i.test(
    msgBody.split(/Liked you|People who liked you/i)[1]?.slice(0, 40) || "in the Likes tab");
  check("B20 no duplicate 'Liked you' liker block on Messages tab", likerBlock === 0, `likerBlockBtns=${likerBlock}`);
  await page.screenshot({ path: `${OUT}/spotcheck_b20_messages.png` });
  // Confirm the like IS visible on the Likes tab (the single correct home).
  await page.getByRole("button", { name: /Likes/ }).click();
  await page.waitForTimeout(2200);
  const owenOnLikes = await page.getByText(/Owen QA/).count();
  check("B20 the incoming like lives on the Likes tab (single home)", owenOnLikes > 0, `count=${owenOnLikes}`);
  check("B20 no pageerrors on messages/likes tabs", errors.length === 0, errors.slice(0, 2).join(" | "));
  void likedYouHeading;
  await browser.close();
}

finish();
await cleanupAccounts(cleanup);
