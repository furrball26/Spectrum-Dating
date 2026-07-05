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
import { makeAccount, launch, login, check, finish, cleanupAccounts, openProfileEdit, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// Profile redesign Phase 1: Membership is now its OWN peer group (order: About
// me → Looking for → Membership → Account), and the communication/sensory moat is
// consolidated into a single "How to connect with me" module inside About me.
const GROUPS = ["aboutMe", "lookingFor", "membership", "account"];
const GROUP_TITLE = { aboutMe: "About me", lookingFor: "Looking for", membership: "Membership", account: "Account" };
const ABOUT_SUBHEADS = ["Prompts", "Interests", "How to connect with me", "More about you", "Identity", "Lifestyle"];
const LOOKING_SUBHEADS = ["What I'm looking for", "Who I want to meet", "Age range", "Location & distance", "Deal-breakers"];
const ACCOUNT_SUBHEADS = ["Profile review", "Notifications"];

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

  // Profile tab now defaults to the Profile Hub; the group editor lives behind
  // the avatar pencil.
  await openProfileEdit(page);
  await page.waitForTimeout(500);

  // Exactly the 3 top-level group headers exist (the 9 old section ids are gone).
  for (const id of GROUPS) {
    check(`[${theme}] group "${GROUP_TITLE[id]}" header renders`,
      (await page.locator(`#section-${id}-button`).count()) === 1);
  }
  const anyOldSection = await page.evaluate(() =>
    ["prompts", "about", "interests", "search", "lifestyle", "communicate", "sensory", "notifications", "verification"]
      .filter((s) => document.getElementById(`section-${s}-button`)).join(","));
  check(`[${theme}] no legacy section headers remain`, anyOldSection === "", `found=${anyOldSection}`);

  // Membership is its OWN peer group, positioned directly ABOVE Account, and
  // collapsed by DEFAULT (passive tier signal only — no auto-open, no nag).
  const order = await page.evaluate(() => {
    const ids = ["aboutMe", "lookingFor", "membership", "account"];
    const tops = ids
      .map((id) => ({ id, el: document.getElementById(`section-${id}-button`) }))
      .filter((x) => x.el)
      .sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top)
      .map((x) => x.id);
    return tops.join(",");
  });
  check(`[${theme}] group order is About me → Looking for → Membership → Account`,
    order === "aboutMe,lookingFor,membership,account", `order=${order}`);
  check(`[${theme}] Membership group collapsed by default`,
    (await page.locator("#section-membership-button").getAttribute("aria-expanded")) === "false");
  // The passive summary shows the tier while collapsed (free account here).
  check(`[${theme}] Membership header shows the free tier summary`,
    /Spectrum \(Free\)/.test(await page.locator("#section-membership-button").innerText()));

  // Open all groups.
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

  // "How to connect with me" module — the consolidated moat. All of these once
  // lived in the separate "How I communicate" / "Sensory & social" / "More about
  // you" blocks; they must now render together inside the About me panel under
  // the single "How to connect with me" <h3>.
  const inAboutPanel = (sel) => page.evaluate((s) => {
    const panel = document.getElementById("section-aboutMe-panel");
    return !!(panel && panel.querySelector(s));
  }, sel);
  check(`[${theme}] How-to-connect: 'How to connect with me' heading present`,
    aboutH3.includes("How to connect with me"));
  check(`[${theme}] How-to-connect: commNote (communication-style) consolidated in`, await inAboutPanel("#communication-style"));
  check(`[${theme}] How-to-connect: comm-directness consolidated in`, await inAboutPanel("#comm-directness"));
  check(`[${theme}] How-to-connect: sensory-environment consolidated in`, await inAboutPanel("#sensory-environment"));
  check(`[${theme}] How-to-connect: social-duration consolidated in`, await inAboutPanel("#social-duration"));
  check(`[${theme}] How-to-connect: helps-me list consolidated in`,
    (await page.getByRole("button", { name: /Add something that helps/i }).count()) === 1);

  // Interests render as a visual chip cluster: the member's own interest ("hiking")
  // shows as a pill in the labelled "Your selected interests" list.
  const ownChips = await page.evaluate(() => {
    const ul = document.querySelector('ul[aria-label="Your selected interests"]');
    return ul ? ul.querySelectorAll('li').length : 0;
  });
  check(`[${theme}] Interests render as chips (member's own interests are pills)`, ownChips >= 1, `chips=${ownChips}`);

  // ── Interest library upgrade (feature-gap #4): the suggestion set is now a
  // larger, lightly-categorized library (labeled groups) with a calm client-side
  // filter. Assert the categories render, tapping a categorized suggestion adds a
  // chip, and a filtered suggestion still adds.
  check(`[${theme}] Suggestion library is categorized (data marker present)`,
    (await page.locator('[data-interest-library="categorized"]').count()) === 1);
  const catLabels = await page.evaluate(() => {
    const box = document.querySelector('[data-interest-library="categorized"]');
    return box ? [...box.querySelectorAll("h4")].map((h) => h.textContent.trim()) : [];
  });
  check(`[${theme}] Suggestion categories render as labeled groups`,
    catLabels.includes("Creative & making") && catLabels.includes("Music"), catLabels.join(" | "));

  const selBefore = await page.evaluate(() =>
    document.querySelector('ul[aria-label="Your selected interests"]').querySelectorAll("li").length);
  await page.getByRole("button", { name: "pottery" }).first().click();
  await page.waitForTimeout(150);
  const afterTap = await page.evaluate(() => {
    const ul = document.querySelector('ul[aria-label="Your selected interests"]');
    return { count: ul.querySelectorAll("li").length, text: ul.innerText };
  });
  check(`[${theme}] Tapping a categorized suggestion adds a chip`,
    afterTap.count === selBefore + 1 && /pottery/.test(afterTap.text), JSON.stringify(afterTap));

  await page.locator("#interest-filter").fill("astronom");
  await page.waitForTimeout(150);
  const filteredChips = await page.evaluate(() => {
    const box = document.querySelector('[data-interest-library="categorized"]');
    return [...box.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent.trim());
  });
  check(`[${theme}] Filter narrows suggestions to matches only`,
    filteredChips.length >= 1 && filteredChips.every((c) => /astronom/i.test(c)), filteredChips.join(" | "));
  await page.getByRole("button", { name: "astronomy" }).first().click();
  await page.waitForTimeout(150);
  const afterFilterAdd = await page.evaluate(() =>
    document.querySelector('ul[aria-label="Your selected interests"]').innerText);
  check(`[${theme}] Adding a filtered suggestion adds its chip`, /astronomy/.test(afterFilterAdd), afterFilterAdd);
  await page.locator("#interest-filter").fill("");

  check(`[${theme}] Looking for relationship goal present`, (await page.locator("#rel-long-term").count()) === 1);
  check(`[${theme}] Looking for seeking present`, (await page.locator("#seek-woman").count()) === 1);
  check(`[${theme}] Looking for age slider present`, (await page.getByRole("slider", { name: /minimum age/i }).count()) === 1);
  await page.locator("#distance-city").fill(`Portland ${theme}`);
  check(`[${theme}] Looking for distance city editable`, (await page.locator("#distance-city").inputValue()) === `Portland ${theme}`);
  check(`[${theme}] Looking for deal-breaker present`, (await page.locator("#db-non-smoker-label").count()) === 1);

  check(`[${theme}] Account notifications present`, (await page.locator("#notif-off").count()) === 1);
  // Membership left Account — no Membership sub-heading remains there.
  check(`[${theme}] Account no longer holds a Membership sub-heading`, !acctH3.includes("Membership"));

  // Membership group (free state): reassurance lead + honest single door, no
  // "missing out" framing, no price/urgency on the button.
  const memText = await page.evaluate(() => {
    const panel = document.getElementById("section-membership-panel");
    return panel ? panel.innerText : "";
  });
  check(`[${theme}] Membership (free) leads with 'free forever' reassurance`,
    /free forever/i.test(memText) && /Spectrum \(Free\)/.test(memText));
  check(`[${theme}] Membership (free) has the honest 'See what Companion adds' door`,
    (await page.getByRole("button", { name: /See what Companion adds/i }).count()) === 1);
  check(`[${theme}] Membership (free) uses no 'missing out'/urgency framing`,
    !/missing out|don't miss|hurry|limited time|only \$|\d+% off/i.test(memText), memText.slice(0, 120));

  // Full-page screenshot of the opened groups.
  await page.screenshot({ path: `${OUT}/profile_groups_${theme}.png`, fullPage: true });

  check(`[${theme}] no console pageerrors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

await run("dim");
await run("light");
finish();
await cleanupAccounts([acct.token]);
