# Agent Teams (experimental)

> Sources: <https://code.claude.com/docs/en/agent-teams>,
> <https://code.claude.com/docs/en/sub-agents>. Claude Code v2.1.198.
> Enabled in this repo via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"` in
> `.claude/settings.json`.

## What it is

A team of full Claude Code sessions working together. One session is the **lead**
(coordinates, assigns, synthesizes); the others are **teammates**, each in its own
context window. The defining feature vs. ordinary subagents:

- **Peer-to-peer messaging** through a mailbox — a frontend teammate can tell a
  backend teammate about an API-contract change **without routing through the
  lead**.
- A **shared task list** teammates claim work from.

## Teams vs subagents (pick correctly)

| | Subagents | Agent Teams |
| --- | --- | --- |
| Communication | Report **up** to caller only; siblings can't talk | **Peer-to-peer** + shared task list |
| Context | Fresh isolated window per invocation | Each teammate is a full session |
| Coordination | Orchestrator-routed (main thread) | Self-coordinating via messages |
| Cost | ~4× (single) / higher when fanned out | **Significantly higher** (~15×-class); each teammate is a full session |
| Maturity | Stable | **Experimental**; behavior may change |

## When a team actually wins

Reach for a team only when concurrent work genuinely needs **cross-talk while it's
happening**:
- A feature build where frontend/backend/database must align on a contract **as
  they go**.
- Research or review where teammates investigate different angles, then **share
  and challenge** each other's findings.

For everything else — sequential pipelines, independent parallel research with a
synthesis step, isolating verbose output — **plain orchestrator-routed subagents
are cheaper and simpler.** Default to those.

## Using subagent definitions as teammates

When spawning a teammate you can reference an existing **subagent type**; the
teammate adopts that definition's `tools` and `model`, with its body appended to
the teammate's system prompt as extra instructions. So this repo's roster doubles
as a team bench — e.g. spin up `frontend-engineer`, `backend-engineer`,
`database-architect` as teammates that align on an API contract live.

## How to invoke

Enable the env flag (already set here), then describe the task and the teammates
in natural language:
> "Build a user dashboard with a React frontend, an Express API, and tests. Use
> agent teams to work on all three in parallel."

## Known limits (as of v2.1.198)

- **Experimental** — behavior may change between releases.
- **One team per session; no nested teams; the lead can't be transferred.**
- **No session resumption of in-process teammates** — `/resume` and `/rewind`
  don't restore them. After resuming, the lead may try to message teammates that
  no longer exist; tell it to spawn fresh ones.
- Each teammate is a full session → **watch the token bill.**

## Guidance for this repo

Enabling the flag changes nothing until you ask for a team. Keep the default
**orchestrator + `## Hand-offs`** flow for normal sequential work; use a team only
for the narrow "parallel work that needs live cross-talk" case above, and say so
explicitly in the prompt.
</content>
