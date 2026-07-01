# Daily Subagent Consultation

> **Two ways to run this daily.** Pick one:
>
> 1. **GitHub Actions (durable, repo-native — already committed).**
>    `.github/workflows/daily-subagent-consult.yml` runs this on GitHub's cron
>    (`workflow_dispatch` too). Nothing to set up beyond the one-time
>    `ANTHROPIC_API_KEY` secret + Claude GitHub App (same as the review workflow).
>    Runs independently of any Claude Code session. **This is the recommended
>    default.** Keep its inline prompt in sync with the prompt below.
> 2. **Cloud Routine (your claude.ai account).** The steps below. Use this if you
>    prefer routines over Actions, or want it to act under your GitHub identity.

## Cloud Routine setup

> **What this file is.** Cloud Routines are **not** defined by a repo file — they
> are a saved configuration (prompt + repo + environment + trigger) stored in your
> claude.ai account and run on Anthropic infrastructure. This file is a
> **template**: paste the prompt and settings below into the routine creation form.
> Claude Code does not read or execute this file automatically.
>
> Create at <https://claude.ai/code/routines>, in the Desktop app
> (Routines → New routine → Remote), or via `/schedule`.

## Routine settings

| Field | Value |
| --- | --- |
| **Name** | Daily subagent consultation |
| **Repository** | `furrball26/subagenttesting` |
| **Model** | Your default (Opus/Sonnet recommended — this is a judgment task) |
| **Environment** | Default (Trusted network) |
| **Branch push** | Default — `claude/`-prefixed branches only |
| **Trigger** | Schedule → daily, morning (min interval is 1 hour) |

## Prompt (paste into the routine's Instructions box)

Routines run autonomously with no approval prompts, so the prompt is
self-contained. Each run gets a **fresh clone**, so it reads the committed
knowledge base — nothing local persists between runs.

```
You are the SuberAgents subagent SME running the daily consultation on the
subagenttesting repo. Work autonomously and stop when done.

1. Read, in order:
   - SuberAgents/knowledge-base/best-practices-checklist.md  (your rubric)
   - SuberAgents/knowledge-base/memory-and-state.md          (the #57507 caveat)
   - SuberAgents/knowledge-base/00-index.md                  (context)
   - the most recent file in SuberAgents/audits/             (yesterday's findings)

2. Establish today's date and the Claude Code version (`claude --version`). If the
   version changed since the last audit, re-verify the memory behavior using the
   "Re-test procedure" in memory-and-state.md and note any change.

3. Audit the CURRENT state: every .claude/agents/*.md, .claude/settings.json, and
   .claude/agent-memory/. Score each rubric item pass / improve / fail. Check
   specifically for: memory agents missing Read/Write/Edit or an explicit memory
   path; any stray MEMORY.md at the repo ROOT (a bug symptom — flag it); doc drift
   in README/CLAUDE.md; new agents added without documentation.

4. Write a dated report SuberAgents/audits/YYYY-MM-DD-audit.md: verdict,
   findings ranked by impact × confidence (each with an exact fix/diff), what's
   already good, and the top 3 actions. Do NOT overwrite prior audits.

5. Apply ONLY clearly-correct, low-risk fixes directly (e.g. a memory agent missing
   its Edit tool, a wrong path in docs, a stray root MEMORY.md). Leave anything
   subjective (description wording, model changes, scope changes) as a
   recommendation in the report for owner approval — do not apply those.

6. If you made any change OR the report contains actionable recommendations, commit
   to a claude/-prefixed branch and open a pull request titled
   "Daily subagent consultation: <date>". If everything is already optimal and
   there are no recommendations, make NO commit and NO PR; end with a one-line
   "No changes recommended" summary.

Never push to main. Do not add dependencies or run installers. Verify claims
against https://code.claude.com/docs before relying on them.
```

## How to create it

**From the CLI:**
```text
/schedule daily each morning, run the SuberAgents subagent consultation
```
Then paste the prompt above and select the `furrball26/subagenttesting` repo.

**From the web:** <https://claude.ai/code/routines> → **New routine** → fill the
table → paste the prompt → pick a **Schedule** (daily) trigger.

## Optional triggers

- **GitHub trigger** — also run on `pull_request.opened` to review changes to
  `.claude/agents/**` as they land (requires the Claude GitHub App on the repo).
- **API trigger** — generates a `/fire` endpoint + token to run on demand.

## Caveats

- **Fresh clone each run** — only committed files (the whole `SuberAgents/` KB and
  `.claude/`) are visible; nothing local persists.
- **Minimum schedule interval is one hour.**
- **A green run status only means the session started and exited cleanly** — open
  the run (or the PR) to confirm the audit actually happened.
- Routines act as **you** (commits/PRs carry your GitHub identity) and consume your
  subscription usage.
</content>
