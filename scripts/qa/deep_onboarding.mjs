// Walk onboarding to its final submit ("Save & start exploring") and confirm
// the account lands in the app shell. 390px, dim. One fresh account.
import { makeAccount, launch, login, check, finish, APP } from "./harness.mjs";
const OUT = "qa-artifacts";

const acct = await makeAccount("onbdone", { onboardingComplete: false, bio: "", displayName: "" });
const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
await login(page, acct);
await page.waitForTimeout(1000);

check("lands in onboarding (no app nav)", (await page.getByRole("navigation", { name: /primary/i }).count()) === 0);

// Step 1: display name (+ DOB is pre-seeded by makeAccount defaults)
const nameInput = page.locator('input[autocomplete="name"], input#displayName, input[name="displayName"]').first();
if (await nameInput.count()) await nameInput.fill("Onboarding QA");
else {
  // fall back: first text input on step 1
  await page.locator('input[type="text"]').first().fill("Onboarding QA");
}
// ensure DOB present
const dob = page.locator('input[type="date"]').first();
if (await dob.count()) { const v = await dob.inputValue(); if (!v) await dob.fill("1990-05-15"); }
// City / area — required Step 1 field; fill it or Continue blocks.
const city = page.locator('#ob-dist-city');
if (await city.count()) { const v = await city.inputValue(); if (!v) await city.fill("Portland, OR"); }
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(600);

// Step 2: bio + interest
const bio = page.locator("textarea").first();
await bio.fill("I enjoy calm hikes, board games, and quiet cafes on weekends.");
const custom = page.getByPlaceholder(/type an interest/i).first();
if (await custom.count()) {
  await custom.fill("hiking");
  await page.getByRole("button", { name: /add interest/i }).click();
  await page.waitForTimeout(300);
}
check("step 2 reached (bio textarea present)", true);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(600);

// Step 3
const c3 = page.getByRole("button", { name: /^continue$/i });
if (await c3.count()) { await c3.click(); await page.waitForTimeout(500); }
// Step 4
const c4 = page.getByRole("button", { name: /^continue$/i });
if (await c4.count()) { await c4.click(); await page.waitForTimeout(500); }

// Step 5 (D-4) — the moat step is reframed as the point, not an afterthought.
check("D-4 step 5 reframed ('matches you differently')",
  (await page.getByText(/matches you differently/i).count()) > 0);

// Step 5: final submit
const save = page.getByRole("button", { name: /save & start exploring/i }).first();
check("final submit button reachable", (await save.count()) > 0);
if (await save.count()) {
  const reach = await save.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: r.top >= 0 && r.bottom <= window.innerHeight + 2, covered: !(el === top || el.contains(top)) };
  });
  check("final submit not covered/clipped", reach.visible && !reach.covered, JSON.stringify(reach));
  await save.click();
  await page.waitForTimeout(2200);

  // D33 — a calm "You're all set" arrival beat now sits between the save and the
  // app shell. It must APPEAR (with a single button to enter) and must NOT
  // auto-advance — the user enters on their own tap.
  const arrival = page.getByText(/you're all set/i);
  const enterBtn = page.getByRole("button", { name: /enter spectrum|start exploring/i });
  check("arrival beat appears after save (You're all set)", (await arrival.count()) > 0);
  const stillStep = await page.getByText(/step \d of \d/i).count();
  const navBeforeEnter = await page.getByRole("navigation", { name: /primary/i }).count();
  check("arrival beat is a confirmation, not the app shell yet", stillStep === 0 && navBeforeEnter === 0,
    `step=${stillStep} nav=${navBeforeEnter}`);
  check("arrival beat offers a single 'enter' button", (await enterBtn.count()) > 0);
  // D-5 — the arrival beat names the promise, tying the forms filled to why it's different.
  check("D-5 arrival beat names the promise ('what your senses need')",
    (await page.getByText(/what your senses need/i).count()) > 0);
  await page.screenshot({ path: `${OUT}/onboarding-allset.png` });

  // Click through the arrival button → land in the app shell.
  await enterBtn.first().click();
  await page.waitForTimeout(2500);
  const inApp = await page.getByRole("navigation", { name: /primary/i }).count();
  check("arrival button enters the app shell", inApp > 0, `nav=${inApp}`);
  await page.screenshot({ path: `${OUT}/onboarding-done.png` });
}

check("no pageerrors during onboarding completion", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
finish();
