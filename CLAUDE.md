# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## Current state of the repository

This repository is a **sandbox for experimenting with Claude Code subagents
and automation** ("SubAgent Testing"). It has no application code yet. As of
this writing it contains:

- `README.md` — a one-line description ("SubAgent Testing").
- `CLAUDE.md` — this file.
- `.claude/` — Claude Code automation config (see "Automation setup" below).
- `.github/workflows/` — GitHub Actions (auto-review on PRs; see below).

There is **no** source code, build system, dependency manifest, test suite, CI
configuration, or linter setup in the repository. Do not assume any of these
exist or invent commands for them. The notes below are intentionally honest
about this: most "how to build / test / run" guidance cannot be written until
code is added.

> **Keep this file current.** When real code, tooling, or conventions are
> introduced, update the relevant sections below so this document reflects the
> actual state of the codebase. Remove this notice once the project is no
> longer a bare skeleton.

## Repository facts

- **Default branch:** `main`
- **Remote:** `furrball26/subagenttesting` on GitHub
- **Purpose (per README):** "SubAgent Testing" — a sandbox/testing repository.

## Git workflow

- Develop on a dedicated feature branch; do **not** commit directly to `main`.
- Use clear, descriptive commit messages.
- Push with `git push -u origin <branch-name>`.
- Do **not** open a pull request unless explicitly asked.
- GitHub operations go through the GitHub MCP tools (`mcp__github__*`), not the
  `gh` CLI (which is unavailable in this environment).

## Automation setup

This repo is configured for automated Claude Code runs. The pieces live under
`.claude/`:

```
.claude/
├── settings.json            # SessionStart hook + Agent Teams env flag
├── hooks/
│   └── session-start.sh     # runs once at the start of every session
├── agents/
│   └── test-runner.md       # a sample subagent definition
└── routines/
    └── nightly-health-check.md  # sample cloud-routine spec (template, not executed)
```

`settings.json` also enables experimental **Agent Teams** via
`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, letting a lead session spawn
teammates that message each other for genuine parallel coordination. It's opt-in
per task and off until you ask for a team; see `.claude/agents/README.md` for
when to use it and its caveats (experimental, higher token cost).

### SessionStart hook

`settings.json` wires a `SessionStart` hook to `.claude/hooks/session-start.sh`.
It runs once at the start of **every** session — interactive, headless
(`claude -p`), or cloud routine — and prints repo context (branch, HEAD) to the
session. This is the place to install dependencies and warm caches so every
automated session is reproducible; there's a `TODO` marker in the script for
exactly that. The hook is intentionally side-effect-free today because the repo
has no build tooling.

Test the hook directly with:

```bash
bash .claude/hooks/session-start.sh
```

### Sample subagent: `test-runner`

`.claude/agents/test-runner.md` defines a subagent that detects and runs the
project's test suite and reports a concise pass/fail summary. Its frontmatter
(`name`, `description`, `tools`, `model`) tells Claude when to **auto-delegate**
to it — no explicit invocation required, though you can also ask for it by name
("use the test-runner subagent"). It's a template: adjust its assumptions once a
real test suite exists.

### Domain subagents: dating site for autistic adults

`.claude/agents/` also contains a roster of specialist subagents for building a
state-of-the-art dating website for adults on the autism spectrum. They are
designed to **auto-delegate** by description. Subagents cannot call each other —
the **main conversation orchestrates**, and each agent surfaces cross-cutting
concerns in a trailing `## Hand-offs` section for the orchestrator to route. See
**`.claude/agents/README.md`** for the orchestration model, role boundaries, and
typical sequences. Each was informed by current (2025–2026) research and is told
to verify claims rather than rely on memory.

| Subagent | Focus | Model |
| --- | --- | --- |
| `user-research` | Participatory co-design *with* autistic users (distinct discipline) | opus |
| `accessibility-ux` | Neurodivergent-friendly, WCAG 2.2 AA+ UX (the core differentiator) | opus |
| `matchmaking` | Reciprocal compatibility/recommendation engine, fairness, cold-start | opus |
| `trust-safety` | Verification, moderation, anti-scam/abuse for a vulnerable population | opus |
| `privacy-compliance` | GDPR Art. 9 / CCPA, sensitive data, age assurance, EU AI Act | opus |
| `security-engineer` | AppSec, authz/IDOR, encryption, location privacy, threat modeling | opus |
| `frontend-engineer` | React/Next.js web client, sensory settings, Core Web Vitals | sonnet |
| `backend-engineer` | APIs, profiles, media pipeline, search, notifications | sonnet |
| `realtime-chat` | WebSocket messaging, conversation scaffolding, in-line safety | sonnet |
| `database-architect` | Schema/migrations, PostGIS→geosharded search, privacy-aware modeling | sonnet |
| `devops-infra` | IaC, CI/CD, observability, safe degradation of safety features | sonnet |
| `payments-subscriptions` | Ethical billing/entitlements, no dark patterns | sonnet |
| `qa-accessibility-test` | Test strategy + automated/manual a11y (axe, Playwright, screen readers) | sonnet |
| `test-runner` | Executes the suite and reports pass/fail (defers strategy to qa) | haiku |

