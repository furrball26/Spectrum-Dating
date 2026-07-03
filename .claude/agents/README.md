# Spectrum Dating — autonomous frontend team

Ten agents + a shared brain + a real QA gate. Designed so a session needs one
sentence of direction ("fix X", "build Y") and ships verified work without
burning the session on coordination.

## The crew

| Agent | Role | Trigger |
|---|---|---|
| `frontend-feature-builder` | ONLY code writer; owns implement→lint→build→smoke→ship→live-verify | PROACTIVE for any code change |
| `qa-functional-tester` | Drives the real app via `scripts/qa/harness.mjs`; runs/extends `smoke.mjs` | PROACTIVE after every change |
| `design-ux-reviewer` | Screenshot-based visual review (both themes, 390px + desktop) | PROACTIVE after visual changes |
| `executive-assistant` | Picks the right-sized crew (cost tiers), synthesizes | On demand |
| `accessibility-auditor` | WCAG + calm/sensory audit | Planned reviews |
| `user-journey-tester` | First-time autistic-user friction | Planned reviews |
| `code-reviewer` | Latent bugs pre-merge | Planned reviews |
| `product-strategist` | Backlog/priority | Decisions |
| `backend-security-auditor` | Exploitability lens | Safety-critical work |
| `trust-safety-specialist` | User-harm lens | Safety-critical work |

> **File locations (monorepo split).** The frontend crew lives here in
> `.claude/agents/` (repo root). The two **backend** agents —
> `backend-security-auditor` and `trust-safety-specialist` — live in
> **`server/.claude/agents/`** so they travel with the backend subtree and
> auto-load for sessions rooted at `server/`. All ten are one logical team;
> only their files are split to match the frontend/backend boundary.

## Cost tiers (session-limit discipline)
- **Tier 1 (default, bug fixes):** builder alone — its pipeline embeds the QA
  gate. ~1 agent instead of the 6-agent panels that used to burn sessions.
- **Tier 2 (features):** builder → qa → design review, sequential.
- **Tier 3 (initiatives):** one parallel advisor panel to PLAN, then Tier-2
  loops to execute. Never re-panel for follow-up bugs.

## The files that make autonomy real
- `CLAUDE.md` (repo root) — ship pipeline, sandbox E2E recipe, product law,
  definition of done. Auto-loaded every session; agents are told to read it.
- `scripts/qa/harness.mjs` — account seeding + browser launch + API forwarding
  (the sandbox has no browser internet; this is the only way to run the app).
- `scripts/qa/smoke.mjs` — the standing regression gate (golden path + layout
  invariants from every past regression). Green smoke = shippable.
- `scripts/qa/flows_mobile.mjs` — deeper mobile flows (onboarding, swipe,
  like-back, archive/undo/restore, theme revert + sign-out reset).
- `scripts/qa/design_review_capture.mjs` — screenshots the golden-path screens
  into `qa-artifacts/` for the design reviewer.
- `docs/REVIEW_BACKLOG.md` — live checklist of open review findings.
- `docs/AUTONOMY_REPORT.md` — why the team exists / how to run autonomously.

## Installing in another repo
1. Copy `.claude/agents/` (frontend crew) AND `server/.claude/agents/` (backend
   agents) into the target repo (project-scoped) or `~/.claude/agents/`
   (user-scoped, all projects — flatten both dirs into one).
2. Copy `CLAUDE.md` and edit the header facts (URLs, branch, stack) — the
   pipeline/discipline sections transfer as-is.
3. Copy `scripts/qa/` and adjust `PROFILE_DEFAULTS`/endpoints in `harness.mjs`
   to the target backend; keep `check`/`finish`/`launch` unchanged.
4. Commit everything. The brain must live in version control — this team was
   originally lost because its files lived only in another repo's chat.
5. Keep repo `.claude/agents/` and `~/.claude/agents/` identical if you use
   both scopes (re-copy after edits).
