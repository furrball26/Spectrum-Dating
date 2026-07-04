// "Your best fits" — locked-state driver (see CLAUDE.md → E2E in this sandbox).
// QA accounts are FREE by design (a member can't self-grant Companion), so this
// exercises the FREE path end-to-end: a fresh free account reaches "Your best
// fits" from the Membership → Companion area and sees the calm LOCKED panel with
// an Upgrade route — never the Companion list, never a generic error. The
// Companion LIST path can't be exercised here (no self-grant) and is covered by
// backend tests (402 vs list) + code + live-bundle markers.
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

  // Land on Membership, then open "Your best fits" from the Companion area.
  await page.goto("http://127.0.0.1:4173/?tab=membership", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const entry = page.getByRole("button", { name: /Your best fits/i }).first();
  await entry.waitFor({ state: "visible", timeout: 8000 });
  await entry.click();
  await page.waitForTimeout(1800);

  const bodyText = await page.evaluate(() => document.body.innerText);
  check("best fits screen heading present", /Your best fits/i.test(bodyText));
  check("locked panel names Spectrum Companion", /part of Spectrum Companion/i.test(bodyText));
  check("no Companion cards leaked (no 'I'm interested' action)", !/I'm interested/i.test(bodyText));

  const upgrade = page.getByRole("button", { name: /See Companion plans/i }).first();
  check("locked panel offers an Upgrade route back to plans", await upgrade.isVisible().catch(() => false));

  await page.screenshot({ path: "qa-artifacts/bestfits-locked.png" }).catch(() => {});

  check("no console pageerrors on the best-fits golden path", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await cleanupAccounts(tokens);
}
finish();
