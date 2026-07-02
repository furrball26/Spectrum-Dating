// Design-review capture driver (read-only; screenshots into qa-artifacts/).
// Run from repo root: node scripts/qa/design_review_capture.mjs
import { makeMatchedPair, makeAccount, seedConversation, launch, login, api } from "./harness.mjs";
import fs from "node:fs";

const OUT = "qa-artifacts";
fs.mkdirSync(OUT, { recursive: true });

const MSGS = [
  "Hi Ben! I saw you like hiking too. Any favorite trails?",
  "Hi Ann! Yes — I really like the Piestewa Peak loop early in the morning before it gets busy.",
  "Early mornings are perfect. Crowds can be a lot for me, so quiet trails are my favorite.",
  "Same here. I usually bring noise-cancelling headphones just in case.",
  "That is a good idea. Do you prefer texting for a while before meeting up?",
  "Yes, I like taking time to get comfortable first. No rush at all.",
  "That works well for me too. Looking forward to chatting more.",
];

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem("spectrum_a11y") || "{}") || {}; } catch { /* noop */ }
    localStorage.setItem("spectrum_a11y", JSON.stringify({ ...raw, theme: th }));
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
}

async function shoot(page, name) {
  const p = `${OUT}/rev_${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log("shot", p);
}

async function nav(page, label) {
  await page
    .locator('nav[aria-label="Primary"] button')
    .filter({ hasText: label })
    .first()
    .click();
  await page.waitForTimeout(1400);
}

async function openSettings(page, isMobile) {
  if (isMobile) {
    await nav(page, "Profile");
    await page.getByText("Settings", { exact: true }).first().click();
  } else {
    await page.getByRole("button", { name: "Accessibility settings" }).click();
  }
  await page.waitForTimeout(1400);
}

async function tour(page, tag, theme, isMobile) {
  const k = `${tag}_${theme}`;
  await setTheme(page, theme);
  await shoot(page, `${k}_discover`);
  await nav(page, "Likes");
  await shoot(page, `${k}_likes`);
  await nav(page, "Messages");
  await shoot(page, `${k}_messages`);
  const row = page.getByText("Ben QA").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1600);
    await shoot(page, `${k}_thread`);
  }
  await nav(page, "Profile");
  await shoot(page, `${k}_profile`);
  await openSettings(page, isMobile);
  await shoot(page, `${k}_settings_top`);
  // scroll to the theme picker
  const picker = page.getByText("Theme", { exact: false }).first();
  try { await picker.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); } catch { /* noop */ }
  await shoot(page, `${k}_settings_theme`);
  // back to discover for next theme pass
  await nav(page, "Discover");
}

async function spot(page, tag, theme) {
  const k = `${tag}_${theme}`;
  await setTheme(page, theme);
  await shoot(page, `${k}_discover`);
  await nav(page, "Messages");
  const row = page.getByText("Ben QA").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1500);
    await shoot(page, `${k}_thread`);
  }
  await nav(page, "Discover");
}

const main = async () => {
  console.log("seeding…");
  const pair = await makeMatchedPair("dux");
  await seedConversation(pair, MSGS);
  // Third account likes Ann so the Likes tab shows a "liked you" section.
  const c = await makeAccount("duxc", { displayName: "Cal QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: pair.a.userId, decision: "like" } }, c.token);
  console.log("seeded. match:", pair.matchId);

  for (const vp of [
    { width: 390, height: 844, tag: "m", mobile: true },
    { width: 1280, height: 800, tag: "d", mobile: false },
  ]) {
    const { browser, page, errors } = await launch({ viewport: { width: vp.width, height: vp.height } });
    await login(page, pair.a);
    for (const theme of ["dim", "light"]) {
      await tour(page, vp.tag, theme, vp.mobile);
    }
    for (const theme of ["navy", "trans"]) {
      await spot(page, vp.tag, theme);
    }
    if (errors.length) console.log(`PAGEERRORS(${vp.tag}):`, errors.join(" | "));
    else console.log(`no pageerrors (${vp.tag})`);
    await browser.close();
  }
  console.log("done");
};

main().catch((e) => { console.error(e); process.exit(1); });
