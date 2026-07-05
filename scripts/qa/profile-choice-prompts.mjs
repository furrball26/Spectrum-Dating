// QA driver — typed low-pressure "choice" prompts (profile redesign §3b).
// Proves:
//   1. A choice prompt (ch_time_of_day) is selectable in the chooser and renders
//      an accessible single-select radiogroup of its options (not a textarea).
//   2. Picking an option enables "Add prompt"; the pick is saved to the backend.
//   3. The saved choice renders as a CARD ([data-prompt-card]) in the editor AND
//      in the "How others see you" preview, showing the chosen option as the
//      prominent content and the prompt text as the quiet eyebrow.
//   4. HARD GUARDRAIL: NO vote/count/%/"most popular"/tally surface anywhere —
//      the card shows the person's pick only, exactly like a text answer.
// Run: build + preview on :4173, then `node scripts/qa/profile-choice-prompts.mjs`.
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, openProfileEdit, api, APP, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const acct = await makeAccount("choiceprompt", { displayName: "Robin QA", gender: "nonbinary", pronouns: "they/them", seeking: "man" });

// ── Backend contract first: the catalog exposes typed choice prompts, a valid
// pick saves, and a bogus pick is rejected. (Belt-and-suspenders alongside the
// vitest suite — proves it end to end against the real server the UI talks to.)
const cat = await api("/profile/prompt-catalog", {}, acct.token);
const choiceDef = (cat.body?.prompts || []).find((p) => p.key === "ch_time_of_day");
check("Catalog exposes a choice prompt with type + options", !!choiceDef && choiceDef.type === "choice" && Array.isArray(choiceDef.options), `def=${JSON.stringify(choiceDef)}`);

const goodPick = await api(
  "/profile/prompts",
  { method: "PUT", body: { prompts: [{ promptKey: "ch_time_of_day", answer: "Evenings" }] } },
  acct.token
);
check("Backend accepts a valid choice pick", goodPick.status === 200, `status=${goodPick.status}`);
check("Saved choice comes back typed 'choice' with options", goodPick.body?.prompts?.[0]?.promptType === "choice" && Array.isArray(goodPick.body?.prompts?.[0]?.options), JSON.stringify(goodPick.body?.prompts?.[0]));

const badPick = await api(
  "/profile/prompts",
  { method: "PUT", body: { prompts: [{ promptKey: "ch_time_of_day", answer: "Afternoons" }] } },
  acct.token
);
check("Backend rejects a choice value that isn't an option (400)", badPick.status === 400, `status=${badPick.status}`);

// Re-seed the valid pick (the bad request above didn't change stored data, but be
// explicit) so the UI has an answered choice prompt to render as a card.
await api(
  "/profile/prompts",
  { method: "PUT", body: { prompts: [{ promptKey: "ch_time_of_day", answer: "Evenings" }] } },
  acct.token
);

const { browser, page, errors } = await launch();
await login(page, acct);

await openProfileEdit(page);
await page.waitForTimeout(800);

// About me auto-opens for an incomplete profile; if collapsed, open it. "Add a
// prompt" is the tell that the Prompts block is visible.
const addBtn = page.getByRole("button", { name: /Add a prompt/i });
if ((await addBtn.count()) === 0) {
  await page.getByRole("button", { name: /^About me/ }).first().click();
  await page.waitForTimeout(600);
}

// 3a — the seeded choice renders as a card in the EDITOR, as a radiogroup with the
// chosen option checked.
const editorCards = await page.locator("[data-prompt-card]").count();
check("Answered choice renders as a card in the editor", editorCards >= 1, `cards=${editorCards}`);
const editorRadiogroup = await page.locator('[data-prompt-card] [role="radiogroup"]').count();
check("Editor choice card renders an accessible radiogroup", editorRadiogroup >= 1, `groups=${editorRadiogroup}`);
const eveningChecked = await page.locator('[data-prompt-card] input[type="radio"][value="Evenings"]').isChecked().catch(() => false);
check("The chosen option (Evenings) is the selected radio", eveningChecked === true);
await page.screenshot({ path: `${OUT}/choice_editor.png` });

// 1 + 2 — open the chooser, select a DIFFERENT choice prompt, confirm it renders
// a radiogroup (not a textarea) and that picking an option enables Add.
await addBtn.first().click();
await page.waitForTimeout(400);
const optExists = await page.locator('#prompt-chooser-select option[value="ch_text_or_call"]').count();
check("Chooser exposes another choice prompt (ch_text_or_call)", optExists === 1, `opt=${optExists}`);
await page.locator("#prompt-chooser-select").selectOption("ch_text_or_call");
await page.waitForTimeout(400);
const chooserRadios = await page.locator('[role="radiogroup"] input[type="radio"]').count();
check("Choice prompt shows radio options in the chooser (not a textarea)", chooserRadios >= 2, `radios=${chooserRadios}`);
const chooserTextarea = await page.locator("#prompt-chooser-answer").count();
check("No free-text textarea is shown for a choice prompt", chooserTextarea === 0, `textareas=${chooserTextarea}`);

// Pick an option → Add prompt becomes enabled.
await page.getByRole("radio", { name: "Either is fine" }).check();
await page.waitForTimeout(300);
const addEnabled = await page.getByRole("button", { name: /^Add prompt$/ }).isEnabled();
check("Picking an option enables Add prompt", addEnabled === true);
await page.screenshot({ path: `${OUT}/choice_chooser.png` });

// 3b + 4 — the choice prompt renders as a card in the "How others see you" preview,
// showing the chosen option, with NO vote/count/tally surface anywhere.
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.getByRole("button", { name: /^profile$/i }).first().click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /How others see you/i }).first().click();
await page.waitForTimeout(1200);

const previewCards = await page.locator("[data-prompt-card]").count();
check("Answered choice renders as a card in the preview", previewCards >= 1, `cards=${previewCards}`);
check("Preview card shows the chosen option (Evenings)", (await page.getByText(/^Evenings$/).count()) > 0);
check("Preview card shows the prompt text (Mornings or evenings?)", (await page.getByText(/Mornings or evenings\?/i).count()) > 0);

// GUARDRAIL: scan the whole rendered preview for any aggregate/vote surface.
const previewText = await page.locator("body").innerText();
const votey = /\b\d+\s*%|\bvotes?\b|most popular|chose this|people picked|out of \d+|tally|poll results/i;
check("GUARDRAIL: no vote/count/%/'most popular' surface in the preview", !votey.test(previewText), `matched="${(previewText.match(votey) || [])[0] || ""}"`);
await page.screenshot({ path: `${OUT}/choice_preview.png` });

check("No console pageerrors during the flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([acct.token]);
