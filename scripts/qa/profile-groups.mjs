// Standing driver for the decluttered Profile IA: the former 9 collapsible
// sections regrouped into 3 top-level GROUPS (About me / Looking for / Account),
// each opening to reveal its former sections as plain <h3> headed blocks in ONE
// calm scroll — NO nested accordions. Runs 390px in dim + light, asserts the 3
// groups render, expand to their sub-headed blocks, hold their fields (editable),
// and that there are no accordions-inside-accordions. Captures screenshots.
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/profile-groups.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const GROUPS = ["aboutMe", "lookingFor", "account"];
const GROUP_TITLE = { aboutMe: "About me", lookingFor: "Looking for", account: "Account" };
const ABOUT_SUBHEADS = ["Prompts", "Interests", "More about you", "Identity", "How I communicate", "Sensory & social", "Lifestyle"];
const LOOKING_SUBHEADS = ["What I'm looking for", "Who I want to meet", "Age range", "Location & distance", "Deal-breakers"];
const ACCOUNT_SUBHEADS = ["Profile review", "Notifications", "Membership"];

const acct = await makeAccount("pgroups", {
  displayName: "Group QA",
  gender: "woman",
  pronouns: "she/her",
  seeking: "man",
  interests: ["hiking"],
  bio: "A bio so onboarding completes.",
});

async function openGroup(page, id) {
  const btn = page.locator(`#section-${id}-button`);
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(350);
  }
}

async function run(theme) {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate((th) => localStorage.setItem("spectrum_a11y", JSON.stringify({ theme: th })), theme);
  await login(page, acct);

  await page.getByRole("button", { name: /^profile$/i }).first().click();
  await page.waitForTimeout(1500);

  // Exactly the 3 top-level group headers exist (the 9 old section ids are gone).
  for (const id of GROUPS) {
    check(`[${theme}] group "${GROUP_TITLE[id]}" header renders`,
      (await page.locator(`#section-${id}-button`).count()) === 1);
  }
  const anyOldSection = await page.evaluate(() =>
    ["prompts", "about", "interests", "search", "lifestyle", "communicate", "sensory", "notifications", "verification", "membership"]
      .filter((s) => document.getElementById(`section-${s}-button`)).join(","));
  check(`[${theme}] no legacy section headers remain`, anyOldSection === "", `found=${anyOldSection}`);

  // Open all 3 groups.
  for (const id of GROUPS) await openGroup(page, id);

  // No nested accordions: no group panel contains another collapsible toggle
  // (a button with aria-expanded / aria-controls to a -panel).
  for (const id of GROUPS) {
    const nested = await page.evaluate((pid) => {
      const panel = document.getElementById(`section-${pid}-panel`);
      if (!panel) return -1;
      return panel.querySelectorAll('button[aria-expanded], button[aria-controls$="-panel"]').length;
    }, id);
    check(`[${theme}] "${GROUP_TITLE[id]}" has no nested accordions`, nested === 0, `nested=${nested}`);
  }

  // Sub-headed blocks: each group opens to reveal its former sections as <h3>s.
  const h3sIn = async (pid) => page.evaluate((id) => {
    const panel = document.getElementById(`section-${id}-panel`);
    return panel ? [...panel.querySelectorAll("h3")].map((h) => h.textContent.trim()) : [];
  }, pid);

  const aboutH3 = await h3sIn("aboutMe");
  for (const s of ABOUT_SUBHEADS) check(`[${theme}] About me → "${s}" sub-heading`, aboutH3.includes(s), aboutH3.join(" | "));
  const lookH3 = await h3sIn("lookingFor");
  for (const s of LOOKING_SUBHEADS) check(`[${theme}] Looking for → "${s}" sub-heading`, lookH3.includes(s), lookH3.join(" | "));
  const acctH3 = await h3sIn("account");
  for (const s of ACCOUNT_SUBHEADS) check(`[${theme}] Account → "${s}" sub-heading`, acctH3.includes(s), acctH3.join(" | "));

  // Fields present + editable across the groups (a representative field per split
  // half of the old mixed sections).
  await page.locator("#occupation").fill(`Archivist ${theme}`);
  check(`[${theme}] About me occupation editable`, (await page.locator("#occupation").inputValue()) === `Archivist ${theme}`);
  await page.locator("#pronouns").fill("she/they");
  check(`[${theme}] About me identity pronouns editable`, (await page.locator("#pronouns").inputValue()) === "she/they");
  check(`[${theme}] About me lifestyle 'wants-children' present`, (await page.locator("#wants-children").count()) === 1);
  check(`[${theme}] About me comms 'comm-directness' present`, (await page.locator("#comm-directness").count()) === 1);
  check(`[${theme}] About me 'sensory-environment' present`, (await page.locator("#sensory-environment").count()) === 1);

  check(`[${theme}] Looking for relationship goal present`, (await page.locator("#rel-long-term").count()) === 1);
  check(`[${theme}] Looking for seeking present`, (await page.locator("#seek-woman").count()) === 1);
  check(`[${theme}] Looking for age slider present`, (await page.getByRole("slider", { name: /minimum age/i }).count()) === 1);
  await page.locator("#distance-city").fill(`Portland ${theme}`);
  check(`[${theme}] Looking for distance city editable`, (await page.locator("#distance-city").inputValue()) === `Portland ${theme}`);
  check(`[${theme}] Looking for deal-breaker present`, (await page.locator("#db-non-smoker-label").count()) === 1);

  check(`[${theme}] Account notifications present`, (await page.locator("#notif-off").count()) === 1);
  check(`[${theme}] Account membership button present`, (await page.getByRole("button", { name: /Manage membership/i }).count()) === 1);

  // Full-page screenshot of the opened groups.
  await page.screenshot({ path: `${OUT}/profile_groups_${theme}.png`, fullPage: true });

  check(`[${theme}] no console pageerrors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

await run("dim");
await run("light");
finish();
await cleanupAccounts([acct.token]);
