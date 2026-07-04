// Standing driver for the calm "Profile review" (identity-verification) explainer.
// Proves: a fresh (not-yet-requested) account opens Profile → Profile review and
// sees the guided "what to expect" steps + the "what this is / isn't" reassurance
// in the default state, and the existing free request button still moves the card
// to the reassuring pending state. FRONTEND-ONLY — the badge stays 100% free.
//
//   export VITE_API_URL=… && npm run build
//   npx vite preview --port 4173   (background)
//   node scripts/qa/verification-flow.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeAccount, launch, login, check, finish, cleanupAccounts, OUT } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });
const acct = await makeAccount("verif", { displayName: "Vera QA", gender: "woman", pronouns: "she/her", seeking: "man" });

const { browser, page, errors } = await launch();
await login(page, acct);

// Go to Profile and open the "Account" group (Profile review now lives inside it
// as a headed <h3> block — post-regroup there are no nested accordions, so
// opening the group reveals the review sub-section directly).
await page.getByRole("button", { name: /Profile/ }).first().click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Account/ }).first().click();
await page.waitForTimeout(800);

const sectionText = await page.locator("body").innerText();

// The Account group now holds Profile review, Notifications and Membership as
// headed blocks in one scroll (no nested accordions). Membership legitimately
// mentions "Companion", so the "no paid coupling" assertion must be SCOPED to
// just the Profile review block (between its <h3> and the next block's heading),
// not the whole body.
const _revStart = sectionText.indexOf("Profile review");
const _revEnd = sectionText.indexOf("Notifications", _revStart);
const reviewText = _revStart >= 0 && _revEnd > _revStart
  ? sectionText.slice(_revStart, _revEnd)
  : sectionText;

// 1 — guided steps present (default first-time state)
check(
  "Guided 'what happens' steps shown",
  /What happens when you ask for a review/.test(sectionText) &&
    /one tap, that's it\./.test(sectionText) &&
    /A real person on our team looks over your profile\./.test(sectionText)
);
// 2 — 'what this is — and isn't' reassurance present
check(
  "'What this is — and isn't' reassurance shown",
  /What this is — and isn't/.test(sectionText) &&
    /It is not an ID or document upload\./.test(sectionText) &&
    /Nothing is stored beyond the badge itself\./.test(sectionText)
);
// 3 — gentle optional tips present, framed as not-required
check(
  "Gentle optional tips shown (not gates)",
  /A couple of things that help/.test(sectionText) &&
    /These aren't required/.test(sectionText) &&
    /A clear main photo\./.test(sectionText)
);
// 4 — no payment / Companion coupling in the Profile review block itself
// (scoped — the Membership block in this same group is allowed to say Companion)
check(
  "No payment/Companion coupling near verification",
  !/companion|upgrade|subscribe|premium|\$\d|per month/i.test(reviewText),
  "found paid-tier language"
);
await page.screenshot({ path: `${OUT}/verif_default.png` });

// 5 — the existing free request button still works → moves to pending.
// Scope both the pending-state assertion AND the no-urgency assertion to the
// Profile review block: the About me group auto-opens for this incomplete
// profile, and its "Could talk for hours about" heading would otherwise
// false-match the anti-countdown /hours/ guard on a whole-body scan.
await page.getByRole("button", { name: /^Request review$/ }).click();
await page.waitForTimeout(2500);
const afterText = await page.locator("body").innerText();
const _aStart = afterText.indexOf("Profile review");
const _aEnd = afterText.indexOf("Notifications", _aStart);
const afterReviewText = _aStart >= 0 && _aEnd > _aStart
  ? afterText.slice(_aStart, _aEnd)
  : afterText;
check(
  "Request button moves card to reassuring pending state",
  /Review request received\.|Pending review/.test(afterReviewText) &&
    !/countdown|minutes|hours|days left/i.test(afterReviewText)
);
await page.screenshot({ path: `${OUT}/verif_pending.png` });

// 6 — no console pageerrors across the flow (React #310 guard)
check("No console pageerrors on the verification flow", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

await cleanupAccounts([acct.token]);
