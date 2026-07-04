// "Top Picks" (best-fits) — locked-state driver (see CLAUDE.md → E2E in this
// sandbox). QA accounts are FREE by design (a member can't self-grant Companion),
// so this exercises the FREE path end-to-end: a fresh free account reaches "Top
// Picks" and sees the calm LOCKED panel with an Upgrade route — never the
// Companion list, never a generic error. It covers BOTH entry points now live:
//   1. the "Top Picks" button in Discover's action area, and
//   2. the "See Top Picks" entry from Membership → Companion area,
// plus the new Membership section on the Profile screen. The Companion LIST path
// can't be exercised here (no self-grant) and is covered by backend tests (402 vs
// list) + code + live-bundle markers. Backend endpoint stays /matching/best-fits.
import { makeAccount, launch, login, check, finish, cleanupAccounts, api } from "./harness.mjs";

const { browser, page, errors } = await launch();
const tokens = [];
try {
  const free = await makeAccount("bestfits", { displayName: "Fitz QA" });
  tokens.push(free);

  // Sanity: the backend gate — a free caller is 402'd by requirePaid.
  const gated = await api("/matching/best-fits", {}, free.token);
  check("free caller is 402 upgrade_required at the endpoint", gated.status === 402 && gated.body?.upgrade === true,
    `status=${gated.status}`);

  await login(page, free);

  // ── Entry 1: Discover → "Top Picks" button opens the surface ────────────────
  await page.goto("http://127.0.0.1:4173/?tab=suggestions", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const discoverTopPicks = page.getByRole("button", { name: /^Top Picks$/i }).first();
  await discoverTopPicks.waitFor({ state: "visible", timeout: 8000 });
  await discoverTopPicks.click();
  await page.waitForTimeout(1800);

  let bodyText = await page.evaluate(() => document.body.innerText);
  check("Discover Top Picks button opens the Top Picks surface", /Top Picks/i.test(bodyText));
  check("locked panel names Spectrum Companion (from Discover)", /part of Spectrum Companion/i.test(bodyText));

  // ── Entry 2: Membership → Companion area → "See Top Picks" ───────────────────
  await page.goto("http://127.0.0.1:4173/?tab=membership", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const entry = page.getByRole("button", { name: /Top Picks/i }).first();
  await entry.waitFor({ state: "visible", timeout: 8000 });
  await entry.click();
  await page.waitForTimeout(1800);

  bodyText = await page.evaluate(() => document.body.innerText);
  check("best fits screen heading present", /Top Picks/i.test(bodyText));
  check("locked panel names Spectrum Companion", /part of Spectrum Companion/i.test(bodyText));
  check("no Companion cards leaked (no 'I'm interested' action)", !/I'm interested/i.test(bodyText));

  const upgrade = page.getByRole("button", { name: /See Companion plans/i }).first();
  check("locked panel offers an Upgrade route back to plans", await upgrade.isVisible().catch(() => false));

  await page.screenshot({ path: "qa-artifacts/bestfits-locked.png" }).catch(() => {});

  // ── Profile → Membership section (its new home) ─────────────────────────────
  await page.goto("http://127.0.0.1:4173/?tab=profile", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const membershipSection = page.getByRole("button", { name: /^Membership/i }).first();
  await membershipSection.waitFor({ state: "visible", timeout: 8000 });
  await membershipSection.click(); // expand the collapsible section
  await page.waitForTimeout(600);

  const manage = page.getByRole("button", { name: /Manage membership/i }).first();
  check("Profile shows a Membership section with a Manage membership control",
    await manage.isVisible().catch(() => false));

  await page.screenshot({ path: "qa-artifacts/profile-membership.png" }).catch(() => {});

  check("no console pageerrors on the Top Picks / membership golden path", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await cleanupAccounts(tokens);
}
finish();
