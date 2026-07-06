// Shared E2E harness for Spectrum Dating QA (see CLAUDE.md → "E2E in this sandbox").
// Chromium in this environment has no internet egress, so we test the LOCAL
// build (vite preview on :4173) and forward the page's API calls to the real
// backend through Node fetch via Playwright route interception.
//
// Usage from any driver:
//   import { makeMatchedPair, seedConversation, launch, login, check, finish } from "./harness.mjs";
import { chromium } from "playwright-core";

export const API =
  process.env.QA_API_URL || "https://spectrum-dating-server-production.up.railway.app";
export const APP = process.env.QA_APP_URL || "http://127.0.0.1:4173";
export const OUT = process.env.QA_OUT_DIR || "qa-artifacts";

const CHROME =
  process.env.QA_CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

// ── Backend helpers (Node-side; Node CAN reach the backend) ──────────────────
export async function api(path, opts = {}, token) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      // QA bypass (B): if QA_BYPASS_SECRET is exported, send it so the backend
      // authLimiter skips these test registrations/logins (no effect unless the
      // same secret is configured on the server via the QA_BYPASS_SECRET env).
      ...(process.env.QA_BYPASS_SECRET ? { "X-QA-Bypass": process.env.QA_BYPASS_SECRET } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON response */ }
  return { status: r.status, body };
}

const PROFILE_DEFAULTS = {
  dateOfBirth: "1990-05-15",
  distCity: "Phoenix, AZ",
  searchRadiusMiles: 100,
  prefAgeMin: 18,
  prefAgeMax: 99,
  bio: "QA account",
  commNote: "QA",
  relationshipGoal: "long-term",
  interests: ["hiking"],
  onboardingComplete: true,
};

// Seed one profile photo so the account is ONBOARDING-COMPLETE. The backend now
// derives onboardingComplete with a "≥1 photo" requirement (real, un-bypassable
// gate), so a seeded QA account with no photo would be routed back to onboarding
// and every driver expecting the main app would break. We add a pending_review
// row via the real /photos/profile-add endpoint with a fixed key — no R2 bytes
// needed (the row is what onboardingComplete counts). Idempotent: the endpoint's
// reused-key guard 409s a second identical key, which we swallow. The photo is
// unapproved (never enters Discover) and test-account rows are already excluded
// from the moderation photo queue, so this adds zero product-facing noise.
async function ensureSeedPhoto(token, userId) {
  await api(
    "/photos/profile-add",
    { method: "POST", body: { key: `profile-photos/${userId}/seed.jpg` } },
    token
  ).catch(() => {});
}

// Register a throwaway QA account (qa+<tag><rand>@spectrum-test.dev) and
// complete its profile. Returns { token, userId, email }.
export async function makeAccount(tag, profile = {}) {
  const rid = Math.random().toString(36).slice(2, 10);
  const email = `qa+${tag}${rid}@spectrum-test.dev`;
  const reg = await api("/auth/register", {
    method: "POST",
    body: { email, password: "TestPass12345!" },
  });
  if (!reg.body?.token) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  await api("/profile/me", { method: "PUT", body: { ...PROFILE_DEFAULTS, ...profile } }, reg.body.token);
  await ensureSeedPhoto(reg.body.token, reg.body.userId);
  return { token: reg.body.token, userId: reg.body.userId, email };
}

