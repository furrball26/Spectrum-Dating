// Audio prompt answers — member-side + gating regression.
//
// What this CAN verify in-sandbox (headless Chromium, no mic, admin 403):
//   • FREE account: the Companion-LOCKED affordance renders in the prompt editor
//     ("Voice answers are part of Spectrum Companion" + the Upgrade door), and the
//     recorder ("Answer with a voice note") is NOT offered.
//   • COMPANION (tier injected the same way profile-membership-tiers injects it):
//     the recorder IS offered; opening it shows the calm consent copy + a prompt
//     select + Start recording; clicking Start with no microphone falls back
//     CALMLY (a "microphone" message, never a crash / pageerror).
//   • Approved-audio PLAYBACK card (FREE): with a mock approved audio[] injected
//     into the profile load, the "How others see you" preview renders an <audio>
//     player AND the transcript as visible text (the a11y floor).
//
// What it CANNOT verify here (stated plainly): the real record→R2→confirm flow
// (no mic + no browser egress) and the admin review queue (QA accounts 403 on
// /admin/*). Those are covered by server vitest + code/live-bundle markers.
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/audio_prompts.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, openProfileEdit, OUT, API, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

const baseProfile = {
  displayName: "Audio QA",
  gender: "woman",
  pronouns: "she/her",
  seeking: "man",
  interests: ["hiking"],
  bio: "A bio so onboarding completes.",
};

const CLIP = {
  id: "aud_qa_1",
  promptKey: "talk_for_hours",
  url: `${API}/__qa_fake_audio.webm`, // element renders; playback is irrelevant here
  transcript: "This is my spoken answer, written out so everyone can read it too.",
  durationMs: 42000,
  reviewStatus: "approved",
  pending: false,
};

const apiHost = new URL(API).host;

async function openAboutMe(page) {
  // "About me" auto-opens for an incomplete profile; if collapsed, open it.
  const addBtn = page.getByRole("button", { name: /Add a prompt/i });
  if ((await addBtn.count()) === 0) {
    await page.getByRole("button", { name: /^About me/ }).first().click();
    await page.waitForTimeout(600);
  }
}

// ── Part A — FREE account: the locked affordance, no recorder ─────────────────
const freeAcct = await makeAccount("audiofree", baseProfile);
{
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });
  await login(page, freeAcct);
  await openProfileEdit(page);
  await page.waitForTimeout(800);
  await openAboutMe(page);

  const panelText = await page.evaluate(() => {
    const p = document.getElementById("section-aboutMe-panel");
    return p ? p.innerText : document.body.innerText;
  });
  check("FREE: locked affordance names Companion", /Voice answers are part of Spectrum Companion/.test(panelText));
  check("FREE: Upgrade door present", (await page.getByRole("button", { name: /See what Companion adds/i }).count()) >= 1);
  check("FREE: recorder is NOT offered", (await page.getByRole("button", { name: /Answer with a voice note/i }).count()) === 0);
  check("FREE: no pay-to-be-seen framing", !/more matches|be seen|3×|3x replies/i.test(panelText), panelText.slice(0, 160));
  await page.screenshot({ path: `${OUT}/audio_free_locked.png`, fullPage: true });
  check("FREE: no console pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

// ── Part B — COMPANION (injected) + approved audio card ───────────────────────
const compAcct = await makeAccount("audiocomp", baseProfile);
{
  const { browser, ctx, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    // Patch the profile load: Companion tier + a mock APPROVED audio answer.
    if (req.method() === "GET" && url.includes(apiHost) && /\/profile\/me(\?|$)/.test(url)) {
      const r = await fetch(url, { headers: { authorization: req.headers().authorization || "" } });
      let body = await r.text();
      try {
        const obj = JSON.parse(body);
        if (obj && typeof obj === "object") {
          obj.tier = "companion";
          obj.audio = [CLIP];
          body = JSON.stringify(obj);
        }
      } catch { /* leave as-is */ }
      return route.fulfill({ status: r.status, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body });
    }
    // The editor's own-audio list (GET /audio/mine) → return the same approved clip.
    if (req.method() === "GET" && url.includes(apiHost) && /\/audio\/mine(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ audio: [CLIP] }) });
    }
    return route.fallback();
  });

  await login(page, compAcct);
  await openProfileEdit(page);
  await page.waitForTimeout(900);
  await openAboutMe(page);

  // Recorder is offered to Companion; the own approved clip is listed.
  check("COMPANION: recorder offered ('Answer with a voice note')",
    (await page.getByRole("button", { name: /Answer with a voice note/i }).count()) >= 1);
  const editorText = await page.evaluate(() => {
    const p = document.getElementById("section-aboutMe-panel");
    return p ? p.innerText : "";
  });
  check("COMPANION: own approved clip shows the 'On your profile' status", /On your profile/.test(editorText));
  check("COMPANION: own clip transcript is visible", editorText.includes("written out so everyone can read it"), editorText.slice(0, 120));

  // Open the recorder → calm consent copy + prompt select + Start recording.
  await page.getByRole("button", { name: /Answer with a voice note/i }).first().click();
  await page.waitForTimeout(400);
  const recorderText = await page.evaluate(() => {
    const p = document.getElementById("section-aboutMe-panel");
    return p ? p.innerText : "";
  });
  check("COMPANION: recorder consent copy present (only record yourself)", /only record yourself/i.test(recorderText));
  check("COMPANION: reviewed-before-anyone-sees-it expectation set", /reviewed by our team before anyone can hear it/i.test(recorderText));
  check("COMPANION: prompt select present", (await page.locator("#audio-prompt-select").count()) === 1);
  const startBtn = page.getByRole("button", { name: /Start recording/i });
  check("COMPANION: Start recording button present", (await startBtn.count()) === 1);

  // Mic-denied / no-device path: pick a prompt, click Start — headless has no
  // mic, so getUserMedia rejects. Assert a CALM microphone message, no crash.
  const firstOpt = await page.locator("#audio-prompt-select option:not([value=''])").first().getAttribute("value").catch(() => null);
  if (firstOpt) {
    await page.locator("#audio-prompt-select").selectOption(firstOpt);
    await startBtn.first().click();
    await page.waitForTimeout(800);
  }
  const afterStart = await page.evaluate(() => {
    const p = document.getElementById("section-aboutMe-panel");
    return p ? p.innerText : "";
  });
  check("COMPANION: mic-denied path is calm (mentions microphone, no blame)",
    /microphone/i.test(afterStart), afterStart.slice(0, 160));
  await page.screenshot({ path: `${OUT}/audio_companion_recorder.png`, fullPage: true });

  // Approved-audio PLAYBACK card in the "How others see you" preview.
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^profile$/i }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /How others see you/i }).first().click();
  await page.waitForTimeout(1200);
  const audioCards = await page.locator("[data-audio-answer]").count();
  check("PREVIEW: approved audio renders as a card", audioCards >= 1, `cards=${audioCards}`);
  const previewAudioEls = await page.locator("[data-audio-answer] audio").count();
  check("PREVIEW: card has an <audio> player", previewAudioEls >= 1, `players=${previewAudioEls}`);
  check("PREVIEW: transcript shown as text beneath the player",
    (await page.getByText(/written out so everyone can read it too/i).count()) >= 1);
  await page.screenshot({ path: `${OUT}/audio_preview_card.png`, fullPage: true });

  check("COMPANION: no console pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

finish();
await cleanupAccounts([freeAcct.token, compAcct.token]);
