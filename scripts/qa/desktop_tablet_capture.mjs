// Desktop/tablet coverage capture (read-only). Extends design_review_capture.
// Widths: 768 (tablet), 1024 (desktop edge), 1280 (desktop), 1440 (wide).
// node scripts/qa/desktop_tablet_capture.mjs
import { makeMatchedPair, makeAccount, seedConversation, launch, login, api } from "./harness.mjs";
import fs from "node:fs";

const OUT = "qa-artifacts/dt";
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
  await page.waitForTimeout(1800);
}

async function shoot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log("shot", p);
}
async function shootFull(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log("shotFull", p);
}

async function nav(page, label) {
  await page.locator('nav[aria-label="Primary"] button').filter({ hasText: label }).first().click();
  await page.waitForTimeout(1200);
}

async function openSettings(page, isDesktop) {
  if (isDesktop) {
    await page.getByRole("button", { name: "Accessibility settings" }).click();
  } else {
    await nav(page, "Profile");
    await page.getByText("Settings", { exact: true }).first().click();
  }
  await page.waitForTimeout(1200);
}

async function tour(page, tag, theme, isDesktop) {
  const k = `${tag}_${theme}`;
  await setTheme(page, theme);
  await shoot(page, `${k}_discover`);
  await nav(page, "Likes");
  await shoot(page, `${k}_likes`);
  await shootFull(page, `${k}_likes_full`);
  await nav(page, "Messages");
  await shoot(page, `${k}_messages_list`);
  const row = page.getByText("Ben QA").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1500);
    await shoot(page, `${k}_thread`);
  }
  await nav(page, "Profile");
  await shoot(page, `${k}_profile`);
  await shootFull(page, `${k}_profile_full`);
  await openSettings(page, isDesktop);
  await shoot(page, `${k}_settings_top`);
  await shootFull(page, `${k}_settings_full`);
  await nav(page, "Discover");
}

async function spot(page, tag, theme, isDesktop) {
  const k = `${tag}_${theme}`;
  await setTheme(page, theme);
  await shoot(page, `${k}_discover`);
  await nav(page, "Messages");
  const row = page.getByText("Ben QA").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1400);
    await shoot(page, `${k}_thread`);
  }
  await nav(page, "Discover");
}

const main = async () => {
  console.log("seeding…");
  const pair = await makeMatchedPair("dtx");
  await seedConversation(pair, MSGS);
  const c = await makeAccount("dtxc", { displayName: "Cal QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: pair.a.userId, decision: "like" } }, c.token);
  // a couple more likers to test the liked-you card row / truncation
  const d = await makeAccount("dtxd", { displayName: "Dominic Alexander", gender: "man", pronouns: "he/him", seeking: "woman", bio: "I enjoy long quiet hikes and board games on rainy afternoons." });
  await api("/matching/swipe", { method: "POST", body: { candidateId: pair.a.userId, decision: "like" } }, d.token);
  console.log("seeded. match:", pair.matchId);

  for (const vp of [
    { width: 768, height: 1024, tag: "t768", desktop: false },
    { width: 1024, height: 800, tag: "d1024", desktop: true },
    { width: 1280, height: 800, tag: "d1280", desktop: true },
    { width: 1440, height: 900, tag: "d1440", desktop: true },
  ]) {
    const { browser, page, errors } = await launch({ viewport: { width: vp.width, height: vp.height } });
    await login(page, pair.a);
    for (const theme of ["dim", "light"]) {
      await tour(page, vp.tag, theme, vp.desktop);
    }
    for (const theme of ["navy", "pride", "trans"]) {
      await spot(page, vp.tag, theme, vp.desktop);
    }
    if (errors.length) console.log(`PAGEERRORS(${vp.tag}):`, errors.join(" | "));
    else console.log(`no pageerrors (${vp.tag})`);
    await browser.close();
  }
  console.log("done");
};

main().catch((e) => { console.error(e); process.exit(1); });
