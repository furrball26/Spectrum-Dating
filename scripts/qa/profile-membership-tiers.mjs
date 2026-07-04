// Profile redesign Phase 1 — Membership as its OWN peer group, both tier states.
// The FREE state is exercised by profile-groups.mjs (a real free account). The
// COMPANION state can't be granted through the free QA backend, so we inject it
// the same way prod6-gallery injects a multi-photo candidate: intercept the
// GET /profile/me load and patch `tier: "companion"` into the response, then
// assert the Companion rendering (status + subtle badge + "Manage membership",
// and crucially NOT the free-state "See what Companion adds" door).
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/profile-membership-tiers.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT, API } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const acct = await makeAccount("memtier", {
  displayName: "Companion QA",
  gender: "woman",
  pronouns: "she/her",
  seeking: "man",
  interests: ["hiking"],
  bio: "A bio so onboarding completes.",
});

const { browser, ctx, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

// Patch the initial profile load to look like an active Companion member. All
// other calls (including profile PUTs) still forward to the real backend.
const apiHost = new URL(API).host;
await ctx.route("**/*", async (route) => {
  const req = route.request();
  const url = req.url();
  if (req.method() === "GET" && url.includes(apiHost) && /\/profile\/me(\?|$)/.test(url)) {
    const r = await fetch(url, { headers: { authorization: req.headers().authorization || "" } });
    let body = await r.text();
    try {
      const obj = JSON.parse(body);
      if (obj && typeof obj === "object") {
        obj.tier = "companion";
        if (obj.profile && typeof obj.profile === "object") obj.profile.tier = "companion";
        body = JSON.stringify(obj);
      }
    } catch { /* leave body as-is */ }
    return route.fulfill({
      status: r.status,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body,
    });
  }
  return route.fallback(); // harness catch-all forwards everything else
});

await login(page, acct);
await page.getByRole("button", { name: /^profile$/i }).first().click();
await page.waitForTimeout(1500);

// Membership is its own collapsed group — open it.
const memBtn = page.locator("#section-membership-button");
check("Membership group renders", (await memBtn.count()) === 1);
check("Membership header shows the Companion tier summary",
  /Spectrum Companion/.test(await memBtn.innerText()));
if ((await memBtn.getAttribute("aria-expanded")) !== "true") {
  await memBtn.click();
  await page.waitForTimeout(300);
}

const memText = await page.evaluate(() => {
  const panel = document.getElementById("section-membership-panel");
  return panel ? panel.innerText : "";
});
check("Companion state: 'You're on Spectrum Companion' status", /You're on Spectrum Companion/.test(memText));
check("Companion state: subtle Companion badge present", /Companion/.test(memText));
check("Companion state: 'Manage membership' button present",
  (await page.getByRole("button", { name: /Manage membership/i }).count()) === 1);
check("Companion state: does NOT show the free-state door",
  (await page.getByRole("button", { name: /See what Companion adds/i }).count()) === 0);
check("Companion state: no 'missing out'/urgency framing",
  !/missing out|don't miss|hurry|limited time/i.test(memText), memText.slice(0, 120));

await page.screenshot({ path: `${OUT}/membership_companion_profile.png`, fullPage: true });

check("No console pageerrors on the Companion membership flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();
await cleanupAccounts([acct.token]);
