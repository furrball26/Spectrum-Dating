# Subagent Memory & Cross-Session State

> Verified against <https://code.claude.com/docs/en/sub-agents#enable-persistent-memory>
> and <https://code.claude.com/docs/en/memory>, plus a **live reproduction** in
> this repo. Claude Code **v2.1.198**, 2026-07-01.

## The problem memory solves

Each subagent invocation is a **fresh instance with no recollection** of prior
runs. Great for one-shot research; bad for agents that make durable decisions
(design rulings, threat models, a compliance record) you don't want re-derived —
or worse, silently re-decided differently — every session. The `memory:` field
gives an agent a persistent markdown store that carries across sessions.

## Scopes and their EXACT paths

| Scope | Directory | Committed? | Use when |
| --- | --- | --- | --- |
| `user` | `~/.claude/agent-memory/<name>/` | No (machine-local) | knowledge applies across all your projects |
| `project` | `.claude/agent-memory/<name>/` | Yes (version-controlled) | project-specific, shareable via git |
| `local` | `.claude/agent-memory-local/<name>/` | No (gitignore it) | project-specific but must not be committed |

Each agent gets its **own** directory containing a `MEMORY.md` entrypoint plus any
topic files it creates. `project` is the recommended default. Note the
implication: in a **cloud/ephemeral** environment, only `project` (committed)
survives a container recycle — `user` and `local` do not.

## How injection works

- At session start, the **first 200 lines or 25 KB** of `MEMORY.md` (whichever
  comes first) is injected into the agent's system prompt, with instructions to
  curate it if it exceeds that.
- Topic files (e.g. `patterns.md`) are **not** auto-loaded; the agent reads them
  on demand. So `MEMORY.md` should be a concise **index**, with detail pushed to
  topic files.
- When memory is enabled, the docs say Read/Write/Edit are **auto-enabled** so the
  agent can manage its files. ⚠️ **This is where the trouble is.**

## ⚠️ Verified defect: `tools:` allowlist suppresses memory auto-wiring

**Upstream report:** anthropics/claude-code **#57507** (re-report of #31294);
closed "not planned." Symptom: the `memory:` auto-enable is **not additive** when
an explicit `tools:` allowlist is present — the allowlist takes precedence, and
memory files are not created/curated as documented.

**We reproduced it live in this repo (v2.1.198, 2026-07-01):**

- Invoked the `matchmaking` agent (`memory: project`, `tools: Read, Grep, Glob,
  Write, WebFetch, WebSearch` — note: **no `Edit`**) and asked it to write to its
  memory.
- It reported its memory path as the **repo root** and wrote `./MEMORY.md`
  (`/home/user/subagenttesting/MEMORY.md`) — **not** the documented
  `.claude/agent-memory/matchmaking/MEMORY.md`. `ls` confirmed the file at repo
  root and **absence** of the documented path.
- It confirmed it had **no `Edit` tool**.

**Why this is worse than "no memory":**
1. The file lands at the wrong path, so the real memory system never
   **auto-injects** it next session → the agent still starts blind.
2. Every memory agent defaults to the **same** repo-root `MEMORY.md` → they
   **overwrite each other**.
3. Without `Edit`, updates are full-file `Write` overwrites (read-then-clobber
   risk).

## The deterministic pattern we use (don't rely on auto-wiring)

Applied to all six memory agents in this repo on 2026-07-01:

1. **List `Read, Write, Edit` explicitly** in each memory agent's `tools`. (Create
   *and* curate; no dependence on the buggy auto-enable.)
2. **Name the exact path in the system prompt** so the agent reads/writes the
   right place regardless of wiring:
   > Your persistent memory is `.claude/agent-memory/<name>/MEMORY.md`. Read it at
   > the start of every task and update it before you finish.
3. **Commit seed `MEMORY.md` files** at the correct path so the first read
   succeeds and `Edit` works immediately.
4. **Keep `memory: project`** in frontmatter — harmless, documents intent, and
   will "just work" (same path) if the upstream bug is fixed.

### Alternative considered (and rejected)

Dropping the `tools:` allowlist entirely makes the documented auto-enable work —
but the agent then **inherits every tool** (Bash, Edit, MCP github/gmail/…),
violating least privilege for read-only design agents. Not worth it. Keep the
allowlist; drive memory explicitly.

## Re-test procedure (run when Claude Code updates)

1. Delete a test agent's `.claude/agent-memory/<name>/MEMORY.md`.
2. Invoke it with "read your memory, then write a dated test line to it."
3. `ls .claude/agent-memory/<name>/MEMORY.md` and confirm the write landed
   **there** (not repo root). If auto-wiring is fixed, the explicit-path prompt is
   still correct and harmless — but note the fix in the next audit.

## Related: CLAUDE.md and auto memory (main thread, not subagents)

- **CLAUDE.md** = human-authored instructions, loaded in full every session
  (target < 200 lines for adherence). Project file: `./CLAUDE.md` or
  `./.claude/CLAUDE.md`.
- **Auto memory** (v2.1.59+) = notes Claude writes itself, stored at
  `~/.claude/projects/<project>/memory/MEMORY.md`, machine-local, first 200
  lines/25 KB injected. This is the **main conversation's** memory, distinct from
  per-subagent memory above.
</content>
