// Deep messaging-surface flow checks at 390px (mobile), dim + light.
// Row ⋯ menu clip (A11Y-3), NoteSheet focus+reach, reaction picker clip,
// message delete menu, header menu reachability.
import { makeMatchedPair, seedConversation, launch, login, check, finish, APP } from "./harness.mjs";

const OUT = "qa-artifacts";

async function run(theme) {
  const pair = await makeMatchedPair("dm" + theme);
  await seedConversation(pair, [
    "Hi there, this is a synthetic QA message one.",
    "And here is a synthetic QA reply two.",
    "Third synthetic line to give the thread some body.",
    // Needed #6 — a scam-signal line FROM THE OTHER PERSON (odd index → pair.b),
    // so the recipient "Does this feel off?" affordance has a bubble to attach to.
    "You should hit me up on whatsapp instead.",
    // Keep an OWN message last (even index → pair.a) so the message-delete-menu
    // check below still lands on a deletable own bubble.
    "Sounds good, talk soon.",
  ]);

  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  // set theme before login by seeding localStorage
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y", JSON.stringify({ theme: th })), theme);
  await login(page, pair.a);

  // Go to Messages tab
  await page.getByRole("button", { name: /messages/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  // ---- A11Y-3: row ⋯ menu clip test ----
  const rowMenuBtn = page.getByRole("button", { name: /more options for/i }).first();
  const hasRowMenu = await rowMenuBtn.count();
  check(`[${theme}] row ⋯ menu trigger present`, hasRowMenu > 0);
  if (hasRowMenu > 0) {
    await rowMenuBtn.click();
    await page.waitForTimeout(400);
    // FE-5: the row ⋯ popover is now an honest disclosure — role="group" (a
    // labelled cluster of plain buttons), not role="menu".
    const menu = page.getByRole("group", { name: /options for/i }).first();
    const clip = await menu.evaluate((el) => {
      // find nearest ancestor <ul> with overflow hidden
      let p = el.parentElement;
      let clipper = null;
      while (p) {
        const cs = getComputedStyle(p);
        if (cs.overflowY === "hidden" || cs.overflow === "hidden") { clipper = p; break; }
        p = p.parentElement;
      }
      const mr = el.getBoundingClientRect();
      const lastItem = el.querySelector('button:last-child');
      const lir = lastItem ? lastItem.getBoundingClientRect() : mr;
      const out = { menuBottom: mr.bottom, lastItemBottom: lir.bottom, vh: window.innerHeight };
      if (clipper) {
        const cr = clipper.getBoundingClientRect();
        out.clipperBottom = cr.bottom;
        out.clippedPx = Math.max(0, mr.bottom - cr.bottom);
      }
      return out;
    });
    check(`[${theme}] row ⋯ menu NOT clipped by list overflow`,
      !clip.clipperBottom || clip.clippedPx <= 2,
      `clippedPx=${clip.clippedPx ?? "n/a"} menuBottom=${Math.round(clip.menuBottom)} clipperBottom=${clip.clipperBottom ? Math.round(clip.clipperBottom) : "n/a"}`);
    check(`[${theme}] row ⋯ menu last item within viewport`,
      clip.lastItemBottom <= clip.vh + 2,
      `lastItemBottom=${Math.round(clip.lastItemBottom)} vh=${clip.vh}`);
    // Is the last menu item actually clickable (topmost at its point)?
    const lastItemHittable = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="group"][aria-label^="Options for"] button');
      if (!items.length) return null;
      const el = items[items.length - 1];
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { covered: !(el === top || el.contains(top)), visible: r.bottom > 0 && r.top < window.innerHeight };
    });
    check(`[${theme}] row ⋯ last item (Unmatch) hittable & visible`,
      lastItemHittable && !lastItemHittable.covered && lastItemHittable.visible,
      JSON.stringify(lastItemHittable));
    await page.screenshot({ path: `${OUT}/dm-rowmenu-${theme}.png` });
    // close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // ---- NoteSheet: reopen menu, click Add private note ----
  if (hasRowMenu > 0) {
    await rowMenuBtn.click();
    await page.waitForTimeout(300);
    const noteItem = page.getByRole("button", { name: /private note/i }).first();
    if (await noteItem.count()) {
      await noteItem.click();
      await page.waitForTimeout(400);
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      check(`[${theme}] NoteSheet focuses textarea on open`, focused === "TEXTAREA", `active=${focused}`);
      const saveBtn = page.getByRole("button", { name: /^save$/i }).first();
      const reach = await saveBtn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        return { bottom: r.bottom, vh: window.innerHeight, covered: !(el === top || el.contains(top)) };
      });
      check(`[${theme}] NoteSheet Save reachable & not covered`,
        reach.bottom <= reach.vh + 2 && !reach.covered,
        `bottom=${Math.round(reach.bottom)} vh=${reach.vh} covered=${reach.covered}`);
      await page.locator("textarea").first().fill("QA synthetic private note.");
      await saveBtn.click();
      await page.waitForTimeout(800);
      check(`[${theme}] NoteSheet closed after save`, (await page.getByRole("dialog").count()) === 0);
    }
  }

  // ---- Open the conversation thread ----
  const row = page.locator('[role="button"], button, li').filter({ hasText: /Ben QA|Ann QA/ }).first();
  // click the conversation row (name link)
  await page.getByText(/synthetic QA reply two|Third synthetic line/i).first().click().catch(async () => {
    await row.click().catch(() => {});
  });
  await page.waitForTimeout(1500);

  const logRows = await page.locator('[role="log"]').count();
  check(`[${theme}] thread opened`, logRows > 0);

  // ---- Conversation Companion: reply-scaffolding tray (F27 extension) ----
  // The composer "Conversation helpers" trigger opens a calm focus-trapped
  // dialog. Assert the NEW reply section + a new reply scaffold render, and that
  // tapping a phrase INSERTS it into the composer WITHOUT sending (no new bubble).
  const helperTrigger = page.getByRole("button", { name: /conversation helpers/i }).first();
  check(`[${theme}] Conversation helpers trigger present`, (await helperTrigger.count()) > 0);
  if (await helperTrigger.count()) {
    await helperTrigger.click({ force: true });
    await page.waitForTimeout(300);
    const tray = page.getByRole("dialog", { name: /conversation helpers/i }).first();
    check(`[${theme}] helper tray opens as a labelled dialog`, (await tray.count()) > 0);
    // New reply-oriented section heading + a new reply intent + scaffold phrase.
    const replySection = page.getByText(/ways you might reply/i).first();
    check(`[${theme}] new "Ways you might reply" section renders`, (await replySection.count()) > 0);
    const scaffoldBtn = page.getByRole("button", { name: /I want to give this a proper reply/i }).first();
    check(`[${theme}] new reply scaffold phrase renders`, (await scaffoldBtn.count()) > 0);
    // Focus trap: heading receives focus on open.
    const trayFocus = await page.evaluate(() => document.activeElement?.id);
    check(`[${theme}] helper tray traps focus (heading focused)`, trayFocus === "helper-tray-heading", `active=${trayFocus}`);
    const logCountBefore = await page.locator('[role="log"] [data-message], [role="log"] li').count();
    if (await scaffoldBtn.count()) {
      await scaffoldBtn.click();
      await page.waitForTimeout(400);
      const trayGone = (await page.getByRole("dialog", { name: /conversation helpers/i }).count()) === 0;
      check(`[${theme}] tapping a scaffold closes the tray`, trayGone);
      const composerVal = await page.getByRole("textbox").first().inputValue();
      check(`[${theme}] scaffold inserts into composer (not sent)`,
        /give this a proper reply/i.test(composerVal), `value="${composerVal.slice(0, 48)}"`);
      const logCountAfter = await page.locator('[role="log"] [data-message], [role="log"] li').count();
      check(`[${theme}] scaffold does NOT auto-send (no new bubble)`, logCountAfter === logCountBefore,
        `before=${logCountBefore} after=${logCountAfter}`);
      // Clear composer so later nudge tests start clean.
      await page.getByRole("textbox").first().fill("");
    }
    await page.screenshot({ path: `${OUT}/dm-helper-tray-${theme}.png` });
  }

  // ---- Reaction picker clip test on an OWN message (right-aligned, opens left) ----
  // hover a bubble to reveal + button; use the last own message
  const addReactBtns = page.getByRole("button", { name: /^add reaction$/i });
  const nReact = await addReactBtns.count();
  check(`[${theme}] reaction + buttons present`, nReact > 0, `count=${nReact}`);
  if (nReact > 0) {
    const btn = addReactBtns.last();
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true });
    await page.waitForTimeout(400);
    // PROD-4 — the picker is an honest role="group" with a descriptive label
    // (was role="toolbar", which promises arrow-key roving focus we don't ship).
    const picker = page.getByRole("group", { name: /react with an emoji/i }).first();
    if (await picker.count()) {
      const semantics = await picker.evaluate((el) => ({
        role: el.getAttribute("role"),
        label: el.getAttribute("aria-label"),
      }));
      check(`[${theme}] PROD-4 reaction picker is role=group with aria-label`,
        semantics.role === "group" && !!semantics.label,
        JSON.stringify(semantics));
      const box = await picker.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
      });
      check(`[${theme}] reaction picker within viewport horizontally`,
        box.left >= -2 && box.right <= box.vw + 2,
        `left=${Math.round(box.left)} right=${Math.round(box.right)} vw=${box.vw}`);
      check(`[${theme}] reaction picker within viewport vertically`,
        box.top >= -2 && box.bottom <= box.vh + 2,
        `top=${Math.round(box.top)} bottom=${Math.round(box.bottom)} vh=${box.vh}`);
      await page.screenshot({ path: `${OUT}/dm-reactpicker-${theme}.png` });
      // pick heart
      const heart = page.getByRole("button", { name: /react with heart/i }).first();
      if (await heart.count()) {
        await heart.click();
        await page.waitForTimeout(700);
        const pill = await page.getByRole("button", { name: /heart, .*reaction/i }).count();
        check(`[${theme}] reaction pill appears after selecting`, pill > 0, `pills=${pill}`);
      }
    } else {
      check(`[${theme}] reaction picker opened`, false, "group not found");
    }
  }

  // ---- Message ⋯ delete menu reachable ----
  const msgOpts = page.getByRole("button", { name: /^message options$/i });
  if (await msgOpts.count()) {
    await msgOpts.last().click({ force: true });
    await page.waitForTimeout(300);
    const del = page.getByRole("menuitem", { name: /delete message/i }).first();
    const hit = await del.count() ? await del.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: r.top >= 0 && r.bottom <= window.innerHeight, covered: !(el === top || el.contains(top)) };
    }) : null;
    check(`[${theme}] message delete menu item reachable`, hit && hit.visible && !hit.covered, JSON.stringify(hit));
    await page.keyboard.press("Escape");
  }

  // ---- Header ⋯ menu reachable (End conversation / Block / Archive) ----
  const headerOpts = page.getByRole("button", { name: /conversation options|options/i });
  // Find the header overflow trigger specifically
  const convMenuTrigger = page.locator('button[aria-haspopup="menu"]').last();
  if (await convMenuTrigger.count()) {
    await convMenuTrigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    const blockItem = page.getByRole("menuitem", { name: /block and report/i }).first();
    if (await blockItem.count()) {
      const hit = await blockItem.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { visible: r.top >= 0 && r.bottom <= window.innerHeight, covered: !(el === top || el.contains(top)) };
      });
      check(`[${theme}] header 'Block and report' reachable`, hit.visible && !hit.covered, JSON.stringify(hit));
    }
    await page.keyboard.press("Escape");
  }

  // ---- Needed #6: gentle message nudges (recipient affordance + sender pre-send) ----
  // Recipient affordance: the seeded thread includes a scam-phrase message from
  // the OTHER person, which must surface a calm, muted "Does this feel off?"
  // affordance with a one-tap Report beneath that received bubble.
  const recipientNudge = page.getByText(/does this feel off\?/i).first();
  const hasRecipientNudge = await recipientNudge.count();
  check(`[${theme}] recipient safety affordance shown on received scam message`, hasRecipientNudge > 0);
  if (hasRecipientNudge > 0) {
    const rep = page.getByRole("button", { name: /^report$/i });
    check(`[${theme}] recipient affordance offers a one-tap Report`, (await rep.count()) > 0);
    await page.screenshot({ path: `${OUT}/dm-recipient-nudge-${theme}.png` });
  }

  // Sender pre-send nudge: typing a scam phrase then pressing Send surfaces a
  // NON-BLOCKING "Send anyway / Keep editing" confirm; the message is NOT sent
  // yet (composer keeps the text). "Send anyway" then sends it immediately.
  const composer = page.getByRole("textbox").first();
  if (await composer.count()) {
    await composer.fill("let's move to venmo and add me on telegram");
    const sendBtn = page.getByRole("button", { name: /^send$/i }).first();
    await sendBtn.click({ force: true });
    await page.waitForTimeout(300);
    const sendAnyway = page.getByRole("button", { name: /send anyway/i }).first();
    const keepEditing = page.getByRole("button", { name: /keep editing/i }).first();
    const nudgeShown = (await sendAnyway.count()) > 0 && (await keepEditing.count()) > 0;
    check(`[${theme}] sender pre-send nudge appears on a scam-phrase send`, nudgeShown);
    const stillInComposer = await composer.inputValue();
    check(`[${theme}] pre-send nudge does not send (composer retains text)`,
      /venmo/i.test(stillInComposer), `value="${stillInComposer.slice(0, 40)}"`);
    if (nudgeShown) {
      await sendAnyway.click();
      await page.waitForTimeout(900);
      const nowSent = await page.getByText(/add me on telegram/i).count();
      check(`[${theme}] 'Send anyway' sends the message (non-blocking)`, nowSent > 0, `matches=${nowSent}`);
      const nudgeGone = await page.getByRole("button", { name: /send anyway/i }).count();
      check(`[${theme}] pre-send nudge dismisses after sending`, nudgeGone === 0);
    }
    await page.screenshot({ path: `${OUT}/dm-sender-nudge-${theme}.png` });
  }

  // ---- Needed #10: "Report this message" on the OTHER person's bubble pins it ----
  // The seeded thread alternates senders (own, other, own), so the middle bubble
  // ("…reply two.") is from the other person and must expose "Report this
  // message", which opens the block/report flow with that message pinned. Own
  // bubbles must NOT offer it (they get "Delete message"). Run this LAST — it
  // navigates to the block/report screen.
  const pinOpts = page.getByRole("button", { name: /^message options$/i });
  const pinOptCount = await pinOpts.count();
  let reportOpened = false;
  for (let i = 0; i < pinOptCount; i++) {
    await pinOpts.nth(i).click({ force: true });
    await page.waitForTimeout(200);
    const reportItem = page.getByRole("menuitem", { name: /report this message/i });
    if (await reportItem.count()) {
      await reportItem.first().click();
      await page.waitForTimeout(600);
      reportOpened = true;
      break;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
  check(`[${theme}] 'Report this message' opens the pinned report flow`, reportOpened);
  if (reportOpened) {
    const body = await page.evaluate(() => document.body.innerText);
    const bannerOk = /Reporting this message/i.test(body);
    const pinnedOk = /synthetic QA reply two/i.test(body);
    check(`[${theme}] report UI confirms the pinned message text`,
      bannerOk && pinnedOk,
      `banner=${bannerOk} pinnedText=${pinnedOk}`);
  }

  check(`[${theme}] no pageerrors across deep messaging`, errors.length === 0, errors.join(" | "));
  await browser.close();
}

await run("dim");
await run("light");
finish();
