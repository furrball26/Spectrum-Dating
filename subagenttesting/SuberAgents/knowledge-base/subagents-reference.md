# Subagents — Complete Reference

> Verified against <https://code.claude.com/docs/en/sub-agents>, Claude Code
> **v2.1.198**. ⚠️ = re-verify against docs before relying on it.

## What a subagent is

A specialized assistant that runs in **its own isolated context window** with its
own system prompt, tool access, and permissions. Claude delegates to it when a
task matches its `description`; it works independently and returns **only a
summary** to the caller. This is the core value: heavy exploration/log/output
stays out of the main conversation's context.

A non-fork subagent's initial context is: its own system prompt (**not** the full
Claude Code system prompt) + environment details + the delegation/task message +
CLAUDE.md & memory hierarchy + a git-status snapshot + any preloaded skills. It
does **not** see conversation history or files the main thread already read.
(Built-in `Explore` and `Plan` skip CLAUDE.md and git status for speed.)

## File format & location

Markdown file with YAML frontmatter; the body is the system prompt.

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---
You are a senior code reviewer. When invoked, run git diff, focus on changed
files, and report issues by priority with concrete fixes.
```

**Scopes & precedence** (highest wins on name collision):

| Location | Scope | Priority |
| --- | --- | --- |
| Managed settings `.claude/agents/` | Organization | 1 (highest) |
| `--agents` CLI JSON | Session only | 2 |
| `.claude/agents/` | Project (commit these) | 3 |
| `~/.claude/agents/` | All your projects | 4 |
| Plugin `agents/` | Where plugin enabled | 5 (lowest) |

Both `.claude/agents/` and `~/.claude/agents/` are scanned **recursively**;
subfolders are for organization only — identity comes solely from the `name`
field. Keep `name` unique across the tree. `/doctor` reports duplicate names
(v2.1.196+). Files edited on disk require a session restart; changes via the
`/agents` interface take effect immediately.

## Frontmatter fields (full set)

Only `name` and `description` are required.

| Field | Notes |
| --- | --- |
| `name` | lowercase-hyphenated unique id; hooks receive it as `agent_type`. |
| `description` | **When Claude should delegate.** The single most important field for autonomy — see below. |
| `tools` | Allowlist. Omit → inherits all tools. |
| `disallowedTools` | Denylist, subtracted from inherited/allowed pool. If both set, `disallowedTools` applies first, then `tools` resolves against the remainder; a tool in both is removed. Supports MCP patterns (`mcp__github`, `mcp__*`). |
| `model` | `sonnet` / `opus` / `haiku` / `fable` / full id (`claude-opus-4-8`) / `inherit`. Default `inherit`. |
| `permissionMode` | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. Parent `bypassPermissions`/`acceptEdits`/`auto` take precedence and can't be overridden. |
| `maxTurns` | Max agentic turns before the subagent stops. |
| `skills` | Preload full skill content into context at startup (not just the description). |
| `mcpServers` | Give the subagent MCP servers (inline def or reference). Inline-here keeps the tools out of the main conversation's context. |
| `hooks` | Lifecycle hooks scoped to this agent (`PreToolUse`, `PostToolUse`, `Stop`→`SubagentStop`). |
| `memory` | `user` / `project` / `local`. See `memory-and-state.md`. |
| `background` | `true` → always runs as a background task. |
| `effort` | `low`/`medium`/`high`/`xhigh`/`max`; overrides session effort while active. |
| `isolation` | `worktree` → runs in a temporary git worktree (isolated repo copy; auto-cleaned if unchanged). |
| `color` | UI color: red/blue/green/yellow/purple/orange/pink/cyan. |
| `initialPrompt` | Auto-submitted first user turn when the agent runs as the **main** session (`--agent`). |

Tools **never** available to subagents even if listed: `AskUserQuestion`,
`EnterPlanMode`, `ScheduleWakeup`, `WaitForMcpServers`, and `ExitPlanMode`
(unless `permissionMode: plan`). Design agents that would want to ask the user a
question must instead **return the question** to the orchestrator.

## The `description` field — how auto-delegation works

Claude reads `description` the same way it reads a tool description, to decide
whether to route a task here. Best practices:

- **Lead with trigger conditions, not capability.** "Reviews code for security
  issues **before commits**" delegates better than "security expert."
- **Add proactivity cues** ("Use proactively…", "Use immediately after…") to make
  Claude reach for it without being asked — this is the lever for *autonomous
  operation*.
- **State boundaries** so it doesn't fire on adjacent work owned by another agent
  ("Use this for X; for Y use agent-z").
- Keep it specific and self-contained; the model can't see your intent, only this
  string.

Explicit invocation escalation ladder: **natural language** (name it, Claude
decides) → **`@agent-<name>` / @-mention** (guarantees this agent for one task) →
**`--agent <name>` / `agent` setting** (whole session runs as that agent).

## Tool restriction patterns

```yaml
tools: Read, Grep, Glob, Bash          # allowlist: ONLY these
disallowedTools: Write, Edit           # denylist: inherit all except these
disallowedTools: mcp__github           # drop one MCP server, keep the rest
tools: Agent(worker, researcher), Read # restrict which subagents can be spawned (main-thread agents)
```

Listing `Agent` in a subagent's `tools` lets it **spawn nested subagents**
(v2.1.172+, depth limit 5, not configurable). Omit `Agent` to prevent nesting.

## Model selection & resolution order

Resolved in this order (first hit wins):
1. `CLAUDE_CODE_SUBAGENT_MODEL` env var (a global override; `inherit` ≈ unset as of v2.1.196)
2. per-invocation `model` parameter Claude passes
3. the definition's `model` frontmatter
4. the main conversation's model

Rule of thumb: **`opus`** = judgment/design/ambiguity; **`sonnet`** =
implementation; **`haiku`** = cheap, fast, mechanical/high-volume (e.g. log
scraping, simple detection). Values are checked against the org `availableModels`
allowlist; an excluded model silently falls back to inherited.

## Built-in subagents

`Explore` (Haiku, read-only, fast codebase search), `Plan` (inherits model,
read-only, used in plan mode), `general-purpose` (all tools, multi-step),
`statusline-setup`, `claude-code-guide`. `Explore`/`Plan` are one-shot (no agent
id, can't be resumed); use `general-purpose` or a custom agent when you need to
resume/continue.

## Design checklist (per agent)

- [ ] One clear job; description leads with trigger + proactivity cue + boundary.
- [ ] `tools` scoped to least privilege for that job.
- [ ] `model` chosen deliberately (opus/sonnet/haiku).
- [ ] Body: role, "when invoked" steps, explicit output format.
- [ ] If it can't finish alone, it **returns** hand-offs (can't call peers).
- [ ] Memory configured correctly if it needs cross-session state.
</content>
