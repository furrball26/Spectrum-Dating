// Standing driver for the Profile Hub (Hinge-pattern) — the calm HOME view the
// Profile tab now defaults to. Editing / preferences / settings are deliberate
// drill-ins reached FROM the hub, not the tab's default surface.
//
// Asserts, at 390px in dim + light:
//   • the hub renders: avatar hero + name + Preferences + Settings icon buttons
//     + the four calm destination rows (How others see you / Membership / Top
//     Picks / Safety Center) — and NOT the edit form's group accordions;
//   • the avatar pencil opens the full Edit form (About me / Looking for groups);
//   • Preferences lands on the "Looking for" preferences (group open);
//   • Settings opens the Settings screen.
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/profile-hub.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const acct = await makeAccount("phub", {
  displayName: "Hub QA",
  gender: "woman",
  pronouns: "she/her",
  seeking: "man",
  interests: ["hiking"],
  bio: "A bio so onboarding completes.",
});

async function gotoHub(page) {
  await page.getByRole("button", { name: /^profile$/i }).first().click();
  await page.waitForTimeout(1200);
}

async function run(theme) {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y", JSON.stringify({ theme: th })), theme);
  await login(page, acct);

  // ── 1. The hub is the tab default (not the edit form). ──────────────────────
  await gotoHub(page);
  check(`[${theme}] hub shows the member name`,
    (await page.getByRole("heading", { name: /Hub QA/ }).count()) > 0);
  check(`[${theme}] Preferences icon button present`,
    (await page.getByRole("button", { name: /^Preferences$/ }).count()) === 1);
  check(`[${theme}] Settings icon button present`,
    (await page.getByRole("button", { name: /^Settings$/ }).count()) === 1);
  check(`[${theme}] avatar pencil (Edit profile) present`,
    (await page.getByRole("button", { name: /^Edit profile$/ }).count()) === 1);
  for (const row of ["How others see you", "Membership", "Top Picks", "Safety Center"]) {
    check(`[${theme}] hub row "${row}" present`,
      (await page.getByRole("button", { name: new RegExp(row, "i") }).count()) > 0);
  }
  // The edit-form group accordions must NOT be on the hub (it's a home, not a form).
  check(`[${theme}] hub is not the edit form (no group accordions)`,
    (await page.locator("#section-aboutMe-button, #section-lookingFor-button").count()) === 0);
  await page.screenshot({ path: `${OUT}/profile_hub_${theme}.png`, fullPage: true });

  // ── 2. Pencil opens the full Edit form. ─────────────────────────────────────
  await page.getByRole("button", { name: /^Edit profile$/ }).click();
  await page.waitForTimeout(1200);
  check(`[${theme}] pencil opens Edit (Your profile heading)`,
    (await page.getByRole("heading", { name: /Your profile/ }).count()) > 0);
  check(`[${theme}] Edit shows the group accordions`,
    (await page.locator("#section-aboutMe-button").count()) === 1
    && (await page.locator("#section-lookingFor-button").count()) === 1);

  // ── 3. Preferences lands on the "Looking for" preferences (group open). ─────
  await gotoHub(page);
  await page.getByRole("button", { name: /^Preferences$/ }).click();
  await page.waitForTimeout(1400);
  check(`[${theme}] Preferences opens the editor`,
    (await page.getByRole("heading", { name: /Your profile/ }).count()) > 0);
  check(`[${theme}] Preferences lands on the Looking-for group (expanded)`,
    (await page.locator("#section-lookingFor-button").getAttribute("aria-expanded")) === "true");
  // A real preference control is reachable (seeking / age live in Looking for).
  check(`[${theme}] Looking-for preference control present`,
    (await page.locator("#seek-man").count()) === 1);

  // ── 4. Settings opens the Settings screen. ──────────────────────────────────
  await gotoHub(page);
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.waitForTimeout(1200);
  check(`[${theme}] Settings opens the Settings screen (theme group)`,
    (await page.getByRole("group", { name: /theme/i }).count()) > 0);

  check(`[${theme}] no console pageerrors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

await run("dim");
await run("light");
finish();
await cleanupAccounts([acct.token]);
