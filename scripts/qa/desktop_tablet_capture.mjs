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

// ─── Assertions (DT-1 / DT-2 / DT-3) — real gates, throw on failure ───────────
const FAILURES = [];
function check(cond, msg) {
  if (cond) { console.log("  PASS", msg); }
  else { console.log("  FAIL", msg); FAILURES.push(msg); }
}

// DT-1: in the 340px desktop Messages rail the liked-you names must render
// whole (compact layout), not ellipsized.
// DT-3: the Likes screen must not double-paint its own bgGradient inside the
// desktop surface panel — its page background is transparent (inherits panel).
async function assertDesktop(page, tag, theme) {
  console.log(`ASSERT desktop ${tag}_${theme}`);
  // DT-1 — Messages rail liked-you names
  await nav(page, "Messages");
  const dt1 = await page.evaluate(() => {
    const ul = document.querySelector('ul[aria-label="People who liked you"]');
    if (!ul) return { ok: false, reason: "no liked-you list in rail" };
    const rows = [...ul.querySelectorAll("li")].map((li) => {
      const el = li.querySelector('div[style*="ellipsis"]');
      if (!el) return null;
      return { text: el.textContent.trim(), truncated: el.scrollWidth > el.clientWidth + 1 };
    }).filter(Boolean);
    return { ok: true, rows };
  });
  if (!dt1.ok) { check(false, `DT-1 ${tag}_${theme}: ${dt1.reason}`); }
  else {
    check(dt1.rows.length > 0, `DT-1 ${tag}_${theme}: liked-you rows present in rail (${dt1.rows.map(r => r.text).join(", ")})`);
    const truncated = dt1.rows.filter((r) => r.truncated).map((r) => r.text);
    check(truncated.length === 0, `DT-1 ${tag}_${theme}: no truncated names (offenders: ${truncated.join(", ") || "none"})`);
  }

  // DT-3 — Likes screen page background transparent inside the panel
  await nav(page, "Likes");
  const dt3 = await page.evaluate(() => {
    const h1 = [...document.querySelectorAll("h1")].find((h) => h.textContent.trim() === "Likes");
    if (!h1) return { ok: false, reason: "no Likes h1" };
    const pageDiv = h1.parentElement.parentElement; // page > maxWidth wrapper > h1
    return { ok: true, bg: getComputedStyle(pageDiv).backgroundColor };
  });
  if (!dt3.ok) { check(false, `DT-3 ${tag}_${theme}: ${dt3.reason}`); }
  else check(dt3.bg === "rgba(0, 0, 0, 0)" || dt3.bg === "transparent", `DT-3 ${tag}_${theme}: Likes page bg transparent (got ${dt3.bg})`);
  await nav(page, "Discover");
}

// DT-2: pin the last conversation-row ⋯ trigger to the bottom of the rail, open
// the menu, and confirm all items — including Block or report + Unmatch — stay
// on-screen (upward flip), never clipped by the rail's overflow.
async function assertRowMenuFlip(page, tag) {
  console.log(`ASSERT row-menu flip ${tag}`);
  await nav(page, "Messages");
  await page.waitForTimeout(400);
  const pinned = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('button[aria-label^="More options for"]')];
    if (!triggers.length) return false;
    triggers[triggers.length - 1].scrollIntoView({ block: "end" });
    return true;
  });
  if (!pinned) { check(false, `DT-2 ${tag}: no row ⋯ trigger found`); return; }
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('button[aria-label^="More options for"]')];
    triggers[triggers.length - 1].click();
  });
  await page.waitForTimeout(250);
  const dt2 = await page.evaluate(() => {
    const group = document.querySelector('[aria-label^="Options for"]');
    if (!group) return { ok: false, reason: "menu did not open" };
    const ih = window.innerHeight;
    const items = [...group.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), top: r.top, bottom: r.bottom };
    });
    const clipped = items.filter((i) => i.bottom > ih + 1 || i.top < -1).map((i) => i.text);
    const g = group.getBoundingClientRect();
    return { ok: true, ih, items: items.map((i) => i.text), clipped, groupTop: g.top, groupBottom: g.bottom };
  });
  if (!dt2.ok) { check(false, `DT-2 ${tag}: ${dt2.reason}`); return; }
  check(dt2.items.includes("Block or report"), `DT-2 ${tag}: "Block or report" present`);
  check(dt2.items.includes("Unmatch"), `DT-2 ${tag}: "Unmatch" present`);
  check(dt2.items.length === 5, `DT-2 ${tag}: all 5 items rendered (got ${dt2.items.length}: ${dt2.items.join(" / ")})`);
  check(dt2.clipped.length === 0, `DT-2 ${tag}: no clipped items (viewport h=${dt2.ih}, menu ${Math.round(dt2.groupTop)}→${Math.round(dt2.groupBottom)}; clipped: ${dt2.clipped.join(", ") || "none"})`);
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
    // DT-1 + DT-3 assertions on the desktop two-pane rail (dim + light).
    if (vp.desktop) {
      for (const theme of ["dim", "light"]) {
        await setTheme(page, theme);
        await assertDesktop(page, vp.tag, theme);
      }
    }
    if (errors.length) { console.log(`PAGEERRORS(${vp.tag}):`, errors.join(" | ")); FAILURES.push(`pageerrors ${vp.tag}: ${errors.join(" | ")}`); }
    else console.log(`no pageerrors (${vp.tag})`);
    await browser.close();
  }

  // DT-2 — dedicated short desktop viewport so the last conversation row's ⋯ sits
  // low in the rail, exercising the upward flip. dim + light.
  for (const theme of ["dim", "light"]) {
    const { browser, page, errors } = await launch({ viewport: { width: 1024, height: 560 } });
    await login(page, pair.a);
    await setTheme(page, theme);
    await assertRowMenuFlip(page, `d1024x560_${theme}`);
    await shoot(page, `d1024x560_${theme}_rowmenu_flip`);
    if (errors.length) { console.log(`PAGEERRORS(dt2 ${theme}):`, errors.join(" | ")); FAILURES.push(`pageerrors dt2 ${theme}: ${errors.join(" | ")}`); }
    await browser.close();
  }

  if (FAILURES.length) {
    console.log(`\nDT ASSERTIONS FAILED (${FAILURES.length}):`);
    FAILURES.forEach((m) => console.log("  -", m));
    process.exit(1);
  }
  console.log("\nall DT assertions passed");
  console.log("done");
};

main().catch((e) => { console.error(e); process.exit(1); });
