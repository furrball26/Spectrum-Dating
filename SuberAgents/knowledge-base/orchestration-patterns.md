# Orchestration Patterns

> Sources: <https://code.claude.com/docs/en/sub-agents>, Anthropic Engineering,
> "How we built our multi-agent research system." Claude Code v2.1.198.

## The core rule: the main thread is the conductor

Subagents run isolated and return **one result up** to whoever spawned them.
**Siblings cannot see or message each other.** So the main conversation (or a
`--agent` main thread) is the orchestrator: it spawns, reads the summary, decides
what runs next, and carries context between steps. Agents that discover
cross-cutting work should **surface it in their output** (this repo's convention:
a trailing `## Hand-offs` section) for the orchestrator to route — they must not
try to "call" another agent.

## Orchestrator-worker (the default multi-agent shape)

The lead analyzes the request, decomposes it, and delegates well-scoped subtasks
to specialist workers. Effective delegation gives each worker: a clear objective,
an output format, tool guidance, and explicit boundaries. Vague delegation
("research X") causes duplicated work and gaps — the single biggest failure mode.

## Patterns

### 1. Isolate high-volume output
Delegate anything that floods context — test runs, doc fetches, log processing —
so verbose output stays in the subagent and only the summary returns.
> "Use a subagent to run the test suite and report only the failing tests."

### 2. Parallel fan-out (independent work)
Spawn multiple subagents at once for **independent** investigations; the lead
synthesizes. Best when paths don't depend on each other. **Launch them in a
single message** so they run concurrently.
> "Research the auth, database, and API modules in parallel using separate subagents."

⚠️ Each returned result re-enters the main context — many detailed returns can
themselves blow the context budget. Summarize aggressively.

### 3. Sequential chain (pipeline)
Each stage's summary feeds the next. Use when later steps genuinely need earlier
output.
> "Use the code-reviewer to find perf issues, then the optimizer to fix them."

### 4. Nested subagents (v2.1.172+)
A subagent can spawn its own subagents (needs `Agent` in its `tools`) — e.g. a
reviewer that dispatches a verifier per finding. Only the **top-level** summary
returns to you. Depth limit is **5**, fixed.

### 5. Forks (v2.1.117+, `/fork` default v2.1.161+)
A fork inherits the **entire current conversation** instead of starting fresh —
same system prompt, tools, model, history. Use when a named subagent would need
too much re-explaining, or to try several approaches from the same starting
point. Cheaper than a fresh subagent because it **reuses the parent's prompt
cache**. A fork can't spawn another fork.

### 6. Verification pass / fresh eyes
Spawn an independent agent to review before committing. It has none of the main
thread's assumptions or blind spots, so it catches what familiarity hides.

## When multi-agent HELPS vs HURTS

**Helps** — breadth-first work that parallelizes across independent directions
(research, review, multi-package fixes, exploration). Anthropic's research system
beat single-agent Opus by **90.2%** on such tasks.

**Hurts / avoid** — tightly coupled work needing shared evolving context or
real-time coordination (most sequential coding), same-file parallel edits
(conflicts), tiny tasks where spin-up overhead dominates, and anything requiring
agents to talk mid-task (→ use Agent Teams instead).

## Token economics (budget before you fan out)

- Multi-agent runs consume **~15× the tokens** of a plain chat (vs ~4× for a
  single agent). Reserve it for high-value tasks.
- **Token volume alone explained ~80%** of the variance in research quality —
  more parallel capacity genuinely helps *on the right tasks*.
- **Scale effort to complexity.** Simple fact-find: 1 agent, a few calls. Complex:
  several specialists with divided labor. **3–5 concurrent subagents is the sweet
  spot** for most jobs; beyond that you spend more time merging summaries than you
  save. Don't spawn 50 for a simple question.

## Choose subagent vs main conversation

Use the **main thread** for: frequent back-and-forth, phases sharing lots of
context, quick targeted edits, latency-sensitive work (subagents start cold).
Use a **subagent** for: verbose output you don't want in context, enforcing tool
restrictions, self-contained work that returns a clean summary.
Consider a **Skill** when you want a reusable workflow that runs *in* the main
context rather than an isolated one.

## Reliability notes

- **Resume** long work instead of restarting: `SendMessage` to an agent's id/name
  re-runs it with full history (Explore/Plan are one-shot, no id). Transcripts live
  at `~/.claude/projects/{project}/{session}/subagents/agent-{id}.jsonl`.
- Subagent transcripts survive main-conversation compaction (separate files) and
  are cleaned per `cleanupPeriodDays` (default 30).
- Tell an agent when a tool is failing and let it adapt — models handle graceful
  degradation surprisingly well.
</content>
