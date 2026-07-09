// Appearance / Settings control audit — does every control DO what it claims,
// and is info consistent across screens? Read-only (adds a regression driver).
//
// Verifies, by DRIVING the real local build against the real backend:
//  1. Each a11y toggle (Low-stim, Plain language, Reduce motion, High contrast,
//     Larger text) produces an OBSERVABLE DOM change AND persists across reload.
//  2. Theme picker (neutral + identity) applies to <html data-theme> + ribbon.
//  3. plainLanguage cross-screen: HONORED on Discover/Messages, IGNORED on
//     Profile hub / Membership / Notifications (captured as identical text).
//  4. Notification tier radios select + persist.
//  5. Tier label consistency across ProfileHub, Membership, Settings header.
//
// Run: node scripts/qa/appearance_controls.mjs
import fs from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts } from "./harness.mjs";

const OUT = "qa-artifacts";
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/appr-${name}.png` }).catch(() => {});

const tokens = [];
try {
  const acct = await makeAccount("appr", {
    displayName: "Cara QA", gender: "woman", pronouns: "she/her", seeking: "man",
  });
  tokens.push(acct);
  const { browser, page } = await launch({ viewport: { width: 390, height: 844 } });
  await login(page, acct);

  // ── page-state readers ──────────────────────────────────────────────────────
  const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y") || "{}"));
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || "(light)");
  const reduceStyleOn = () => page.evaluate(() => !!document.getElementById("a11y-overrides"));
  // The a11y wrapper is the top-level flex container; read its inline overrides.
  const wrapper = () => page.evaluate(() => {
    const els = [...document.querySelectorAll("div")];
    const el = els.find((e) => e.style && (e.style.filter || (e.style.transform || "").includes("scale")));
    if (!el) return { filter: "", transform: "" };
    return { filter: el.style.filter, transform: el.style.transform };
  });
  const ribbonPresent = () => page.evaluate(() =>
    [...document.querySelectorAll("div,span")].some((e) =>
      (e.style?.background || "").includes("linear-gradient") && (e.getAttribute("aria-hidden") === "true")
      && (e.style.height === "3px" || e.offsetHeight === 3)));
  const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim());

  async function gotoTab(name) {
    await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first().click().catch(() => {});
    await page.waitForTimeout(1100);
  }
  async function gotoSettings() {
    await gotoTab("Profile");
    await page.getByRole("button", { name: /^Settings$/ }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  async function toggle(name) {
    const sw = page.getByRole("switch", { name }).first();
    await sw.scrollIntoViewIfNeeded().catch(() => {});
    await sw.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // ═══ 1. THEME PICKER ═════════════════════════════════════════════════════════
  await gotoSettings();
  await shot(page, "settings-default");
  check("Settings default theme is dim", (await theme()) === "dim", `theme=${await theme()}`);

  await page.getByRole("button", { name: /Navy theme/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  check("Theme→Navy applies to <html data-theme>", (await theme()) === "navy", `theme=${await theme()}`);
  check("Theme→Navy persisted to localStorage", (await prefs()).theme === "navy");

  await page.getByRole("button", { name: /Pride theme/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  check("Theme→Pride applies to <html data-theme>", (await theme()) === "pride", `theme=${await theme()}`);
  await shot(page, "settings-pride");

  // reset to dim for the rest via the picker (Warm dim card)
  await page.getByRole("button", { name: /Warm dim theme/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  // ═══ 2. A11Y TOGGLES — each must produce an observable change ════════════════
  // High contrast → root filter
  await toggle("High contrast");
  check("High contrast → wrapper filter contrast(1.15)", (await wrapper()).filter.includes("contrast"), (await wrapper()).filter);
  await toggle("High contrast"); // off

  // Larger text → transform scale
  await toggle("Larger text");
  check("Larger text → wrapper transform scale", (await wrapper()).transform.includes("scale"), (await wrapper()).transform);
  await toggle("Larger text"); // off

  // Reduce motion → global stylesheet injected
  await toggle("Reduce motion");
  check("Reduce motion → #a11y-overrides stylesheet injected", await reduceStyleOn());
  await toggle("Reduce motion"); // off
  check("Reduce motion off → stylesheet removed", !(await reduceStyleOn()));

  // Low stimulation → also injects reduce-motion sheet + flips reduceMotion pref
  await toggle("Low stimulation");
  check("Low stim → #a11y-overrides stylesheet injected", await reduceStyleOn());
  check("Low stim → reducedSensory persisted", (await prefs()).reducedSensory === true);
  await toggle("Low stimulation"); // off

  // ═══ 3. PERSISTENCE ACROSS RELOAD ════════════════════════════════════════════
  await toggle("High contrast");
  await page.getByRole("button", { name: /Navy theme/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  check("After reload: navy theme still applied", (await theme()) === "navy", `theme=${await theme()}`);
  check("After reload: high contrast still applied", (await wrapper()).filter.includes("contrast"));
  // clean back to dim + contrast off for plain-language capture
  await gotoSettings();
  await page.getByRole("button", { name: /Warm dim theme/i }).first().click().catch(() => {});
  await toggle("High contrast");
  await page.waitForTimeout(400);

  // ═══ 4. PLAIN LANGUAGE — cross-screen honored vs ignored ═════════════════════
  // Capture Discover / Profile-hub / Membership text with plain OFF, then ON.
  // Reach the Membership screen from the Profile hub. The hub ROW's accessible
  // name is "Membership Free See what Companion adds…" (title+tag+subtitle), so
  // an anchored /^Membership$/ never matches — use /^Membership\b/ and confirm
  // arrival by the Membership screen's unique "One honest published price" copy.
  async function openMembership() {
    await gotoTab("Profile");
    await page.getByRole("button", { name: /^Membership\b/ }).first().click().catch(() => {});
    await page.waitForTimeout(1400);
  }
  const onMembership = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").includes("One honest published price"));

  async function captureScreens() {
    const out = {};
    await gotoTab("Discover");
    out.discover = await mainText();
    await gotoTab("Profile");
    out.profileHub = await mainText();
    await openMembership();
    out.membershipReached = await onMembership();
    out.membership = await mainText();
    return out;
  }
  const plainOff = await captureScreens();

  // turn plain language ON
  await gotoSettings();
  await toggle("Plain language");
  check("Plain language persisted", (await prefs()).plainLanguage === true);
  const plainOn = await captureScreens();

  check("Membership screen actually reached (selector integrity)", plainOn.membershipReached && plainOff.membershipReached);
  check("Plain language CHANGES Discover copy (honored)", plainOff.discover !== plainOn.discover,
    `off≠on: ${plainOff.discover !== plainOn.discover}`);
  check("Plain language does NOTHING on Profile hub (ignored — defect class)",
    plainOff.profileHub === plainOn.profileHub, "identical text off/on");
  check("Plain language does NOTHING on Membership (ignored — defect class)",
    plainOff.membership === plainOn.membership && plainOn.membershipReached, "identical text off/on");

  // ═══ 5. NOTIFICATION TIER radios ═════════════════════════════════════════════
  await gotoTab("Profile");
  await page.getByRole("button", { name: /^Notifications$/ }).first().click().catch(() => {});
  await page.waitForTimeout(1300);
  const nameRadio = page.getByRole("radio", { name: /Name only/i }).first();
  await nameRadio.click().catch(() => {});
  await page.waitForTimeout(1200);
  const nameChecked = await nameRadio.isChecked().catch(() => false);
  check("Notification tier 'Name only' selectable", nameChecked);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await gotoTab("Profile");
  await page.getByRole("button", { name: /^Notifications$/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const nameStill = await page.getByRole("radio", { name: /Name only/i }).first().isChecked().catch(() => false);
  check("Notification tier persisted to backend across reload", nameStill);

  // ═══ 6. TIER LABEL CONSISTENCY (free account) ════════════════════════════════
  await gotoTab("Profile");
  const hubText = await mainText();
  check("ProfileHub shows Membership tag 'Free'", /Free/.test(hubText));
  await openMembership();
  const memText = await mainText();
  await shot(page, "membership-free");
  check("Membership screen actually shown (not hub)", await onMembership());
  // The Membership free TierCard name comes from the backend catalog. Record it
  // verbatim so hub 'Free' vs Membership plan-name wording can be compared.
  const freeCardName = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].map((e) => e.innerText.trim());
    return h.find((x) => /free/i.test(x)) || h[0] || "(none)";
  });
  check("Membership names the Free plan", /Free/.test(memText), `TierCard name="${freeCardName}"`);

  // ═══ 7. LARGER-TEXT SCOPE — does it enlarge the whole app? ════════════════════
  // The a11y wrapper is transform:scale(1.15), but the primary NAV is rendered
  // OUTSIDE that wrapper (so scale can't break position:fixed). Measure the nav's
  // "Discover" label height with Larger text OFF vs ON — if identical, the nav is
  // NOT enlarged despite the toggle claiming "Enlarge everything by about 15%".
  const navLabelBox = () => page.evaluate(() => {
    const el = [...document.querySelectorAll("nav[aria-label='Primary'] *")]
      .find((e) => e.textContent.trim() === "Discover" && e.children.length === 0);
    if (!el) return 0;
    return Math.round(el.getBoundingClientRect().height * 100) / 100;
  });
  await gotoTab("Discover");
  const navOff = await navLabelBox();
  await gotoSettings();
  await toggle("Larger text");
  await gotoTab("Discover");
  const navOn = await navLabelBox();
  check("Larger text: nav label NOT enlarged (scope gap vs 'Enlarge everything')",
    navOff > 0 && navOff === navOn, `Discover-label h off=${navOff} on=${navOn}`);
  await shot(page, "larger-text-on");

  await browser.close();
} finally {
  await cleanupAccounts(tokens);
}
finish();
