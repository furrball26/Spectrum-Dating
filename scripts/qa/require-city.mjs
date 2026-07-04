// Regression driver for the required-city gate (App.jsx + RequireCityScreen).
// Proves BOTH directions of the legacy-member data-quality gate:
//   • a member past onboarding with a BLANK city is shown "Add your city" and
//     is blocked from Discover until they enter one (then enters the app);
//   • a member WITH a city is NOT gated (normal golden path, no regression).
// Run like smoke.mjs: build with VITE_API_URL, `vite preview --port 4173`,
// then `node scripts/qa/require-city.mjs` (exit 0 = PASS).
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// A legacy account: onboarding complete (default), but city cleared to blank —
// exactly the pre-city-field data shape the gate exists to fix.
const noCity = await makeAccount("gatenocity", { displayName: "Nia QA", distCity: "" });
// A normal account with a city — must NEVER see the gate.
const hasCity = await makeAccount("gatehascity", { displayName: "Cal QA", distCity: "Denver, CO" });

const { browser, page, errors } = await launch();

// ── 1. Blank-city member IS gated ────────────────────────────────────────────
await login(page, noCity);
let bodyText = await page.locator("body").innerText();
check("Blank-city member sees the Add your city gate", /Add your city/.test(bodyText));
const cityInput = page.locator("#require-dist-city");
check("Gate shows the coarse-city input", (await cityInput.count()) > 0);
// Blocked from the app: the primary nav (Discover/Messages/Likes) is absent.
check(
  "Blank-city member is blocked from Discover",
  (await page.locator('nav[aria-label="Primary"]').count()) === 0,
  `navPresent=${await page.locator('nav[aria-label="Primary"]').count()}`
);
await page.screenshot({ path: `${OUT}/require_city_gate.png` });

// Required: submitting empty shows the validation error, still no app.
await page.getByRole("button", { name: /Save and continue/ }).click();
await page.waitForTimeout(600);
bodyText = await page.locator("body").innerText();
check("Empty submit is rejected with calm validation", /Please enter your city or area/.test(bodyText));
check(
  "Still blocked after empty submit",
  (await page.locator('nav[aria-label="Primary"]').count()) === 0
);

// Enter a city and save → gate clears, member enters the app.
await cityInput.fill("Austin, TX");
await page.getByRole("button", { name: /Save and continue/ }).click();
await page.waitForTimeout(2500);
const navText = await page.locator('nav[aria-label="Primary"]').innerText().catch(() => "");
check(
  "After saving a city, member enters the app (Discover nav present)",
  /Discover/.test(navText) && /Messages/.test(navText),
  `nav="${navText.replace(/\s+/g, " ").trim()}"`
);
check(
  "Gate does not re-show once a city is set",
  !/Add your city/.test(await page.locator("body").innerText())
);

// ── 2. Member WITH a city is NOT gated ───────────────────────────────────────
await login(page, hasCity);
const navText2 = await page.locator('nav[aria-label="Primary"]').innerText().catch(() => "");
check(
  "City-having member boots straight to Discover (no gate)",
  /Discover/.test(navText2) && !/Add your city/.test(await page.locator("body").innerText()),
  `nav="${navText2.replace(/\s+/g, " ").trim()}"`
);

check("No console pageerrors across the gate flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([noCity.token, hasCity.token]);
