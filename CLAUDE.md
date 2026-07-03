# Spectrum Dating — project brain (read me first, every session)

Calm-by-design dating app for autistic adults. React 18 + Vite → Vercel
(`spectrum-dating-eta.vercel.app`). Backend: Node/Express + socket.io + JWT on
Railway — `https://spectrum-dating-server-production.up.railway.app`, read via
`VITE_API_URL`. Styling: inline styles from `src/tokens.js` ↔ CSS variables in
`index.html` (7 themes; `dim` is the default; theme ids in `src/a11yPrefs.js`).

## Repo layout (monorepo)
- **Frontend** — repo root (`src/`, `index.html`, `scripts/qa/…`). Vercel,
  root directory `.`. This CLAUDE.md and the ship pipeline below are about the
  frontend.
- **Backend** — `server/` (Express + socket.io + JWT, own `package.json`,
  eslint config, vitest tests). Railway, root directory `server`. Deploys on
  push to `master` that touches `server/**`; see `server/RUNBOOK.md` for the
  backend's own ops. Lint/test the backend from inside `server/`
  (`cd server && npm run lint && npm test`) — the root `eslint .` ignores it.

## Ship pipeline (the ONLY correct deploy path)
1. Branch: work on `claude/spectrum-dating-audit-ty9peq` (or the session's branch).
2. `npx eslint .` → must be 0 errors (react-hooks/rules-of-hooks is a gate).
   This lints the frontend only; `server/**` is ignored (backend lints itself).
3. Build — the env var MUST be exported in the SAME shell invocation:
   `export VITE_API_URL="https://spectrum-dating-server-production.up.railway.app" && npm run build`
   (A build without it bakes `BASE_URL=""` and every API call silently 404s —
   this has produced false "site is broken" verdicts before.)
4. QA gate: `node scripts/qa/smoke.mjs` must PASS (see harness section).
5. Commit (message ends with the session's Co-Authored-By/Claude-Session lines),
   `git push -u origin <branch>`, then
   `git checkout master && git merge --ff-only <branch> && git push origin master && git checkout <branch>`.
   Vercel auto-deploys master in ~35s.
6. Live-verify: poll `https://spectrum-dating-eta.vercel.app/` until
   `assets/index-*.js` hash matches the local `dist/`, then grep the live
   bundle (and lazy chunks — Settings/Conversation are code-split) for a
   marker string from your change. A green push is NOT proof.
Do NOT use `npm run deploy` / `vercel --prod` / alias re-pointing — that path
is retired; Git integration owns deploys now.

## E2E in this sandbox (why naive testing fails)
- Chromium here has NO internet egress (every remote URL → ERR_CONNECTION_CLOSED).
  You cannot load the live site in a browser. Test the LOCAL build instead:
  `npx vite preview --port 4173` (run_in_background) serving `dist/`.
- The page's API calls are forwarded by Playwright route interception through
  Node `fetch` (Node CAN reach the backend). `scripts/qa/harness.mjs` does all
  of this — use it; do not hand-roll new drivers.
- socket.io requests are fulfilled with 503 (harmless — the app degrades).
- Write driver scripts with the Write tool and run `node file.mjs` from the
  repo root (playwright-core resolves from repo node_modules). Avoid heredoc +
  backgrounding in one Bash call (exit-144 class failures).
- QA accounts: `qa+<tag><rand>@spectrum-test.dev` / `TestPass12345!`; profile
  enums: relationshipGoal `long-term`; seeking `man|woman|nonbinary`; mutual
  `/matching/swipe` likes create a match. The harness seeds all of this.

## Definition of done (no exceptions)
lint 0 errors → build with env var → `smoke.mjs` PASS → shipped via ff-merge →
live bundle verified → report includes evidence (measurements/screenshots),
not adjectives.

## Product law (calm-by-design — hard rules)
- NO typing indicators, read receipts, online/last-seen, streaks, urgency,
  countdowns, gamification, fabricated metrics.
- ALL React hooks before any early return (React #310 has crashed this app).
- Coarse location only. Reduced-sensory fallbacks for all decoration.
- Identity themes (pride/trans): reset on logout, double-tap-mark revert,
  client-side only — never weaken these (trust & safety requirements).

## Layout invariants smoke.mjs enforces (past regressions)
- No message-bubble overlap: no row descendant may extend >2px below its row.
- Messages tab never grows the page: `body.scrollHeight === window.innerHeight`;
  the `[role="log"]` is the scroller (scrollbar hidden via `.hide-scrollbar`).
- Flex rows need `minWidth: 0` (name-truncation/overlap class).
- No console pageerrors anywhere on the golden path.

## Session economy (how to not hit limits)
- Delegate implementation to `frontend-feature-builder` (its context is
  disposable; keep the main thread for decisions).
- Bug fix = builder + qa-functional-tester ONLY. Full 6-agent panels are for
  big design decisions, at most once per initiative — never for bug rounds.
- Reuse `scripts/qa/harness.mjs`/`smoke.mjs`; never write one-off E2E drivers.
- Batch related edits; one build+smoke per batch, not per edit.
- Agent team cheat sheet: `.claude/agents/README.md`.
