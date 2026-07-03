// Contrast-fill regression driver (DSGN-1..7).
//
// Root cause it guards: hand-rolled buttons/pills used `t.accentStrong` /
// `t.danger` as a SOLID FILL under white text. Those tokens are LIGHT TINTS in
// dark themes (dim/navy), so white-on-them fails WCAG-AA (~2.1:1 accentStrong,
// ~2.6:1 danger). The correct fills are `t.accentFill` / `t.dangerFill` (≥4.5:1
// in every theme). This driver:
//   1. Reads the REAL computed background + text colour of each fixed button in
//      the live DOM (dim + navy) and asserts the WCAG contrast ratio.
//   2. Backstops with a token-level check: white-on-(accentFill|dangerFill) in
//      dim + navy (covers the fills that are costly to reach — profile toast,
//      photo-remove confirm, account-delete confirm).
//   3. Verifies the MatchMoment scrim: white heading + subline pass on the
//      scrim over the theme gradient in `light` (and dim, no-regression).
//   4. Captures 390px dim+light screenshots of the fixed surfaces.
//
// Run from repo root:  node scripts/qa/contrast-fills.mjs   (exit 0 = PASS)
import { mkdirSync } from "node:fs";
import { makeMatchedPair, seedConversation, launch, login, check, finish, OUT, APP } from "./harness.mjs";

mkdirSync(OUT, { recursive: true });

