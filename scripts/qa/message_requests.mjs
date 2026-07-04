// Real E2E for the message-requests / intro flow (audit/MESSAGE_REQUESTS.md).
// Runs against the LIVE backend. Sockets (post-accept real-time delivery) are the
// ONLY piece not exercised here — they're stubbed 503 in the sandbox.
//
// Sandbox constraint (documented): Discover only surfaces members with a
// MODERATOR-APPROVED photo (server/src/matching/candidates.js: `photo_url != ''`,
// mirrored only on admin approval). A freshly-seeded QA account can never be that
// candidate, so we CANNOT route an intro to our own seeded B through the Discover
// deck. We therefore split the test into two real-backend halves:
//   (1) COMPOSE SHEET UI — driven against a genuine Discover candidate: open the
//       sheet, send, and assert the SINGLE calm outcome-agnostic confirmation.
//   (2) RECIPIENT + SENT flow — A→B and C→B intros seeded via the IDENTICAL
//       backend path the sheet calls (POST /messaging/requests), then B's
//       Requests UI (quiet count, accept→inbox) and C's Sent UI (decline stays
//       invisible to the sender) are driven for real.
import { mkdirSync } from "node:fs";
import { makeAccount, api, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const rand = Math.random().toString(36).slice(2, 7);
const NAME_A = `Ada Intro ${rand}`;
const NAME_C = `Cleo Intro ${rand}`;
const INTRO_A = `Hi from Ada ${rand} — I saw we both love quiet hikes and would enjoy comparing trails.`;
const INTRO_C = `Hello from Cleo ${rand}, just saying a calm hello.`;
const INTRO_UI = `Friendly QA hello ${rand} — please disregard, just testing the compose sheet.`;

// A also acts as the compose-sheet driver (open to everyone so a candidate with
// an approved photo surfaces). B (recipient) and C (second sender) are seeded.
const a = await makeAccount("mreqa", { displayName: NAME_A, gender: "nonbinary", seeking: "man,woman,nonbinary", searchRadiusMiles: 0 });
const b = await makeAccount("mreqb", { displayName: `Ben Recip ${rand}`, gender: "man", pronouns: "he/him", seeking: "woman" });
const c = await makeAccount("mreqc", { displayName: NAME_C, gender: "woman", pronouns: "she/her", seeking: "man" });

const { browser, page, errors } = await launch();

// ── 1. Compose sheet UI + calm generic confirmation (real backend) ───────────
await login(page, a);
let cardReady = false;
for (let i = 0; i < 6 && !cardReady; i++) {
  await page.waitForTimeout(1500);
  cardReady = (await page.getByRole("button", { name: /Send an intro/ }).count()) > 0;
}
check("Discover surfaces a candidate with the 'Send an intro' action", cardReady);

if (cardReady) {
  await page.getByRole("button", { name: /Send an intro/ }).first().click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  check("Compose sheet opened", (await dialog.count()) > 0);
  await dialog.locator("textarea").first().fill(INTRO_UI);
  await dialog.getByRole("button", { name: /^Send intro$/ }).click();
  await page.waitForTimeout(1800);
  // SAFETY: exactly one calm, outcome-agnostic confirmation — never "delivered".
  check("Compose sheet shows the calm generic send confirmation",
    (await page.getByText(/Your intro is on its way/i).count()) > 0);
  const afterConfirm = (await page.locator('[role="dialog"]').innerText().catch(() => "")) || "";
  check("Confirmation never reveals delivered/blocked/declined/seen state",
    !/delivered|blocked|declined|\bread\b|\bseen\b/i.test(afterConfirm));
  await page.screenshot({ path: `${OUT}/message_requests_compose.png` });
  const done = page.getByRole("button", { name: /^Done$/ });
  if ((await done.count()) > 0) await done.click();
}

// ── 2. Seed A→B via the identical backend path the sheet calls ───────────────
const aSend = await api("/messaging/requests", { method: "POST", body: { recipientId: b.userId, intro: INTRO_A } }, a.token);
check("A→B intro accepted by backend (generic 201 {ok:true})", aSend.status === 201 && aSend.body?.ok === true, `status=${aSend.status}`);

// ── 3. B sees the quiet count + A's intro in Requests ────────────────────────
await login(page, b);
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2000);

const requestsEntry = page.getByRole("button", { name: /Requests/ });
check("Requests entry present in Messages", (await requestsEntry.count()) > 0);
const entryLabel = await requestsEntry.first().getAttribute("aria-label").catch(() => "");
check("Quiet count shows 1 waiting (plain number, no badge/urgency)", /1 waiting/.test(entryLabel || ""), `aria-label=${entryLabel}`);

await requestsEntry.first().click();
await page.waitForTimeout(1200);
const reqBody = await page.locator('[data-testid="message-requests-scroll"]').innerText().catch(() => "");
check("B's Requests shows A's name", reqBody.includes(NAME_A));
check("B's Requests shows A's intro text", reqBody.includes(INTRO_A));
await page.screenshot({ path: `${OUT}/message_requests_inbound.png` });

// ── 4. B accepts → a conversation with A appears in B's inbox ────────────────
await page.getByRole("button", { name: /^Accept$/ }).first().click();
await page.waitForTimeout(3000);
const afterAccept = await page.locator("body").innerText();
check("Accept opens the new conversation (A's name / seeded intro visible)",
  afterAccept.includes(NAME_A) || afterAccept.includes(INTRO_A));

await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2500);
check("Accepted intro is now a normal conversation in B's inbox",
  (await page.getByRole("button", { name: new RegExp(NAME_A) }).count()) > 0);

// ── 5. C sends a second intro to B; B declines it ────────────────────────────
const cSend = await api("/messaging/requests", { method: "POST", body: { recipientId: b.userId, intro: INTRO_C } }, c.token);
check("C→B intro accepted by backend (generic 201 {ok:true})", cSend.status === 201 && cSend.body?.ok === true, `status=${cSend.status}`);

await login(page, b); // fresh load so the new inbound request is fetched
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /Requests/ }).first().click();
await page.waitForTimeout(1200);
let reqBody2 = await page.locator('[data-testid="message-requests-scroll"]').innerText().catch(() => "");
check("C's intro is visible before B declines", reqBody2.includes(NAME_C) && reqBody2.includes(INTRO_C));

await page.getByRole("button", { name: /^Decline$/ }).first().click();
await page.waitForTimeout(1500);
reqBody2 = await page.locator('[data-testid="message-requests-scroll"]').innerText().catch(() => "");
check("C's intro disappears from B's Requests after Decline", !reqBody2.includes(INTRO_C));

// ── 6. C's Sent list never reveals the decline (anti-retaliation) ────────────
await login(page, c);
await page.getByRole("button", { name: /Messages/ }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /Requests/ }).first().click();
await page.waitForTimeout(1500);
const cReqBody = await page.locator('[data-testid="message-requests-scroll"]').innerText().catch(() => "");
check("C's Sent list does NOT show the declined intro", !cReqBody.includes(INTRO_C));
check("C's Sent shows the calm no-declined-affordance state",
  /haven't sent any intros/i.test(cReqBody) || !/declined|rejected|\bseen\b/i.test(cReqBody));
await page.screenshot({ path: `${OUT}/message_requests_sent.png` });

// ── 7. No console pageerrors across the whole run ────────────────────────────
check("No console pageerrors across the intro flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([a.token, b.token, c.token]);
