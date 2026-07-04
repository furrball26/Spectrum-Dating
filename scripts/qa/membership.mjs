// Standing QA — the FREE-state Membership screen (billing/entitlements frontend).
// A fresh (free) account opens Settings → Membership and must see: both tiers
// with the one honest price, the calm "coming soon" note on Upgrade (the stub
// provider returns { configured:false } — never a fake checkout), and the
// free/locked Companion area. No console pageerrors.
//
// NOTE: QA harness accounts are NOT admins (they 403 on /admin), so the admin
// demo toggle and the PAID (Companion) member state cannot be exercised here —
// those are covered by code correctness + live-bundle markers, not this driver.
//
// Run against the local preview (see smoke.mjs header):
//   node scripts/qa/membership.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const free = await makeAccount("membership", { displayName: "Mem QA" });
const { browser, page, errors } = await launch();
await login(page, free);

// Land straight on Settings (an allowed ?tab= deep-link), then open Membership.
await page.goto(`${APP}?tab=settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const membershipRow = page.getByRole("button", { name: /^membership/i }).first();
check("Settings has a Membership entry", (await membershipRow.count()) > 0);
await membershipRow.click().catch(() => {});
await page.waitForTimeout(1500);

const heading = page.getByRole("heading", { name: /^membership$/i }).first();
check("Membership screen opened", (await heading.count()) > 0);

const bodyText = await page.evaluate(() => document.body.innerText);
check("Free tier shown (Spectrum (Free))", /Spectrum \(Free\)/.test(bodyText));
check("Companion tier shown (Spectrum Companion)", /Spectrum Companion/.test(bodyText));
check("One honest price shown ($8.99/mo)", /\$8\.99\/mo/.test(bodyText));
check("Companion area shows a locked 'Included with Companion' state", /Included with Companion/.test(bodyText));

// Upgrade → stub provider returns { configured:false } → calm coming-soon note.
const upgradeBtn = page.getByRole("button", { name: /upgrade to companion/i }).first();
check("Free user sees an Upgrade to Companion CTA", (await upgradeBtn.count()) > 0);
await upgradeBtn.click().catch(() => {});
await page.waitForTimeout(1500);
const afterUpgrade = await page.evaluate(() => document.body.innerText);
check(
  "Upgrade shows the calm 'coming soon' note (no fake checkout)",
  /Payment options are coming soon/.test(afterUpgrade)
);
// Honesty guard: the stub must NEVER flip the free user into a paid state.
check("Still framed as free after Upgrade (no fabricated paid state)", !/You're on Spectrum Companion/.test(afterUpgrade));

await page.screenshot({ path: `${OUT}/membership_free.png`, fullPage: true });

check("No console pageerrors on the Membership flow", errors.length === 0, errors.join(" | "));

await browser.close();
await cleanupAccounts([free]);
finish();