// ── WCAG contrast helpers ────────────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a, b) {
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map((s) => parseFloat(s.trim()));
  return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
}
function hexToRgb(h) {
  h = h.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// composite a (possibly translucent) colour over an opaque backdrop
const over = (fg, bg) => {
  const a = fg[3] ?? 1;
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
};
const r2 = (n) => Math.round(n * 100) / 100;

// Read the computed fill + text colour of a button and assert AA. `min` is the
// threshold (4.5 normal, 3.0 large-bold). Text and fill are composited over an
// assumed opaque backdrop only if translucent (buttons here are opaque).
async function assertButton(page, locator, label, theme, min = 4.5) {
  const el = locator.first();
  if ((await el.count()) === 0) { check(`[${theme}] ${label} — button present`, false); return; }
  const { bg, fg } = await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const bgc = parseColor(bg), fgc = parseColor(fg);
  // Fill is opaque; text is opaque #fff. If either were translucent, composite
  // the text over the fill (and the fill over white) before measuring.
  const bgOpaque = over(bgc, [255, 255, 255]);
  const fgOver = over(fgc, bgOpaque);
  const ratio = contrast(fgOver, bgOpaque);
  check(`[${theme}] ${label} white-on-fill ≥${min}:1`, ratio >= min,
    `${r2(ratio)}:1  fill=${bg} text=${fg}`);
  return ratio;
}

async function setThemeReload(page, theme) {
  await page.evaluate((th) => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem("spectrum_a11y") || "{}") || {}; } catch { /* noop */ }
    localStorage.setItem("spectrum_a11y", JSON.stringify({ ...raw, theme: th }));
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/contrast_${name}.png` });

// ═════════════════════════════════════════════════════════════════════════════
const pair = await makeMatchedPair("contrast");
await seedConversation(pair, ["QA seed one — please ignore.", "QA seed two — please ignore."]);

const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 } });

// ── PHASE A — pre-auth: Landing CTAs + Auth submit (no login needed) ─────────
await page.goto(APP, { waitUntil: "domcontentloaded" }); // establish origin for localStorage
await page.waitForTimeout(1500);
for (const theme of ["dim", "navy", "light"]) {
  await setThemeReload(page, theme); // reload lands on the marketing LandingScreen
  const cta = page.getByRole("button", { name: "Create your profile" });
  check(`[${theme}] Landing has both "Create your profile" CTAs`, (await cta.count()) >= 2,
    `count=${await cta.count()}`);
  if (theme !== "light") {
    await assertButton(page, cta, "Landing 'Create your profile'", theme);
  }
  if (theme === "dim" || theme === "light") await shot(page, `landing_${theme}`);

  // Into the register form.
  await cta.first().click();
  await page.waitForTimeout(1200);
  const submit = page.getByRole("button", { name: "Create account" });
  if (theme !== "light") await assertButton(page, submit, "Auth 'Create account' submit", theme);
  if (theme === "dim" || theme === "light") await shot(page, `auth_${theme}`);
}

// ── PHASE B — authed: Profile "Pause my profile" + Block/Report submit ───────
await login(page, pair.a);
for (const theme of ["dim", "navy", "light"]) {
  await setThemeReload(page, theme); // authed reload → Discover

  // Profile → pause button
  await page.locator('nav[aria-label="Primary"] button').filter({ hasText: "Profile" }).first().click();
  await page.waitForTimeout(1600);
  const pause = page.getByRole("button", { name: "Pause my profile" });
  if (theme !== "light") await assertButton(page, pause, "Profile 'Pause my profile'", theme);
  if (theme === "dim" || theme === "light") await shot(page, `profile_pause_${theme}`);

  // Messages → conversation → Block and report (full page) → enable submit
  await page.locator('nav[aria-label="Primary"] button').filter({ hasText: "Messages" }).first().click();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: /Ben QA/ }).first().click();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /Conversation options/ }).click();
  await page.getByRole("menuitem", { name: /Block and report/ }).click();
  await page.waitForTimeout(1400);
  await page.getByText(/Report to our team/).click();
  await page.locator('input[name="reason"]').first().check();
  await page.waitForTimeout(300);
  const brSubmit = page.getByRole("button", { name: /Block and report/ });
  await brSubmit.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  if (theme !== "light") await assertButton(page, brSubmit, "BlockReport submit", theme);
  if (theme === "dim" || theme === "light") await shot(page, `blockreport_${theme}`);
}

// ── PHASE C — token backstop: white-on-fill in dim + navy ────────────────────
// Covers every remaining fixed fill (save-error toast, photo-remove confirm,
// account-delete confirm) which all route through these two tokens.
for (const theme of ["dim", "navy"]) {
  const vals = await page.evaluate((th) => {
    document.documentElement.dataset.theme = th;
    const cs = getComputedStyle(document.documentElement);
    return {
      accentFill: cs.getPropertyValue("--c-accentFill").trim(),
      dangerFill: cs.getPropertyValue("--c-dangerFill").trim(),
    };
  }, theme);
  const aR = contrast([255, 255, 255], hexToRgb(vals.accentFill));
  const dR = contrast([255, 255, 255], hexToRgb(vals.dangerFill));
  check(`[${theme}] token white-on-accentFill ≥4.5:1`, aR >= 4.5, `${r2(aR)}:1 (${vals.accentFill})`);
  check(`[${theme}] token white-on-dangerFill ≥4.5:1`, dR >= 4.5, `${r2(dR)}:1 (${vals.dangerFill})`);
}

// ── PHASE D — MatchMoment scrim (DSGN-7): white text over 70% scrim + gradient ─
// Worst case = the LIGHTEST gradient stop (highest backdrop luminance → lowest
// contrast). Heading #FFFFFF (26px large-bold → 3:1), subline #F4F5F2 (16px → 4.5:1).
for (const theme of ["light", "dim"]) {
  const info = await page.evaluate((th) => {
    document.documentElement.dataset.theme = th;
    const cs = getComputedStyle(document.documentElement);
    return {
      scrim: cs.getPropertyValue("--c-scrimRgb").trim(),
      grad: cs.getPropertyValue("--c-bg-gradient").trim(),
    };
  }, theme);
  const scrim = info.scrim.split(",").map((s) => parseFloat(s.trim()));
  const stops = (info.grad.match(/#([0-9a-fA-F]{3,6})/g) || ["#F6F4EF"]).map(hexToRgb);
  const lightest = stops.reduce((a, b) => (lum(b) > lum(a) ? b : a), stops[0]);
  const backdrop = over([scrim[0], scrim[1], scrim[2], 0.70], lightest); // scrim over gradient
  const headingR = contrast([255, 255, 255], backdrop);
  const sublineR = contrast(hexToRgb("#F4F5F2"), backdrop);
  check(`[${theme}] MatchMoment heading white ≥3:1 on scrim`, headingR >= 3.0,
    `${r2(headingR)}:1 backdrop=${backdrop.map(Math.round)}`);
  check(`[${theme}] MatchMoment subline #F4F5F2 ≥4.5:1 on scrim`, sublineR >= 4.5,
    `${r2(sublineR)}:1`);
}

check("No console pageerrors during contrast run", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();
