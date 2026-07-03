// PROD-6 — Discover deck photo gallery driver.
// Verifies the multi-photo path on the SWIPE card: dot indicators + left/right
// tap zones navigate photos, alt text follows the current photo, and photo nav
// NEVER fires a like/skip (no POST /matching/swipe). The seeded/live QA deck may
// only have single-photo candidates, so we inject a 3-photo candidate by
// overriding the /matching/candidates response (all other calls still forward to
// the real backend through the harness).
import { makeAccount, launch, login, check, finish, API } from "./harness.mjs";

const PX = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="; // 1x1 gif (no egress needed)
const CANDIDATE = {
  memberId: "prod6-cand",
  displayName: "Photo QA",
  age: 30,
  tagline: "Three photos",
  bio: "Testing the gallery.",
  interests: ["hiking"],
  whyReasons: ["Shared interest: hiking"],
  distCity: "Phoenix, AZ",
  relationshipGoal: "long-term",
  photoUrl: PX,
  photoDescription: "Photo QA at the beach",
  verified: false,
  prompts: [],
  photos: [
    { url: PX, description: "Photo QA at the beach", isPrimary: true },
    { url: PX, description: "Photo QA hiking", isPrimary: false },
    { url: PX, description: "Photo QA with a cat", isPrimary: false },
  ],
};

const viewer = await makeAccount("prod6", { displayName: "Viewer QA" });
const { browser, ctx, page, errors } = await launch();

// Override candidates BEFORE navigation (last-registered route wins in Playwright).
const apiHost = new URL(API).host;
await ctx.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.includes(apiHost) && url.includes("/matching/candidates")) {
    return route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
        "x-has-more": "false",
      },
      body: JSON.stringify([CANDIDATE]),
    });
  }
  return route.fallback(); // let the harness catch-all forward everything else
});

let swipeCalls = 0;
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/matching/swipe")) swipeCalls++;
});

await login(page, viewer);
await page.waitForTimeout(1500);

const heroAlt = () => page.locator('[role="group"][aria-roledescription="carousel"] img').first().getAttribute("alt");
const nameVisible = () => page.getByText("Photo QA", { exact: false }).first().isVisible().catch(() => false);

// 1. Deck card rendered with the injected candidate.
check("PROD-6 deck card renders injected candidate", await nameVisible());

// 2. Gallery carousel present with 3 dot buttons + tap zones.
const dot1 = page.getByRole("button", { name: "Photo 1 of 3" });
const dot3 = page.getByRole("button", { name: "Photo 3 of 3" });
const nextZone = page.getByRole("button", { name: /Next photo/ });
const prevZone = page.getByRole("button", { name: /Previous photo/ });
check("3 dot indicators are labelled buttons", (await page.getByRole("button", { name: /^Photo \d of 3$/ }).count()) === 3,
  `count=${await page.getByRole("button", { name: /^Photo \d of 3$/ }).count()}`);
check("Left/right tap zones are labelled buttons", (await nextZone.count()) === 1 && (await prevZone.count()) === 1);

// 3. Alt text starts on the primary photo.
const alt0 = await heroAlt();
check("Alt text is the primary photo's description first", alt0 === "Photo QA at the beach", `alt=${alt0}`);

// 4. Next tap-zone advances the photo (alt follows).
await nextZone.click();
await page.waitForTimeout(150);
const alt1 = await heroAlt();
check("Next tap-zone advances to photo 2 (alt updates)", alt1 === "Photo QA hiking", `alt=${alt1}`);

// 5. Dot jumps directly to photo 3.
await dot3.click();
await page.waitForTimeout(150);
const alt2 = await heroAlt();
check("Dot indicator jumps to photo 3 (alt updates)", alt2 === "Photo QA with a cat", `alt=${alt2}`);

// 6. Prev tap-zone goes back.
await prevZone.click();
await page.waitForTimeout(150);
const alt3 = await heroAlt();
check("Previous tap-zone goes back to photo 2", alt3 === "Photo QA hiking", `alt=${alt3}`);

// 7. Photo nav must NOT advance the deck or record a like/skip.
check("Photo nav did NOT fire a like/skip swipe", swipeCalls === 0, `swipeCalls=${swipeCalls}`);
check("Deck did NOT advance (same person still shown)", await nameVisible());
check("No 'Saved'/confirmation flashed from photo nav",
  !(await page.getByText(/^Saved\.|You said you're interested/).first().isVisible().catch(() => false)));

// 8. dot1 is aria-current after returning? (currently on photo 2) — check dot2 current.
const dot2Current = await page.getByRole("button", { name: "Photo 2 of 3" }).getAttribute("aria-current");
check("Active dot exposes aria-current", dot2Current === "true", `aria-current=${dot2Current}`);

// 9. No console pageerrors on the gallery path.
check("No console pageerrors", errors.length === 0, errors.join(" | "));

await browser.close();
finish();
