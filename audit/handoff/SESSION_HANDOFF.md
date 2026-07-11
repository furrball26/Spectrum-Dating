# Spectrum Dating — Session Handoff

_Self-contained handoff for a new session/repo. Everything you need to pick up where this left off._

## 1. What the product is
Calm-by-design dating app for **autistic adults**. React 18 + Vite frontend on **Vercel**
(`spectrum-dating-eta.vercel.app`); Node/Express + socket.io + JWT backend on **Railway**
(`spectrum-dating-server-production.up.railway.app`). Monorepo: frontend at repo root
(`src/`, `index.html`), backend in `server/` (own package.json / eslint / vitest). Read
`CLAUDE.md` first — it is the operating manual (ship pipeline, product law, invariants).

## 2. Infrastructure & credentials
- **Frontend**: Vercel, auto-deploys on push to `master` (~35s). Root dir `.`.
- **Backend**: Railway service `spectrum-dating-server`. **NOT git-auto-deployed** — deploy with:
  `RAILWAY_TOKEN="7767ae40-c936-4c0d-8289-fe10ae62ea06" node server/scripts/deploy.mjs`
  (runs `railway up`, health-gates on `/health` SHA match). Run from **repo root** (cwd matters).
- **Email**: Resend (`RESEND_API_KEY` set on Railway). `emailConfigured()` is now **true**.
  `EMAIL_FROM` currently = `onboarding@resend.dev` (test sender — delivers only to the Resend
  account owner's inbox, lands in spam). See §6 — mid-migration to a real domain.
- **Railway vars**: `railway variables --service spectrum-dating-server --kv` (read),
  `railway variables --set "KEY=VALUE" --service spectrum-dating-server --skip-deploys` (write),
  then redeploy via deploy.mjs to make the running process pick it up (a var change alone
  does NOT restart the container).
- **GitHub**: `furrball26/spectrum-dating`. Work branch: `claude/production-bugs-backlog-okvown`.

## 3. Ship pipeline (the ONLY correct path — from CLAUDE.md)
1. Work on branch `claude/production-bugs-backlog-okvown`.
2. `npx eslint .` → **0 errors** (frontend; `server/**` lints itself via `cd server && npm run lint`).
3. Build: `export VITE_API_URL="https://spectrum-dating-server-production.up.railway.app" && npm run build`
   (env var MUST be in the same shell invocation or every API call 404s).
4. QA gate: start `npx vite preview --port 4173` (background), then `node scripts/qa/smoke.mjs` → **11/11 PASS**.
5. Commit → `git push -u origin <branch>` → `git checkout master && git merge --ff-only <branch> && git push origin master && git checkout <branch>`.
6. Live-verify: poll `https://spectrum-dating-eta.vercel.app/` until `assets/index-*.js` hash matches
   local `dist/`, then grep the live bundle + lazy chunks (Settings/Conversation/Admin are code-split)
   for a marker string from your change. A green push is NOT proof.
- Backend changes additionally need the Railway deploy in §2. **Production deploys (Railway `deploy.mjs`,
  and sometimes the master merge) are gated by an auto-mode classifier** — they require explicit user
  approval each time; surface an AskUserQuestion and deploy only after a yes.

## 4. Current state (end of this session)
- Branch `claude/production-bugs-backlog-okvown` HEAD = **`6fedf47`**, synced to `master`, tree clean.
- **Backend live SHA = `15fd570`** (contact-comfort). The 4 commits after it (`98954ed`, `d304216`,
  `981ba90`, `6fedf47`) are **frontend-only** → no pending backend deploy. Backend is current.
- Lint 0 errors, smoke 11/11, backend suite 456/456. Two regression drivers added:
  `scripts/qa/e2e_new_features.mjs`, `scripts/qa/b567_screens.mjs` (+ a few nd_* drivers).

## 5. What shipped this session (all live & verified)
**6 customer safety complaints:**
1. Inappropriate messages hidden by default — server flags `flaggedInappropriate`
   (`server/src/utils/messageContent.js`), client collapses w/ reveal+report; sender heads-up.
2. Username profanity screen expanded (`server/src/utils/nameScreen.js`).
3. Confirm-email field at registration (`src/AuthScreen.jsx`).
4. Password reset — flow was already built; was dead only because email unconfigured (now fixed, see §6).
5. Warn/Ban reason auto-fills for every action (`communityStandards.js` `notices` map + `AdminScreen.jsx`).
6. Black History Month "heritage" theme (`a11yPrefs.js` THEMES, `index.html`, `SettingsScreen.jsx`).

**8 review-panel bugs (5-agent audit) B1–B8:** B1 voice-note report transcript now reaches moderators
(`admin.js` serializeReport + /context); B2 plain-language on UnmatchSheet/RequireCityScreen; B3 429
no longer eats typed message; B4 low-stim hides error/empty illustrations (`ReducedSensoryContext`);
B5 removed report-modal auto-close + inactivity ticking countdown; B6 withdraw uses calm modal not
`window.confirm`; B7 per-message report no longer pre-checks Block; B8 `/reports/:id` carries full evidence.

**12 neurodivergent (ND) improvements:** composer draft persistence · "what helps me/hard for me" in the
conversation card · interested-vs-intro explainer · **contact-comfort preference** (new profile enum
`contactComfort` text_only|voice_ok|video_ok, migration 061, chips everywhere) · gentle date-ideas library
· softened Likes copy · onboarding step-name clarity + directness helper · **pre-auth plain-language/low-stim
toggles** (`A11yQuickToggles.jsx`) · **onboarding save/resume + scope line** · delete→pause alternative ·
notification sound/vibration honesty copy · **Reading-comfort** a11y control (dyslexia spacing).

**Safety lane (in progress — 1 batch shipped):** opt-in **Quick-exit** ("leave now") button
(`QuickExitButton.jsx`, toggled in Safety Center) + **pattern-specific scam/grooming explainer**
(`classifySafetySignal` in `src/messaging/safetySignals.js` → specific SafetyInlineNote copy).

## 6. IN PROGRESS — email domain setup (immediate next action)
Verification/reset emails now SEND but land in **spam** because `EMAIL_FROM=onboarding@resend.dev`
(shared test sender). User owns **`spectrummingle.com`** (DNS hosted at **Linode**, ns1–5.linode.com;
clean slate, no MX/TXT yet). Plan handed to user:
1. Resend → Domains → add `spectrummingle.com` → it generates SPF/DKIM (+ MX for bounces).
2. Add those in **Linode DNS Manager** (Hostname field is RELATIVE — strip `.spectrummingle.com`;
   root = blank/@). Add DMARC TXT: host `_dmarc`, value `v=DMARC1; p=none; rua=mailto:postmaster@spectrummingle.com`.
3. Verify in Resend.
4. **THEN** (agent action) set `EMAIL_FROM="Spectrum Mingle <no-reply@spectrummingle.com>"` on Railway
   + redeploy. Do NOT set EMAIL_FROM to the domain before Resend shows it verified (unverified → sends rejected).
- Offered: agent can check DNS propagation via `https://dns.google/resolve?name=…&type=TXT|MX|NS`.
- Note: app was NOT renamed (user considered "Spectrum Mingle" — "Spectrum Dating" is trademarked —
  but chose to keep the name; spectrummingle.com is just the mail/domain).

## 7. Pending backlog (priority order)
**Safety lane (user chose this lane; continue here):**
- "Add to an existing report" (append context to a report already filed) — backend + frontend.
- Calm love-bombing/pace nudge (private, keyed off message velocity/one-sidedness).
- Filter-strength setting (always keep strong language hidden — builds on messageContent classifier).
- HELD w/ dependency: verified-only match filter (verification barely populated → would empty deck);
  trusted-contact SMS check-in escalation (needs Twilio-class vendor = client action).

**Other tiers (deferred, need effort/decisions):** quiet-hours / "pause notifications 24h" (needs backend
push scheduler) · multi-step "larger text" 125/150% (prefs-schema change, touches QA drivers) · reduced-choice
"simple mode" collapsing the 14-theme grid (touches theme-picker + QA drivers) · content-warning affordance ·
first-message card consolidation P6 (design-sensitive — pair w/ design review) · mutual question-exchange opener.
**Decided/closed:** optional-photo onboarding → user chose KEEP PHOTO MANDATORY (no change).

**Client-action items (can't be done from code — see `audit/handoff/CLIENT_ACTIONS.md`):** ADMIN_EMAILS
allowlist, VAPID push keys, Resend domain (§6), landing "who we are" copy, payments provider, CSAM/T&S vendors, ToS legal review.

## 8. Key architecture facts & gotchas
- **Product law (hard rules):** NO typing indicators, read receipts, online/last-seen, streaks, urgency,
  countdowns, gamification, fabricated metrics. ALL React hooks before any early return (React #310 has
  crashed this app). Identity themes reset on logout (trust&safety — never weaken).
- **Layout invariants smoke.mjs enforces:** no message-bubble overlap (row descendant ≤2px below row);
  Messages tab never grows page (`body.scrollHeight === window.innerHeight`, `[role="log"]` is the scroller);
  flex rows need `minWidth:0`; no console pageerrors on golden path.
- **Sandbox E2E:** Chromium here has NO internet egress. Test the LOCAL build (`vite preview` on 4173) —
  `scripts/qa/harness.mjs` forwards the page's API calls through Node fetch to the real backend. Don't
  hand-roll drivers; reuse harness.mjs/smoke.mjs. socket.io is stubbed 503 (app degrades to "Reconnecting…").
- **Backend DB:** better-sqlite3 (synchronous). Migrations are a hardcoded array in `server/src/db.js`
  (`MIGRATIONS`) — a new `.sql` file must be ADDED to that array or it won't run. Profile serializers use
  `SELECT *` so new columns flow automatically once the migration adds them.
- **Admin model:** `isAdminUser = isAdminEmail(email) || users.is_admin`. ADMIN_EMAILS env (immutable root)
  OR the DB flag via POST /admin/roles.
- **QA accounts:** `qa+<tag><rand>@spectrum-test.dev` / `TestPass12345!`. To probe the live backend safely,
  register via API, do the check, then DELETE `/account/me` with the password (always clean up).
- **Session economy:** delegate implementation to `frontend-feature-builder` (disposable context); bug fix =
  builder + qa-functional-tester only. Agent cheat sheet: `.claude/agents/README.md`. NOTE: a builder hit a
  model session limit this session (resets 5:30am UTC) — if that recurs, implement directly in the main thread.
- **Backend deploy cwd bug:** `node server/scripts/deploy.mjs` must run from repo ROOT, not `server/`
  (else it resolves `server/server/…` and MODULE_NOT_FOUND).
