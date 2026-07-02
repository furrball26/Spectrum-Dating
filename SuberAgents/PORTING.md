# Porting subagents + orchestration to another repo

How to replicate this repo's subagent roster, orchestration model, persistent
memory, and the daily self-audit in a different repository. Two paths:

- **A. Copy this setup** (fastest if you want the same structure).
- **B. Bootstrap a fresh framework** with `scripts/bootstrap-suberagents.sh`
  (scaffolds the portable pieces; you add your own agents).

---

## What's portable vs. project-specific

| Asset | Portable as-is? | Notes |
| --- | --- | --- |
| `SuberAgents/knowledge-base/` | ✅ Yes | Generic reference + rubric. Copy verbatim. |
| `SuberAgents/routines/daily-subagent-consult.md` | ✅ Yes | Cloud Routine spec. |
| `.github/workflows/daily-subagent-consult.yml` | ✅ Yes | **Adjust the cron** to the target's owner timezone. |
| `.claude/settings.json` (Agent Teams flag) | ✅ Yes | Merge the `env` flag; don't clobber existing settings. |
| `SuberAgents/knowledge-base/decisions.md` | ⚠️ Reset | Start a fresh decision log per repo. |
| `SuberAgents/audits/` | ⚠️ Reset | Audits are per-repo history; start empty. |
| `.claude/agents/*.md` (the 14-agent roster) | ❌ Project-specific | The roster is for a *dating-site* build. Keep the **structure/patterns**, rewrite the agents for the new repo's domain. |
| `.claude/agent-memory/<name>/` seeds | ❌ Regenerate | One per memory agent you keep. |
| `CLAUDE.md` automation sections | ⚠️ Adapt | Copy the SuberAgents/workflow notes; drop repo-specific facts. |
| `.claude/hooks/session-start.sh` | ⚠️ Adapt | Repo-specific; rewrite for the new project's setup. |

**Rule of thumb:** the *framework* (silo, memory pattern, orchestration model,
daily audit) is 100% portable; the *agent roster* is domain-specific and should
be rewritten (or generated) for the new repo.

---

## Path A — copy this setup

From a checkout of the target repo, with this repo available as a sibling
directory (or cloned to `/tmp/src`):

```bash
SRC=/path/to/subagenttesting        # this repo
DST=.                               # target repo root (run from its root)

# 1. Portable framework
cp -r "$SRC/SuberAgents" "$DST/"
cp "$SRC/.github/workflows/daily-subagent-consult.yml" "$DST/.github/workflows/"

# 2. Reset per-repo state
rm -rf "$DST/SuberAgents/audits"/*.md
: > "$DST/SuberAgents/knowledge-base/decisions.md"   # start an empty decision log

# 3. Agent Teams flag — MERGE, don't overwrite an existing settings.json
#    If the target has no .claude/settings.json, copy this repo's; otherwise add:
#      "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }

# 4. Agents: copy as TEMPLATES, then rewrite for the new domain
cp -r "$SRC/.claude/agents" "$DST/.claude/"   # then edit each *.md

# 5. Adjust the workflow cron to the owner's timezone (see below)
```

Then follow **"Finish up"** below.

---

## Path B — bootstrap a fresh framework

From the target repo root:

```bash
bash scripts/bootstrap-suberagents.sh      # if you copied the script in
# or run it from this repo against the target:
#   bash /path/to/subagenttesting/SuberAgents/scripts/bootstrap-suberagents.sh /path/to/target
```

It scaffolds: `SuberAgents/` skeleton (with the knowledge-base pointer), the daily
workflow, a **template memory-enabled subagent** wired correctly, its memory seed,
and the Agent Teams flag guidance. You then write your real agents (copy the
template, one per role).

---

## The one gotcha that will bite you — persistent memory

Reproduced live on Claude Code v2.1.198: when a subagent has a `tools:` allowlist,
the `memory:` field's documented Read/Write/Edit auto-enable **does not engage**
(anthropics/claude-code#57507) — memory silently writes to the repo root and never
reloads. For **every** memory-enabled agent, do all three:

1. List `Read, Write, Edit` **explicitly** in `tools`.
2. Name the exact path in the system prompt:
   `.claude/agent-memory/<name>/MEMORY.md` — read at start, update before finishing.
3. Commit a seed `MEMORY.md` at that path.

Full detail: `SuberAgents/knowledge-base/memory-and-state.md`. This is baked into
the template the bootstrap script writes.

---

## Orchestration model to carry over

- **Main thread is the conductor.** Subagents can't message each other; each
  returns a summary and lists cross-cutting work in a trailing `## Hand-offs`
  section for the orchestrator to route. Write every agent to *return* hand-offs,
  never to "call" a peer.
- **Least privilege:** design/review agents get read-only tools; implementers get
  Edit/Write/Bash. Choose `model` deliberately (opus judgment / sonnet build /
  haiku mechanical).
- **Agent Teams** (peer messaging + shared task list) stays off until explicitly
  requested; enable the flag but reach for it only for "parallel work needing live
  cross-talk." See `knowledge-base/agent-teams.md`.

---

## Finish up (both paths)

1. **Set the cron** in `daily-subagent-consult.yml` to the owner's morning. GitHub
   cron is UTC and has no DST handling, so prefer a no-DST timezone or accept the
   seasonal hour shift. Example: 9:00 AM America/Phoenix (UTC−7, no DST) →
   `cron: "0 16 * * *"` (use an off-minute like `7`).
2. **Prerequisites for the workflow** (one-time, repo admin): install the
   [Claude GitHub App](https://github.com/apps/claude) and add the
   `ANTHROPIC_API_KEY` repo secret. Until set, the job skips and stays green.
3. **Restart the session** (or use `/agents`) so new agent files load.
4. **Verify:**
   ```bash
   # every memory agent lists Read, Write, Edit
   grep -L 'Edit' .claude/agents/*.md    # (inspect matches that also set memory:)
   # no stray root MEMORY.md
   ls MEMORY.md 2>/dev/null && echo "FIX: move into .claude/agent-memory/<name>/"
   # workflow is valid + on the default branch to activate schedule/dispatch
   ```
5. **Merge to the default branch** — `schedule` and `workflow_dispatch` only run
   from the default branch.
6. **Document** the setup in the target's `CLAUDE.md` (mirror this repo's
   "SuberAgents research silo" and "daily subagent consultation" sections).
</content>
