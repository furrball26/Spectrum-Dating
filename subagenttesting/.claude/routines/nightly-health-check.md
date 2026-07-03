# Sample Cloud Routine — Nightly Health Check

> **What this file is.** Cloud Routines are *not* defined by a file in the
> repository — they are a saved configuration (prompt + repositories +
> environment + triggers) stored in your claude.ai account and run on
> Anthropic-managed cloud infrastructure. This file is a **template**: copy the
> prompt and settings below into the routine creation form. Claude Code does
> not read or execute this file automatically.
>
> Create routines at <https://claude.ai/code/routines>, in the Desktop app
> (Routines → New routine → Remote), or from the CLI with `/schedule`.

## Routine settings

| Field         | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| **Name**      | Nightly health check                                               |
| **Repository**| `furrball26/subagenttesting`                                       |
| **Model**     | (your default; a smaller model is fine for this task)              |
| **Environment** | Default (Trusted network)                                        |
| **Branch push** | Default — Claude pushes only to `claude/`-prefixed branches      |
| **Trigger**   | Schedule → daily (e.g. nightly)                                    |

## Prompt (paste into the routine's Instructions box)

Routines run autonomously with no approval prompts, so the prompt must be
self-contained and explicit about success criteria. Use this:

```
You are running an unattended nightly health check on the subagenttesting repo.

Do the following and stop:

1. Read CLAUDE.md and README.md.
2. Inspect the repo's actual state: list top-level files/dirs, detect any
   build/dependency manifests (package.json, pyproject.toml, Cargo.toml,
   go.mod), test config, and CI workflows under .github/.
3. Compare what you find against what CLAUDE.md claims. Look specifically for
   drift: tooling that now exists but isn't documented, documented sections
   that are stale, or the ".claude/" automation setup having changed.
4. If — and only if — you find a concrete discrepancy, update CLAUDE.md (and
   README.md if needed) to match reality, then commit to a claude/-prefixed
   branch and open a pull request titled "Nightly health check: docs sync".
   Keep the diff minimal and factual; do not invent tooling.
5. If everything is already accurate, make NO commit and NO PR. End your run
   with a one-line summary stating "No drift found."

Never push to main. Do not add dependencies or run installers.
```

## How to create it

**From the CLI** (creates a scheduled routine conversationally):

```text
/schedule daily, run the subagenttesting nightly health check
```

Then paste the prompt above when asked, and select the
`furrball26/subagenttesting` repository.

**From the web:** go to <https://claude.ai/code/routines> → **New routine**,
fill in the table above, paste the prompt, and pick a **Schedule** trigger.

## Optional: add an API or GitHub trigger

A routine can combine triggers. After saving, edit the routine on the web to
add either:

- **API trigger** — generates a per-routine `/fire` endpoint + bearer token so
  an external system can run it on demand:

  ```bash
  curl -X POST https://api.anthropic.com/v1/claude_code/routines/<trigger-id>/fire \
    -H "Authorization: Bearer <your-routine-token>" \
    -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"text": "optional run-specific context"}'
  ```

- **GitHub trigger** — e.g. run on `pull_request.opened` (requires installing
  the Claude GitHub App on the repo).

## Notes & caveats

- **Fresh clone each run.** Routines start from the default branch and keep no
  local state between runs — anything to persist must be committed/pushed.
- **Minimum schedule interval is one hour**; sub-hourly cron is rejected.
- **A green run status only means the session started and exited cleanly** — it
  does not mean the task succeeded. Open the run to confirm.
- Routines belong to your individual account, consume your subscription usage,
  and act as *you* (commits/PRs carry your GitHub identity).
