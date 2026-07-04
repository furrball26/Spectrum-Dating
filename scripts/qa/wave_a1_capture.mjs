// Wave A-1 design capture — D-1 (flipped Discover moat card) + D-4 (reframed
// onboarding Step 5). 390px + desktop, dim + light. Read-only; shots → qa-artifacts/.
// Registration-thrifty: ONE discover viewer+candidate pair and ONE onboarding
// account are reused across all viewports/themes (the backend register endpoint
// is tightly rate-limited).
import { makeAccount, launch, login } from "./harness.mjs";
import fs from "node:fs";

const OUT = "qa-artifacts";
fs.mkdirSync(OUT, { recursive: true });

const COMMS = {
  interests: ["hiking", "board games", "reading"],
  commDirectness: "direct", commCadence: "daily", sensoryEnvironment: "quiet",
  commLiteral: "literal", sensoryLighting: "dim", socialDuration: "short",
  relationshipGoal: "long-term",
};

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem("spectrum_a11y") || "{}") || {}; } catch { /* noop */ }
    localStorage.setItem("spectrum_a11y", JSON.stringify({ ...raw, theme: th }));
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
}

async function walkOnboardingToStep5(page) {
  await page.locator('input[autocomplete="name"], input[type="text"]').first().fill("Onboarding QA");
  const dob = page.locator('input[type="date"]').first();
  if (await dob.count()) { const v = await dob.inputValue(); if (!v) await dob.fill("1990-05-15"); }
  const city = page.locator('#ob-dist-city');
  if (await city.count()) { const v = await city.inputValue(); if (!v) await city.fill("Portland, OR"); }
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(500);
  await page.locator("textarea").first().fill("I enjoy calm hikes, board games, and quiet cafes on weekends.");
  const custom = page.getByPlaceholder(/type an interest/i).first();
  if (await custom.count()) { await custom.fill("hiking"); await page.getByRole("button", { name: /add interest/i }).click(); await page.waitForTimeout(300); }
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(500);
  // Step 3 — accept calm defaults.
  await page.getByRole("button", { name: /^continue$/i }).first().click();
  await page.waitForTimeout(500);
  // Step 4 — gender, sexual orientation, and seeking are now REQUIRED at
  // sign-up; Continue is gated until each is chosen.
  await page.getByRole("button", { name: /^Woman$/ }).click();
  await page.getByRole("button", { name: /^Straight$/ }).click();
  await page.getByLabel(/^Women$/).check();
  await page.getByRole("button", { name: /^continue$/i }).first().click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(600);
}

// ── Register the three reusable accounts ONCE ───────────────────────────────
const viewer = await makeAccount("a1v", {
  displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man",
  bio: "Weekend hiker, board-game host, and a devoted re-reader of the same three novels.",
  tagline: "Slow mornings, long trails.", ...COMMS,
});
await makeAccount("a1c", {
  displayName: "Ben QA", gender: "man", pronouns: "he/him", seeking: "woman",
  bio: "I map quiet trails, lose whole evenings to strategy games, and reread more than I should.",
  tagline: "Quiet trails, good company.", commNote: "I take language literally and like clear plans.",
  ...COMMS,
});
const onbAcct = await makeAccount("a1onb", { onboardingComplete: false, bio: "", displayName: "" });

for (const [tag, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]]) {
  // D-1 — Discover moat card
  {
    const { browser, page } = await launch({ viewport });
    await login(page, viewer);
    await page.waitForTimeout(2500);
    for (const theme of ["dim", "light"]) {
      await setTheme(page, theme);
      await page.waitForTimeout(1000);
      const marker = await page.getByText(/^Why you fit$/i).count();
      const p = `${OUT}/a1_discover_${tag}_${theme}.png`;
      await page.screenshot({ path: p, fullPage: true });
      console.log("shot", p, "whyYouFit=", marker);
    }
    await browser.close();
  }
  // D-4 — Onboarding Step 5 (fresh context per theme; same reusable account)
  for (const theme of ["dim", "light"]) {
    const { browser, page } = await launch({ viewport });
    await login(page, onbAcct);
    await page.waitForTimeout(1200);
    await setTheme(page, theme);
    await page.waitForTimeout(1000);
    await walkOnboardingToStep5(page);
    const reframe = await page.getByText(/matches you differently/i).count();
    const p = `${OUT}/a1_onboarding_step5_${tag}_${theme}.png`;
    await page.screenshot({ path: p, fullPage: true });
    console.log("shot", p, "reframeVisible=", reframe);
    await browser.close();
  }
}
console.log("DONE");
process.exit(0);
