// QA driver — static profile-writing assist ("ways to start" starters) + the
// richer-prompts pass (expanded catalog + prompts-as-cards).
// Proves:
//   1. On an empty answer box the calm "Need a starting point?" affordance +
//      tappable example starters render.
//   2. Tapping a starter drops it into the answer textarea as an editable draft.
//   3. Once the box has the user's own text, the starters disappear — so a tap
//      can never clobber what they wrote (the calm no-clobber guarantee).
//   4. A prompt from the EXPANDED catalog (routine_i_love) is selectable in the
//      chooser and yields a gentle starter (catalog + starter map are wired).
//   5. Answered prompts render as calm cards ([data-prompt-card]) both in the
//      editor and in the "How others see you" preview.
// Run: build + preview on :4173, then `node scripts/qa/profile-starters.mjs`.
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, openProfileEdit, api, APP, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const acct = await makeAccount("starters", { displayName: "Sam QA", gender: "nonbinary", pronouns: "they/them", seeking: "woman" });

// Seed ONE answered prompt using a NEW catalog key from the richer-prompts pass.
// This both (a) proves the new key round-trips through the backend and (b) gives
// the editor + preview an answered prompt to render as a card. talk_for_hours is
// left unanswered so it stays available for the chooser/starter flow below.
const SEED_ANSWER = "Every morning I make tea and read for a bit.";
const seed = await api(
  "/profile/prompts",
  { method: "PUT", body: { prompts: [{ promptKey: "routine_i_love", answer: SEED_ANSWER }] } },
  acct.token
);
check("Backend accepts a NEW catalog key (routine_i_love) prompt answer", seed.status === 200, `status=${seed.status}`);

const { browser, page, errors } = await launch();
await login(page, acct);

// Go to the Profile editor (Hub → avatar pencil); the prompt UI lives there.
await openProfileEdit(page);
await page.waitForTimeout(800);

// Prompts now lives as a headed block inside the "About me" GROUP (post-regroup
// there are no nested accordions — the group opens to reveal Prompts as an <h3>
// block). About me auto-opens for an incomplete profile; if it happens to be
// collapsed, open the group. "Add a prompt" is the tell that Prompts is visible.
const addBtn = page.getByRole("button", { name: /Add a prompt/i });
if ((await addBtn.count()) === 0) {
  await page.getByRole("button", { name: /^About me/ }).first().click();
  await page.waitForTimeout(600);
}

// 5a — the seeded answer renders as a card in the EDITOR (data-prompt-card).
const editorCards = await page.locator("[data-prompt-card]").count();
check("Answered prompt renders as a card in the editor", editorCards >= 1, `cards=${editorCards}`);
check("Editor card shows the answer text", (await page.getByText(/Every morning I make tea/i).count()) > 0);
await page.screenshot({ path: `${OUT}/prompt_cards_editor.png` });

// Open the prompt chooser.
await addBtn.first().click();
await page.waitForTimeout(400);

// 4 — a prompt from the EXPANDED catalog is selectable + yields a starter. Assert
// the option exists first, then select it and confirm the calm starter affordance.
const newOptCount = await page.locator('#prompt-chooser-select option[value="low_key_evening"]').count();
check("Expanded catalog exposes a new prompt (low_key_evening) as selectable", newOptCount === 1, `optCount=${newOptCount}`);
if (newOptCount === 1) {
  await page.locator("#prompt-chooser-select").selectOption("low_key_evening");
  await page.waitForTimeout(400);
  const nf = await page.getByText(/just a starting point you can change/i).count();
  const ns = await page.getByRole("button", { name: /Use this starting point/i }).count();
  check("New catalog prompt shows a gentle starter", nf > 0 && ns >= 1, `framing=${nf} starters=${ns}`);
}

// Pick a prompt whose starters we know ("Something I could talk about for hours…").
await page.locator("#prompt-chooser-select").selectOption("talk_for_hours");
await page.waitForTimeout(400);

// 1 — starters render on the empty box.
const framing = await page.getByText(/just a starting point you can change/i).count();
check("Framing copy renders on empty answer", framing > 0);

const starterBtn = page.getByRole("button", { name: /Use this starting point/i });
const starterCount = await starterBtn.count();
check("Example starters render (1–2 buttons)", starterCount >= 1 && starterCount <= 2, `count=${starterCount}`);

await page.screenshot({ path: `${OUT}/starters_empty.png` });

// Grab the first starter's text so we can assert exact insertion.
const firstStarterLabel = await starterBtn.first().getAttribute("aria-label");
const expected = (firstStarterLabel || "").replace(/^Use this starting point:\s*/, "");

// 2 — tapping inserts it into the textarea as an editable draft.
await starterBtn.first().click();
await page.waitForTimeout(400);
const inserted = await page.locator("#prompt-chooser-answer").inputValue();
check("Tapping a starter inserts it into the answer box", inserted === expected, `value="${inserted}"`);
check("Answer respects the 200-char cap", inserted.length <= 200, `len=${inserted.length}`);

// After insertion the box is non-empty → starters must be gone (no-clobber).
const startersAfter = await page.getByRole("button", { name: /Use this starting point/i }).count();
check("Starters disappear once the box has text (no clobber)", startersAfter === 0);

await page.screenshot({ path: `${OUT}/starters_inserted.png` });

// 3 — explicit no-clobber: type over it, confirm the user's own text is intact
// and that no starter can overwrite it (they stay hidden while text is present).
await page.locator("#prompt-chooser-answer").fill("My own words about steam trains.");
await page.waitForTimeout(300);
const typed = await page.locator("#prompt-chooser-answer").inputValue();
check("User's own typed text is preserved", typed === "My own words about steam trains.");
check("No starters offered while user text present", (await page.getByRole("button", { name: /Use this starting point/i }).count()) === 0);

// 5b — the answered prompt renders as a card in the "How others see you" preview.
// Reload to drop the chooser's unsaved draft (avoids the unsaved-changes dialog),
// then open the preview from the hub.
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.getByRole("button", { name: /^profile$/i }).first().click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /How others see you/i }).first().click();
await page.waitForTimeout(1200);
const previewCards = await page.locator("[data-prompt-card]").count();
check("Answered prompt renders as a card in the preview", previewCards >= 1, `cards=${previewCards}`);
check("Preview card shows the answer text", (await page.getByText(/Every morning I make tea/i).count()) > 0);
await page.screenshot({ path: `${OUT}/prompt_cards_preview.png` });

check("No console pageerrors during the flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([acct.token]);
