// One-off newcomer journey driver (READ-ONLY product). 390px phone.
import { mkdirSync } from "node:fs";
import { api, makeAccount, launch, APP, OUT } from "./harness.mjs";

const OUTDIR = "qa-artifacts/journey";
mkdirSync(OUTDIR, { recursive: true });

const log = (...a) => console.log(...a);

// Measurements helper: does the page overflow, and is a given button reachable?
async function measure(page, tag) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      innerH: window.innerHeight,
      scrollH: document.body.scrollHeight,
      docScrollH: de.scrollHeight,
      scrollY: window.scrollY,
      maxScroll: Math.max(document.body.scrollHeight, de.scrollHeight) - window.innerHeight,
    };
  });
  log(`[${tag}] innerH=${m.innerH} bodyScrollH=${m.scrollH} maxScroll=${m.maxScroll} scrollY=${m.scrollY}`);
  return m;
}

// Register a brand-new, un-onboarded account directly (so onboarding UI triggers).
const rid = Math.random().toString(36).slice(2, 8);
const email = `qa+journey${rid}@spectrum-test.dev`;
const reg = await api("/auth/register", { method: "POST", body: { email, password: "TestPass12345!" } });
if (!reg.body?.token) throw new Error("register failed " + JSON.stringify(reg.body));
log("Registered newcomer:", email, "userId:", reg.body.userId);

// Seed someone who has ALREADY liked our newcomer, so a like-back = instant match,
// AND is available to appear in the deck for report/block testing.
const liker = await makeAccount("jliker", { displayName: "Sam Liker", gender: "nonbinary", pronouns: "they/them", seeking: "man,woman,nonbinary" });
await api("/matching/swipe", { method: "POST", body: { candidateId: reg.body.userId, decision: "like" } }, liker.token);
log("Seeded liker:", liker.email);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

// ── Land authed but un-onboarded ─────────────────────────────────────────────
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.evaluate(({ t, u }) => {
  localStorage.setItem("spectrum_token", t);
  localStorage.setItem("spectrum_user_id", u);
}, { t: reg.body.token, u: reg.body.userId });
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Should be on onboarding step 1
let heading = await page.locator("h1").first().innerText().catch(() => "");
log("Landing heading:", JSON.stringify(heading));
await measure(page, "onboarding-1");
await page.screenshot({ path: `${OUTDIR}/01_onboarding_step1.png` });

// ── ONBOARDING ───────────────────────────────────────────────────────────────
// Step 1
await page.fill("#ob-display-name", "Jordan");
await page.fill("#ob-dob", "1995-03-10");
await page.fill("#ob-dist-city", "Portland, OR"); // now a required Step 1 field
// Can we reach + click Continue without being blocked?
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(800);
heading = await page.locator("h1").first().innerText().catch(() => "");
log("After step1 Continue, heading:", JSON.stringify(heading));

// Step 2 — bio + interests
await page.fill("#ob-bio", "I like quiet evenings, long walks, and building model trains. Looking to meet someone kind.");
// pick a suggested interest
await page.getByRole("button", { name: /^hiking/ }).first().click().catch(() => {});
await measure(page, "onboarding-2");
await page.screenshot({ path: `${OUTDIR}/02_onboarding_step2.png` });
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(800);
heading = await page.locator("h1").first().innerText().catch(() => "");
log("After step2 Continue, heading:", JSON.stringify(heading));

// Step 3 — communication (all optional)
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(800);
heading = await page.locator("h1").first().innerText().catch(() => "");
log("After step3 Continue, heading:", JSON.stringify(heading));

// Step 4 — who you'd like to meet (optional). Set seeking so deck populates.
await page.getByLabel(/Nonbinary people/i).check().catch((e) => log("seek check err", e.message));
await measure(page, "onboarding-4");
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(800);
heading = await page.locator("h1").first().innerText().catch(() => "");
log("After step4 Continue, heading:", JSON.stringify(heading));

// Step 5 — save & start
await page.screenshot({ path: `${OUTDIR}/03_onboarding_step5.png` });
await page.getByRole("button", { name: /Save & start exploring/i }).click();
await page.waitForTimeout(1500);
const celebrateText = await page.locator("body").innerText();
log("Celebrate screen has 'all set':", /all set/i.test(celebrateText));
await page.screenshot({ path: `${OUTDIR}/04_allset.png` });
// Enter Spectrum
await page.getByRole("button", { name: /Enter Spectrum/i }).click().catch(() => {});
await page.waitForTimeout(2500);

// ── DISCOVER ─────────────────────────────────────────────────────────────────
const navText = await page.locator('nav[aria-label="Primary"]').innerText().catch(() => "");
log("Primary nav present:", /Discover/.test(navText));
await measure(page, "discover");
await page.screenshot({ path: `${OUTDIR}/05_discover.png` });
const discoverBody = await page.locator("main").innerText().catch(() => "");
log("Discover body (first 300):", JSON.stringify(discoverBody.slice(0, 300)));

await browser.close();
log("\nConsole pageerrors:", errors.length, errors.slice(0, 5).join(" | "));
log("DONE part1");
