// Crisis-line auto-routing — end-to-end flow check (390px mobile, dim + light).
//
// When the CURRENT USER'S OWN message expresses self-harm / suicidal-crisis
// language, a calm, private support note must appear to THEM with the existing
// crisis resources (988 call/text, Crisis Text Line) as tappable links. It must:
//   • never block or alter the message (the message is still sent),
//   • be dismissible,
//   • surface once per conversation per session (no re-nag after dismissal),
//   • never raise a console pageerror.
//
// Runs against the LOCAL build via the shared harness (route-intercepted API).
import { makeMatchedPair, seedConversation, launch, login, check, finish, APP } from "./harness.mjs";

const OUT = "qa-artifacts";

async function run(theme) {
  const pair = await makeMatchedPair("crisis" + theme);
  await seedConversation(pair, [
    "Hi there, this is a synthetic QA message one.",
    "And here is a synthetic QA reply two.",
    "Third synthetic line to give the thread some body.",
  ]);

  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y", JSON.stringify({ theme: th })), theme);
  await login(page, pair.a);

  await page.getByRole("button", { name: /messages/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  // Open the thread (mirror deep_messaging: click the message text, fall back to
  // the conversation row).
  const row = page.locator('[role="button"], button, li').filter({ hasText: /Ben QA|Ann QA/ }).first();
  await page.getByText(/synthetic QA reply two|Third synthetic line/i).first().click().catch(async () => {
    await row.click().catch(() => {});
  });
  await page.waitForTimeout(1500);
  check(`[${theme}] thread opened`, (await page.locator('[role="log"]').count()) > 0);

  // Compose and send a HIGH-CONFIDENCE crisis message as the current user.
  const crisisText = "honestly i don't want to be here anymore";
  const composer = page.getByRole("textbox").first();
  await composer.fill(crisisText);
  await page.getByRole("button", { name: /^send$/i }).first().click({ force: true });
  await page.waitForTimeout(1000);

  // 1) The message is NOT blocked — it appears in the thread.
  const sentCount = await page.getByText(/don't want to be here anymore/i).count();
  check(`[${theme}] crisis message still sent (never blocked)`, sentCount > 0, `matches=${sentCount}`);

  // 2) The private support note surfaces to the sender.
  const note = page.getByRole("note", { name: /kind note, just for you/i }).first();
  const noteShown = (await note.count()) > 0;
  check(`[${theme}] support note surfaces on own crisis message`, noteShown);

  if (noteShown) {
    const body = await page.evaluate(() => document.body.innerText);
    check(`[${theme}] note is warm, not clinical ("You're not alone")`, /you're not alone/i.test(body));
    check(`[${theme}] note is not a "we detected" surveillance alert`, !/we detected|flagged|monitored/i.test(body));
    // 3) The existing crisis resources appear as tappable links.
    const tel988 = await page.locator('a[href="tel:988"]').count();
    const smsCTL = await page.locator('a[href^="sms:741741"]').count();
    check(`[${theme}] 988 call/text link present`, tel988 > 0, `tel:988=${tel988}`);
    check(`[${theme}] Crisis Text Line (741741) link present`, smsCTL > 0, `sms=${smsCTL}`);
    check(`[${theme}] note states it's private to the user`, /only visible to you/i.test(body));
    await page.screenshot({ path: `${OUT}/crisis-note-${theme}.png` });

    // 4) Dismissible.
    await note.getByRole("button", { name: /dismiss this note/i }).click();
    await page.waitForTimeout(300);
    check(`[${theme}] note is dismissible`,
      (await page.getByRole("note", { name: /kind note, just for you/i }).count()) === 0);

    // 5) Once per session — a second crisis message must NOT re-nag.
    await composer.fill("i feel suicidal today");
    await page.getByRole("button", { name: /^send$/i }).first().click({ force: true });
    await page.waitForTimeout(900);
    check(`[${theme}] does not re-nag within the session (once per conversation)`,
      (await page.getByRole("note", { name: /kind note, just for you/i }).count()) === 0);
  }

  check(`[${theme}] no pageerrors across crisis flow`, errors.length === 0, errors.join(" | "));
  await browser.close();
}

await run("dim");
await run("light");
finish();