// Reuse (A): a small pool of STABLE, persistent accounts for read-only / base
// flows that don't need a pristine account. Logs into a fixed email first and
// only registers it once (lazily), so repeated QA runs cost ~1 login instead of
// a fresh /register — sharply reducing auth-limit pressure without breaking the
// fresh-account isolation that stateful drivers (matches/reports) still rely on
// via makeAccount(). NEVER cleaned up (that's the point — it persists). Do NOT
// use this for tests that mutate match/report/block state.
const POOL_PW = "TestPass12345!";
export async function getPooledAccount(idx = 0, profile = {}) {
  const email = `qa+pool${idx}@spectrum-test.dev`;
  let res = await api("/auth/login", { method: "POST", body: { email, password: POOL_PW } });
  if (!res.body?.token) {
    // First use: create it once. (Registration is unthrottled when the QA
    // bypass secret is configured; otherwise this happens at most once per pool
    // slot until the account exists.)
    const reg = await api("/auth/register", { method: "POST", body: { email, password: POOL_PW } });
    if (!reg.body?.token) throw new Error(`pool register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    await api("/profile/me", { method: "PUT", body: { ...PROFILE_DEFAULTS, ...profile } }, reg.body.token);
    res = reg;
  } else if (Object.keys(profile).length) {
    await api("/profile/me", { method: "PUT", body: { ...PROFILE_DEFAULTS, ...profile } }, res.body.token);
  }
  // Idempotent seed photo so the pooled account stays onboarding-complete under
  // the ≥1-photo rule (also backfills pool accounts created before this rule).
  await ensureSeedPhoto(res.body.token, res.body.userId);
  return { token: res.body.token, userId: res.body.userId, email };
}

// Two accounts that mutually like each other. Returns { a, b, matchId }.
export async function makeMatchedPair(tag) {
  const a = await makeAccount(tag + "a", { displayName: "Ann QA", gender: "woman", pronouns: "she/her", seeking: "man" });
  const b = await makeAccount(tag + "b", { displayName: "Ben QA", gender: "man", pronouns: "he/him", seeking: "woman" });
  await api("/matching/swipe", { method: "POST", body: { candidateId: a.userId, decision: "like" } }, b.token);
  const sw = await api("/matching/swipe", { method: "POST", body: { candidateId: b.userId, decision: "like" } }, a.token);
  const matchId = sw.body?.matchId || sw.body?.match?.matchId;
  if (!matchId) throw new Error(`mutual match failed: ${sw.status} ${JSON.stringify(sw.body)}`);
  return { a, b, matchId };
}

// Create the conversation for a pair and send alternating messages (a first).
export async function seedConversation(pair, texts = []) {
  const cc = await api("/messaging/conversations", { method: "POST", body: { matchId: pair.matchId } }, pair.a.token);
  const convId = cc.body?.conversation?.id || cc.body?.conversationId || cc.body?.id;
  if (!convId) throw new Error(`createConversation failed: ${cc.status} ${JSON.stringify(cc.body)}`);
  for (let i = 0; i < texts.length; i++) {
    const tok = i % 2 === 0 ? pair.a.token : pair.b.token;
    await api(`/messaging/conversations/${convId}/messages`, { method: "POST", body: { body: texts[i] } }, tok);
  }
  return convId;
}

// Best-effort teardown: DELETE /account/me for each seeded token so QA runs
// don't leave qa+…@spectrum-test.dev accounts flooding the moderation board.
// Accepts tokens (strings) and/or account objects ({ token }). Swallows errors —
// cleanup must never fail a test run. Call after finish().
export async function cleanupAccounts(tokens = []) {
  for (const entry of tokens) {
    const token = typeof entry === "string" ? entry : entry?.token;
    if (!token) continue;
    try {
      await api("/account/me", { method: "DELETE" }, token);
    } catch { /* best-effort — ignore */ }
  }
}

// ── Browser (local preview + API forwarding) ─────────────────────────────────
// Returns { browser, ctx, page, errors } — errors collects console pageerrors.
export async function launch({ viewport = { width: 390, height: 844 }, hasTouch = false } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  // hasTouch makes `(pointer: coarse)` / `(hover: none)` match and enables the
  // touchscreen API — needed to test touch-only UX (long-press, coarse-pointer
  // reveals). Default off so existing desktop-pointer drivers are unaffected.
  const ctx = await browser.newContext({ viewport, hasTouch });
  const apiHost = new URL(API).host;
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (!url.includes(apiHost)) return route.continue();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS, body: "" });
    if (url.includes("/socket.io")) return route.fulfill({ status: 503, headers: CORS, body: "" });
    const h = req.headers();
    const fh = {};
    if (h.authorization) fh.authorization = h.authorization;
    if (h["content-type"]) fh["content-type"] = h["content-type"];
    try {
      const r = await fetch(url, {
        method: req.method(),
        headers: fh,
        body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData(),
      });
      return route.fulfill({
        status: r.status,
        headers: { ...CORS, "content-type": r.headers.get("content-type") || "application/json" },
        body: await r.text(),
      });
    } catch {
      return route.fulfill({ status: 502, headers: CORS, body: "{}" });
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
  return { browser, ctx, page, errors };
}

// Store auth in localStorage and land on the app, authed.
export async function login(page, acct) {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ t, u }) => {
      localStorage.setItem("spectrum_token", t);
      localStorage.setItem("spectrum_user_id", u);
    },
    { t: acct.token, u: acct.userId }
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
}

// The Profile tab now defaults to the Profile Hub (a calm home). The full edit
// form (About me / Looking for / Membership / Account groups) is a drill-in
// behind the avatar pencil. Drivers asserting edit-form content must open it via
// this helper: tap Profile → the hub, then the "Edit profile" pencil → the form.
export async function openProfileEdit(page) {
  await page.getByRole("button", { name: /^profile$/i }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const pencil = page.getByRole("button", { name: /^Edit profile$/ }).first();
  if (await pencil.count()) {
    await pencil.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
}

// ── Reporting ─────────────────────────────────────────────────────────────────
const results = [];
export function check(name, cond, extra = "") {
  const line = `${cond ? "PASS" : "FAIL"} ${name}${extra ? ` [${extra}]` : ""}`;
  results.push({ name, pass: !!cond, line });
  console.log(line);
  return !!cond;
}

// Print the summary and set the exit code. Call last.
export function finish() {
  const fails = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - fails.length}/${results.length} PASS =====`);
  if (fails.length) {
    fails.forEach((f) => console.log(f.line));
    process.exitCode = 1;
  }
  return fails.length === 0;
}
