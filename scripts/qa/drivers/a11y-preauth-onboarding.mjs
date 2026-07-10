// One-off evidence driver for the two neurodivergent-support features:
//  F1 — pre-auth "Comfort" control (Plain language / Low stimulation) on Landing,
//       proving the Landing copy visibly changes when Plain language is ON, and
//       that the choice writes to the shared spectrum_a11y prefs.
//  F2 — onboarding scope line + save/resume (fields + step restore after reload).
// Run: node scripts/qa/drivers/a11y-preauth-onboarding.mjs
import { chromium } from "playwright-core";
import { api, APP, OUT } from "../harness.mjs";
import fs from "node:fs";

const CHROME = process.env.QA_CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const API = process.env.QA_API_URL || "https://spectrum-dating-server-production.up.railway.app";
const apiHost = new URL(API).host;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-allow-headers": "authorization,content-type" };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (!url.includes(apiHost)) return route.continue();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS, body: "" });
    if (url.includes("/socket.io")) return route.fulfill({ status: 503, headers: CORS, body: "" });
    const h = req.headers();
    const fh = {};
    if (h.authorization) fh.authorization = h.authorization;
    if (h["content-type"]) fh["content-type"] = h["content-type"];
    try {
      const r = await fetch(url, { method: req.method(), headers: fh, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData() });
      return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": r.headers.get("content-type") || "application/json" }, body: await r.text() });
    } catch { return route.fulfill({ status: 502, headers: CORS, body: "{}" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  return { ctx, page, errors };
}

// ── F1: Landing pre-auth Comfort control ──────────────────────────────────────
{
  const { page, errors } = await newPage();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const comfortBtn = page.getByRole("button", { name: /^Comfort$/ }).first();
  console.log("F1 Comfort trigger visible:", await comfortBtn.count());
  await page.screenshot({ path: `${OUT}/f1-landing-comfort-closed.png` });

  const h1Before = (await page.locator("h1").first().innerText()).trim();
  await comfortBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/f1-landing-comfort-open.png` });

  // Toggle Plain language ON via the role=switch labelled "Plain language".
  await page.getByRole("switch", { name: /Plain language/ }).first().click();
  await page.waitForTimeout(500);
  const h1After = (await page.locator("h1").first().innerText()).trim();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y") || "{}"));
  await page.screenshot({ path: `${OUT}/f1-landing-plain-on.png` });

  console.log("F1 h1 BEFORE:", JSON.stringify(h1Before));
  console.log("F1 h1 AFTER :", JSON.stringify(h1After));
  console.log("F1 copy changed:", h1Before !== h1After);
  console.log("F1 spectrum_a11y.plainLanguage persisted:", persisted.plainLanguage);

  // Toggle Low stimulation ON too, confirm it persists.
  await comfortBtn.click().catch(() => {});
  await page.waitForTimeout(200);
  await page.getByRole("switch", { name: /Low stimulation/ }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const persisted2 = await page.evaluate(() => JSON.parse(localStorage.getItem("spectrum_a11y") || "{}"));
  console.log("F1 spectrum_a11y.reducedSensory persisted:", persisted2.reducedSensory, "reduceMotion coherent:", persisted2.reduceMotion);
  console.log("F1 pageerrors:", errors.length ? errors : "none");
}

// ── F2: Onboarding scope line + save/resume ───────────────────────────────────
{
  // Bare fresh account (no profile) → App routes to OnboardingScreen.
  const rid = Math.random().toString(36).slice(2, 10);
  const email = `qa+obresume${rid}@spectrum-test.dev`;
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "TestPass12345!" } });
  const { token, userId } = reg.body;

  const { page, errors } = await newPage();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ t, u }) => { localStorage.setItem("spectrum_token", t); localStorage.setItem("spectrum_user_id", u); localStorage.removeItem("spectrum_onboarding_draft"); }, { t: token, u: userId });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const scopeVisible = await page.getByText(/pick up where you left off|We save your place/).count();
  console.log("F2 scope line visible on step 1:", scopeVisible);
  await page.screenshot({ path: `${OUT}/f2-onboarding-scope-line.png` });

  // Fill step 1 and advance to step 2, then type a bio.
  await page.fill("#ob-display-name", "Riley QA");
  await page.fill("#ob-dob", "1990-05-15");
  await page.fill("#ob-dist-city", "Portland, OR");
  await page.getByRole("button", { name: /^(Continue|Next)$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.fill("#ob-bio", "I love tabletop games and quiet cafes.").catch(() => {});
  await page.waitForTimeout(600);

  const draftBefore = await page.evaluate(() => localStorage.getItem("spectrum_onboarding_draft"));
  console.log("F2 draft written:", !!draftBefore, draftBefore ? JSON.parse(draftBefore).step : "-");

  // RELOAD — simulate closing/returning. Should resume step 2 with fields intact.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const stepText = (await page.getByText(/Step \d of \d/).first().innerText().catch(() => "")).trim();
  const nameVal = await page.inputValue("#ob-display-name").catch(() => "(not on this step)");
  const bioVal = await page.inputValue("#ob-bio").catch(() => "(not present)");
  console.log("F2 after reload — stepText:", JSON.stringify(stepText));
  console.log("F2 after reload — bio restored:", JSON.stringify(bioVal));
  // Go back to step 1 to prove the step-1 fields also restored.
  await page.screenshot({ path: `${OUT}/f2-onboarding-after-reload.png` });
  await page.getByRole("button", { name: /^Back$/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const nameBack = await page.inputValue("#ob-display-name").catch(() => "?");
  const cityBack = await page.inputValue("#ob-dist-city").catch(() => "?");
  console.log("F2 step-1 fields restored — name:", JSON.stringify(nameBack), "city:", JSON.stringify(cityBack));
  console.log("F2 pageerrors:", errors.length ? errors : "none");

  // Cleanup the throwaway account.
  await api("/account/me", { method: "DELETE", body: { password: "TestPass12345!" } }, token).catch(() => {});
}

await browser.close();
console.log("DONE — artifacts in", OUT);
