# SuberAgents Knowledge Base — Index

The durable reference on Claude Code subagents. Verified against the official
docs at <https://code.claude.com/docs> and Anthropic engineering material.

**Environment stamp:** Claude Code **v2.1.198**, July 2026. Re-verify claims
marked ⚠️ before relying on them — Claude Code ships frequently.

## Contents

| File | Covers |
| --- | --- |
| [`subagents-reference.md`](subagents-reference.md) | Every frontmatter field, tool allow/deny, model selection & resolution order, description-driven auto-delegation, scopes/precedence, invocation. |
| [`memory-and-state.md`](memory-and-state.md) | Persistent memory scopes and **exact storage paths**, the 200-line/25 KB injection limit, ⚠️ the `tools:`-allowlist vs `memory:` auto-enable defect (#57507) verified live, and the deterministic pattern we use. |
| [`orchestration-patterns.md`](orchestration-patterns.md) | Orchestrator-worker model, chaining, parallel fan-out, nested subagents, forks, when subagents help vs hurt, token economics. |
| [`agent-teams.md`](agent-teams.md) | Experimental Agent Teams: peer messaging + shared task list, how they differ from subagents, when to reach for them, limits. |
| [`best-practices-checklist.md`](best-practices-checklist.md) | The scored rubric the daily consultation runs against. |

## The five things that matter most (executive summary)

1. **The `description` field is the whole ballgame for autonomy.** Claude reads it
   exactly like a tool description to decide when to delegate. Make it about
   *trigger conditions* ("Use immediately after writing code", "Use proactively
   when…"), not just capability. Vague descriptions → missed or wrong delegation.

2. **Least privilege via `tools` / `disallowedTools`.** Give each agent only the
   tools its job needs. Read-only research agents should not hold Write/Edit/Bash.
   This is safety *and* focus.

3. **Model = cost/quality dial.** `opus` for judgment/design, `sonnet` for
   implementation, `haiku` for cheap high-volume/mechanical work. Default is
   `inherit`. Route deliberately.

4. **Memory is how agents stop re-deriving decisions — but it's finicky.** Scope
   is `project` / `user` / `local`, each with a *specific directory path*. A
   `tools:` allowlist currently breaks the documented auto-enable; make memory
   deterministic (explicit path in the prompt + explicit Read/Write/Edit). See
   `memory-and-state.md`.

5. **Subagents can't talk to each other — the main thread orchestrates.** For
   genuine peer-to-peer coordination you need **Agent Teams**, which are heavier
   and ~15× the tokens. Use sequential/parallel orchestration for almost
   everything else.
</content>
