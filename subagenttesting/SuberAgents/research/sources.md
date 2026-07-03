# Research Sources & Findings Log

Primary, verified sources behind the knowledge base, plus the live-test log. When
Claude Code updates, re-fetch the official docs and update the KB + version stamps.

## Primary (authoritative)

- **Create custom subagents** — <https://code.claude.com/docs/en/sub-agents>
  (full frontmatter table, tool allow/deny resolution, model resolution order,
  scopes/precedence, built-ins, nesting, forks, resume, memory section).
- **How Claude remembers your project** — <https://code.claude.com/docs/en/memory>
  (CLAUDE.md vs auto memory, 200-line/25 KB injection, storage paths).
- **Orchestrate teams of Claude Code sessions** —
  <https://code.claude.com/docs/en/agent-teams>.
- **How and when to use subagents in Claude Code** (Anthropic) —
  <https://claude.com/blog/subagents-in-claude-code>.
- **Building a multi-agent research system** (Anthropic Engineering) —
  <https://www.anthropic.com/engineering/built-multi-agent-research-system>
  (orchestrator-worker, token economics, when multi-agent helps/hurts, prompt
  principles, eval).
- **Bug #57507** — `memory:` field vs `tools:` allowlist —
  <https://github.com/anthropics/claude-code/issues/57507> (closed "not planned";
  reproduced here).

## Secondary (context / corroboration)

- Best practices for Claude Code — <https://code.claude.com/docs/en/best-practices>
- Practitioner write-ups (corroborating, not authoritative): Nimbalyst, Totalum,
  PubNub, SmartScope 2026 subagent guides; orchestrator.dev and Hindsight on agent
  memory. Treat as secondary; prefer the official docs.

## Key verified findings

1. **Description drives delegation.** Trigger-condition phrasing + "use
   proactively" materially improves autonomous routing. (docs + Anthropic blog)
2. **Least privilege via `tools`/`disallowedTools`;** both-set resolution =
   denylist first, then allowlist. MCP patterns supported. (docs)
3. **Model resolution order** (env → per-invocation → frontmatter → inherited);
   default `inherit`; haiku for cheap work. (docs)
4. **Memory paths are per-agent** (`.claude/agent-memory/<name>/` for `project`),
   200-line/25 KB injection, topic files load on demand. (docs)
5. **Memory auto-enable is unreliable with a `tools:` allowlist** — verified live
   (see log). (#57507 + our test)
6. **Multi-agent ≈ 15× tokens;** token volume explained ~80% of research-quality
   variance; 3–5 concurrent is the sweet spot; avoid for tightly-coupled work.
   (Anthropic Engineering)
7. **Agent Teams = peer messaging + shared task list;** experimental; one team per
   session; no teammate resumption; much higher cost. (docs)

## Live-test log

**2026-07-01 · Claude Code v2.1.198 · this repo**

- **Delegation sanity check** — invoked `test-runner`: correctly detected no test
  manifests and reported "NO TEST SUITE YET"; confirmed repo readable. Delegation
  works. ✅
- **Memory reproduction** — invoked `matchmaking` (`memory: project`; `tools`
  had `Write` but **no `Edit`**), asked it to write to memory:
  - Reported memory path as **repo root**; wrote `./MEMORY.md`, **not**
    `.claude/agent-memory/matchmaking/MEMORY.md`.
  - `ls` confirmed `./MEMORY.md` present; documented path **absent**.
  - Agent confirmed **no `Edit`** tool.
  - **Conclusion:** the `memory:` auto-wiring did not engage under a `tools:`
    allowlist → memory silently misfiled at repo root, would collide across all
    six memory agents, and would never auto-inject next session. Basis for the
    deterministic-memory fix applied the same day. Test artifact removed.
</content>