These are starting templates: refine them as real code, a chosen stack, and user
research land. High-stakes design/judgment agents use `opus`; implementation
agents use `sonnet`.

### Sample cloud routine

`.claude/routines/nightly-health-check.md` is a **template**, not an executable
config. Cloud Routines are stored in your claude.ai account and run on
Anthropic infrastructure — there is no repo file Claude Code reads to define
one. The file documents a self-contained prompt and the settings to paste into
the routine creation form (web, Desktop, or `/schedule`), plus how to add API
or GitHub triggers. The sample routine does a nightly check that this repo's
docs match its actual state and opens a docs-sync PR only when it finds drift.

### SuberAgents research silo & daily consultation

`SuberAgents/` is a self-contained knowledge base and consulting workspace for
Claude Code subagents, orchestration, agent memory, and Agent Teams. It holds a
verified reference (`knowledge-base/`), a cited sources + live-test log
(`research/`), dated consultation reports (`audits/`), and a Cloud Routine spec
(`routines/daily-subagent-consult.md`) for a **daily** subagent audit. Start at
`SuberAgents/README.md`. Re-verify KB claims against
<https://code.claude.com/docs> after Claude Code updates.

> **Memory note (verified v2.1.198):** the six `memory: project` agents point to
> their own `.claude/agent-memory/<name>/MEMORY.md`, list `Read, Write, Edit`
> explicitly, and name that path in their prompt — because the `memory:`
> auto-enable does **not** engage reliably under a `tools:` allowlist
> (anthropics/claude-code#57507; reproduced live). Seed memory files are
> committed. Details: `SuberAgents/knowledge-base/memory-and-state.md`.

### GitHub Actions: auto-review on PRs

`.github/workflows/claude-review.yml` runs an automated Claude code review on
every non-draft PR when it's opened or updated (`pull_request: [opened,
synchronize]`). It uses `anthropics/claude-code-action@v1` with the official
`code-review` plugin and posts findings as PR comments.

The review step is **gated on the `ANTHROPIC_API_KEY` secret**: until it's set,
the job skips that step and stays green (a notice explains why) rather than
failing on every PR. Once the secret exists, the review runs automatically.

**Two one-time prerequisites** (repo admin) to actually enable reviews:

1. Install the Claude GitHub App: <https://github.com/apps/claude> (or run
   `/install-github-app` from the CLI).
2. Add an `ANTHROPIC_API_KEY` repository secret under
   Settings → Secrets and variables → Actions.

The job is scoped to `contents: read` + `pull-requests: write` and uses a
concurrency group so repeated pushes cancel stale review runs.

### GitHub Actions: daily subagent consultation

`.github/workflows/daily-subagent-consult.yml` runs the SuberAgents consultation
on a **daily schedule** (`cron: "7 16 * * *"` UTC = 9:07am America/Phoenix, which
has no DST so it never drifts) plus `workflow_dispatch` for on-demand runs. It's the durable, repo-native equivalent
of a Cloud Routine: it reads `SuberAgents/`, audits `.claude/agents/**`, writes a
dated report to `SuberAgents/audits/`, applies only clearly-correct fixes, and
opens a PR **only** when there's something to act on. Same gating as the review
workflow — skips and stays green until `ANTHROPIC_API_KEY` is set — but scoped
`contents: write` + `pull-requests: write` so it can open the audit PR. Keep its
inline prompt in sync with `SuberAgents/routines/daily-subagent-consult.md`.

### Running Claude automatically

Common ways to drive Claude/subagents here without interactive prompting:

- **Headless / scripts / CI:** `claude -p "<prompt>" --output-format json`
- **Recurring within an open session:** `/loop 5m <prompt>`
- **Unattended scheduled or event-driven runs:** Cloud Routines
  (`/schedule …` or claude.ai/code/routines) — note each run gets a *fresh
  clone*, so nothing local persists between runs.
- **On PR/push:** GitHub Actions (`anthropics/claude-code-action`) or a Routine
  with a GitHub trigger.
- **Orchestrating many subagents:** a Workflow script.

When you add new agents, hooks, or skills, document them in this section.

## Conventions to follow

Because there is no established codebase yet, follow these baseline principles
when adding the first code:

- Match the language, style, and structure already present before introducing
  a new pattern. When the project is empty, pick conventional defaults for the
  chosen language/framework and document them here.
- When you add a build, test, or run workflow, record the exact commands in a
  new "Development" section of this file so future sessions can rely on them.
- Keep `README.md` accurate as the project grows.

## When you add code, document

Update this file with at least:

1. **Project structure** — top-level directories and what each contains.
2. **Build / install** — how to install dependencies and build.
3. **Test** — how to run the test suite (and a single test).
4. **Lint / format** — the linter/formatter commands and config.
5. **Run** — how to start the app or use the library.
6. **Key conventions** — naming, module boundaries, error handling, etc.
