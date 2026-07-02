#!/usr/bin/env bash
#
# bootstrap-suberagents.sh — scaffold the portable SuberAgents framework into a
# target repo: silo skeleton, a correctly-wired memory-enabled template subagent,
# its memory seed, the daily self-audit workflow, and the Agent Teams flag.
#
# It does NOT copy the domain-specific agent roster — you write those (start from
# the template it creates). It never overwrites existing files.
#
# Usage:
#   bash bootstrap-suberagents.sh [TARGET_REPO_ROOT]   # default: current dir
#
# After running, see SuberAgents/PORTING.md for the full checklist (copy the real
# knowledge-base from the source repo, set the cron, add the ANTHROPIC_API_KEY
# secret + Claude GitHub App, restart the session, merge to the default branch).

set -euo pipefail

TARGET="${1:-.}"
cd "$TARGET"
echo "Scaffolding SuberAgents into: $(pwd)"

# write a file only if it does not already exist
write_if_absent() {
  local path="$1"
  if [ -e "$path" ]; then
    echo "  skip (exists): $path"
    return 1
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  echo "  created: $path"
  return 0
}

mkdir -p SuberAgents/knowledge-base SuberAgents/research SuberAgents/audits \
         SuberAgents/routines SuberAgents/scripts \
         .claude/agents .claude/agent-memory .github/workflows

# --- silo README pointer ------------------------------------------------------
write_if_absent "SuberAgents/README.md" <<'EOF' || true
# SuberAgents

Siloed knowledge base + consulting workspace for this repo's Claude Code
subagents. Scaffolded by bootstrap-suberagents.sh.

TODO: copy the full knowledge-base/ (subagents-reference, memory-and-state,
orchestration-patterns, agent-teams, best-practices-checklist) from the source
repo — see SuberAgents/PORTING.md. Audits accumulate in audits/; settled
decisions go in knowledge-base/decisions.md.
EOF

write_if_absent "SuberAgents/knowledge-base/decisions.md" <<'EOF' || true
# SuberAgents — Decision Log

Settled decisions the daily consultation must respect. Do NOT re-raise a
recorded item; reference it. Add entries with date + rationale.

_(empty — add decisions as they are made)_
EOF

# --- template memory-enabled subagent (correctly wired for #57507) ------------
write_if_absent ".claude/agents/example-specialist.md" <<'EOF' || true
---
name: example-specialist
description: >-
  TEMPLATE — replace with a real agent. Use proactively when <trigger
  condition>. Owns <one clear job>; for <adjacent concern> use <other-agent>.
tools: Read, Grep, Glob, Write, Edit
model: sonnet
color: blue
memory: project
---

You are the <role> specialist. <One-line mission and scope.>

Memory: your persistent memory is the file
`.claude/agent-memory/example-specialist/MEMORY.md` (project scope,
version-controlled). **Read it at the start of every task** and **update it
before you finish** with durable decisions and findings. Create the file if it
is missing; keep it concise (< 200 lines).

When invoked:
1. <first step>
2. <second step>
3. <return a result in a fixed format>

Boundaries: <what you do NOT do>. You cannot invoke other agents — surface
cross-cutting work in a trailing `## Hand-offs` section for the orchestrator to
route.

Output format: <structured result>. End with a `## Hand-offs` section.
EOF

write_if_absent ".claude/agent-memory/example-specialist/MEMORY.md" <<'EOF' || true
# example-specialist — persistent memory

> Auto-loaded for the `example-specialist` subagent (project scope). Only the
> first ~200 lines / 25 KB are injected — keep concise; move detail to sibling
> topic files and link them here.

## How to use this file
- Task start: read this before working.
- Task end: curate durable decisions/findings below (prefer `Edit`).

## Durable decisions
_(seed — none yet.)_
EOF

# --- daily self-audit workflow ------------------------------------------------
write_if_absent ".github/workflows/daily-subagent-consult.yml" <<'EOF' || true
name: SuberAgents Daily Consultation

# Runs the SuberAgents consultation on a schedule and opens a PR only when it has
# changes or recommendations. Gated on ANTHROPIC_API_KEY (skips + stays green
# until set). Prereqs: install the Claude GitHub App + add the secret.
# NOTE: adjust the cron below to the owner's morning (UTC; no DST handling).

on:
  schedule:
    - cron: "7 16 * * *"   # 09:07 America/Phoenix (UTC-7, no DST). CHANGE ME.
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  id-token: write

concurrency:
  group: suberagents-daily-consult
  cancel-in-progress: false

jobs:
  consult:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - name: Check configuration
        if: env.ANTHROPIC_API_KEY == ''
        run: echo "::notice::ANTHROPIC_API_KEY not set — skipping consultation."
      - name: Checkout
        if: env.ANTHROPIC_API_KEY != ''
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Run SuberAgents consultation
        if: env.ANTHROPIC_API_KEY != ''
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ env.ANTHROPIC_API_KEY }}
          claude_args: "--max-turns 40"
          prompt: |
            You are the SuberAgents subagent SME running the daily consultation.
            Read SuberAgents/knowledge-base/best-practices-checklist.md (rubric),
            SuberAgents/knowledge-base/decisions.md (settled — do NOT re-raise),
            SuberAgents/knowledge-base/memory-and-state.md, and the most recent
            SuberAgents/audits/ file. Audit every .claude/agents/*.md,
            .claude/settings.json, and .claude/agent-memory/. Check for: memory
            agents missing Read/Write/Edit or an explicit memory path; a stray
            MEMORY.md at the repo ROOT; doc drift. Write a dated report to
            SuberAgents/audits/YYYY-MM-DD-audit.md (do not overwrite prior ones).
            Apply only clearly-correct low-risk fixes; leave subjective items as
            recommendations. If there are changes or recommendations, open a PR
            titled "Daily subagent consultation: <date>" on a claude/-prefixed
            branch; otherwise end with "No changes recommended". Never push to
            the default branch directly.
EOF

# --- Agent Teams flag ---------------------------------------------------------
if [ ! -e .claude/settings.json ]; then
  write_if_absent ".claude/settings.json" <<'EOF' || true
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
EOF
else
  echo "  note: .claude/settings.json exists — to enable Agent Teams, add:"
  echo '        "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }'
fi

cat <<'DONE'

Done. Next steps (see SuberAgents/PORTING.md for the full checklist):
  1. Copy the real knowledge-base/*.md from the source repo into SuberAgents/knowledge-base/.
  2. Replace .claude/agents/example-specialist.md with your real roster (copy the
     template per role). For each memory agent: keep Read/Write/Edit + the exact
     memory path in the prompt + a committed seed MEMORY.md.
  3. Set the workflow cron to the owner's timezone.
  4. Install the Claude GitHub App + add the ANTHROPIC_API_KEY repo secret.
  5. Restart the session (or use /agents) so new agents load; merge to the
     default branch so the schedule/dispatch activate.
DONE
