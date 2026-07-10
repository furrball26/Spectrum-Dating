// Deep functional pass on the NEW features shipped at 92d1cd8 + the safety flows
// (registration confirm-email, hide-inappropriate messages, block, report).
// Imports the shared harness (route-forward-through-Node); vite preview must be
// on :4173 serving a fresh dist. Run: node scripts/qa/e2e_new_features.mjs
import { mkdirSync } from "node:fs";
import {
  makeMatchedPair, makeAccount, seedConversation, api,
  launch, login, check, finish, cleanupAccounts, OUT, APP,
} from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const VP = { width: 390, height: 844 };
const cleanup = [];

// ── 1. Registration confirm-email + confirm-password validation (unauth UI) ───
{
  const rid = Math.random().toString(36).slice(2, 10);
  const email = `qa+reguiy${rid}@spectrum-test.dev`;
  const { browser, page, errors } = await launch({ viewport: VP });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // Landing → register
  await page.getByRole("button", { name: /Create your profile|Make your profile/ }).first().click();
  await page.waitForTimeout(1000);
  const hasConfirmEmail = await page.locator("#auth-confirm-email").count();
  check("1.1 Register form shows the Confirm email field", hasConfirmEmail > 0, `count=${hasConfirmEmail}`);

  // Mismatched email → must block + inline error + focus the confirm-email field
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-confirm-email").fill("different+" + email);
  await page.locator("#auth-password").fill("TestPass12345!");
  await page.locator("#auth-confirm-password").fill("TestPass12345!");
  await page.getByRole("button", { name: /^Create account$/ }).click();
  await page.waitForTimeout(600);
  const emailErr = await page.locator("#auth-confirm-email-error").innerText().catch(() => "");
  const stillRegister = await page.locator("#auth-confirm-email").count();
  const focusedId1 = await page.evaluate(() => document.activeElement?.id || "");
  check("1.2 Mismatched emails BLOCK submit (stays on register)", stillRegister > 0);
  check("1.3 Inline 'Emails don't match.' error shown", /don.?t match/i.test(emailErr), emailErr);
  check("1.4 Focus moves to the confirm-email field", focusedId1 === "auth-confirm-email", `focus=${focusedId1}`);
  await page.screenshot({ path: `${OUT}/reg_email_mismatch.png` });

  // Fix email, break password confirm → must block + focus confirm-password
  await page.locator("#auth-confirm-email").fill(email);
  await page.locator("#auth-confirm-password").fill("WrongPass99!");
  await page.getByRole("button", { name: /^Create account$/ }).click();
  await page.waitForTimeout(600);
  const pwErr = await page.locator("#auth-confirm-password-error").innerText().catch(() => "");
  const focusedId2 = await page.evaluate(() => document.activeElement?.id || "");
  check("1.5 Mismatched passwords BLOCK submit with inline error", /don.?t match/i.test(pwErr), pwErr);
  check("1.6 Focus moves to the confirm-password field", focusedId2 === "auth-confirm-password", `focus=${focusedId2}`);

  // Fix everything → must PROCEED (check-email handoff OR app shell), no error
  await page.locator("#auth-confirm-password").fill("TestPass12345!");
  await page.getByRole("button", { name: /^Create account$/ }).click();
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  const proceeded = /Check your (inbox|email)|Continue to app|Discover/i.test(body) &&
    !/Emails don.?t match|Passwords don.?t match/i.test(body);
  check("1.7 Matching email+password PROCEEDS past the form", proceeded, body.slice(0, 70).replace(/\n/g, " "));
  const tok = await page.evaluate(() => localStorage.getItem("spectrum_token"));
  if (tok) cleanup.push(tok);
  check("1.8 no pageerrors across registration", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── 2. Hide-inappropriate message: recipient collapse+reveal+report, sender heads-up ─
{
  const pair = await makeMatchedPair("flag");
  cleanup.push(pair.a.token, pair.b.token);
  const convId = await seedConversation(pair, [
    "Hi Ben, nice to meet you.",
    "Likewise! How's your week going?",
  ]);
  // B sends a message the classifier flags (hard profanity), with a unique marker
  // so we can assert the BODY is hidden pre-reveal and present post-reveal.
  const MARKER = "zqmarker" + Math.random().toString(36).slice(2, 7);
  const flaggedBody = `you are a fucking creep ${MARKER}`;
  const send = await api(
    `/messaging/conversations/${convId}/messages`,
    { method: "POST", body: { body: flaggedBody } },
    pair.b.token
  );
  check("2.0 backend returns flaggedInappropriate:true on the profane send",
    send.body?.flaggedInappropriate === true, JSON.stringify(send.body).slice(0, 80));

  // Recipient (Ann) opens the thread → the flagged message must render COLLAPSED
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);
  const preBody = await page.locator("body").innerText();
  check("2.1 flagged message renders COLLAPSED (calm placeholder shown)",
    /may contain strong or explicit language/i.test(preBody));
  check("2.2 raw profane body is HIDDEN before reveal (marker absent)",
    !preBody.includes(MARKER), `markerPresent=${preBody.includes(MARKER)}`);
  const showBtn = page.getByRole("button", { name: /^Show message$/ });
  check("2.3 'Show message' reveal affordance present", (await showBtn.count()) > 0);
  await page.screenshot({ path: `${OUT}/flag_collapsed.png` });

  await showBtn.first().click();
  await page.waitForTimeout(800);
  const postBody = await page.locator("body").innerText();
  check("2.4 revealing shows the real body (marker now visible)",
    postBody.includes(MARKER), `markerPresent=${postBody.includes(MARKER)}`);
  check("2.5 inline 'Report this message' affordance appears after reveal",
    (await page.getByRole("button", { name: /Report this message/ }).count()) > 0);
  await page.screenshot({ path: `${OUT}/flag_revealed.png` });
  check("2.6 no pageerrors on recipient collapse/reveal", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();

  // Sender (Ben) opens the thread → sees his own body normally + a gentle heads-up
  const s = await launch({ viewport: VP });
  await login(s.page, pair.b);
  await s.page.getByRole("button", { name: /Messages/ }).click();
  await s.page.waitForTimeout(2000);
  await s.page.getByRole("button", { name: /Ann QA/ }).first().click();
  await s.page.waitForTimeout(2500);
  const senderBody = await s.page.locator("body").innerText();
  check("2.7 SENDER sees their own flagged body normally (not collapsed)",
    senderBody.includes(MARKER) && !/may contain strong or explicit language/i.test(senderBody),
    `marker=${senderBody.includes(MARKER)}`);
  check("2.8 SENDER gets a gentle heads-up on the flagged message",
    /Heads-up: this message may read as strong or explicit/i.test(senderBody));
  await s.page.screenshot({ path: `${OUT}/flag_sender_headsup.png` });
  check("2.9 no pageerrors on sender heads-up", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
  await s.browser.close();
}

// ── 3. Report-only flow completes (no block), reasons work ────────────────────
{
  const pair = await makeMatchedPair("rep");
  cleanup.push(pair.a.token, pair.b.token);
  await seedConversation(pair, ["Seed one — please ignore.", "Seed two — please ignore."]);
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Conversation options/ }).click();
  await page.getByRole("menuitem", { name: /Block and report/ }).click();
  await page.waitForTimeout(1500);
  // This flow opens with Block ON, Report OFF (no pinned message). Turn Report ON,
  // then Block OFF, so this is a report-only submission.
  await page.getByText("Report to our team", { exact: false }).first().click();
  await page.waitForTimeout(250);
  await page.getByText("Block them", { exact: false }).first().click();
  await page.waitForTimeout(300);
  // Pick a reason (radios must work) and submit.
  await page.getByText("Harassment or abuse", { exact: false }).first().click();
  await page.waitForTimeout(300);
  const sendReport = page.getByRole("button", { name: /^Send report$/ });
  check("3.1 report-only submit enabled after choosing a reason", (await sendReport.count()) > 0);
  await sendReport.first().click();
  await page.waitForTimeout(2500);
  const conf = await page.locator("body").innerText();
  check("3.2 report-only confirmation is honest (flagged, NOT blocked)",
    /flagged .* for our team/i.test(conf) && /haven.?t blocked them/i.test(conf),
    conf.slice(0, 90).replace(/\n/g, " "));
  await page.screenshot({ path: `${OUT}/report_only_confirm.png` });
  check("3.3 no pageerrors across report flow", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ── 4. Block severs the thread for BOTH parties, no leak of who blocked whom ───
{
  const pair = await makeMatchedPair("blk");
  cleanup.push(pair.a.token, pair.b.token);
  await seedConversation(pair, ["Block seed one.", "Block seed two."]);

  // A blocks (and reports) B via the in-thread flow.
  const { browser, page, errors } = await launch({ viewport: VP });
  await login(page, pair.a);
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Conversation options/ }).click();
  await page.getByRole("menuitem", { name: /Block and report/ }).click();
  await page.waitForTimeout(1500);
  await page.getByText("Spam", { exact: true }).first().click();
  await page.waitForTimeout(300);
  const blockBtn = page.getByRole("button", { name: /Block and report|^Block$/ });
  await blockBtn.first().click();
  await page.waitForTimeout(2500);
  const conf = await page.locator("body").innerText();
  check("4.1 block confirmation shown to blocker", /blocked .*Ben QA/i.test(conf), conf.slice(0, 90).replace(/\n/g, " "));
  await page.screenshot({ path: `${OUT}/block_confirm.png` });
  // Back to the conversation list — the blocked thread must be gone for A.
  await page.getByRole("button", { name: /Messages/ }).click();
  await page.waitForTimeout(2200);
  const aList = await page.locator("body").innerText();
  check("4.2 blocked thread removed from blocker's list (no Ben QA row)",
    (await page.getByRole("button", { name: /^Ben QA/ }).count()) === 0 && !/Something went wrong/i.test(aList));
  check("4.3 no pageerrors on blocker side", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();

  // B logs in fresh — thread must be severed and MUST NOT reveal A blocked them.
  const b = await launch({ viewport: VP });
  await login(b.page, pair.b);
  await b.page.getByRole("button", { name: /Messages/ }).click();
  await b.page.waitForTimeout(2200);
  const bList = await b.page.locator("body").innerText();
  check("4.4 blocked party's list does not error",
    !/Something went wrong/i.test(bList));
  check("4.5 NO leak of who blocked whom on blocked party's side",
    !/blocked you|has blocked|Ann QA blocked|you were blocked/i.test(bList),
    bList.slice(0, 90).replace(/\n/g, " "));
  // If the row still shows, opening it must be read-only (no active composer that
  // can reach the other party). Assert either the row is gone OR it's ended.
  const benRowGone = (await b.page.getByRole("button", { name: /^Ann QA/ }).count()) === 0;
  if (!benRowGone) {
    await b.page.getByRole("button", { name: /Ann QA/ }).first().click();
    await b.page.waitForTimeout(2500);
    const thread = await b.page.locator("body").innerText();
    check("4.6 blocked party's thread is read-only / ended (no working composer)",
      /ended|no longer available|unavailable/i.test(thread) ||
      (await b.page.getByPlaceholder(/Write a message/i).count()) === 0,
      thread.slice(0, 80).replace(/\n/g, " "));
  } else {
    check("4.6 blocked party's thread severed (row gone)", true, "row removed");
  }
  await b.page.screenshot({ path: `${OUT}/block_blocked_party.png` });
  check("4.7 no pageerrors on blocked party side", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
  await b.browser.close();
}

finish();
await cleanupAccounts(cleanup);
