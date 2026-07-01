# SuberAgents

A siloed knowledge base and consulting workspace for **Claude Code subagents,
orchestration, agent memory, and Agent Teams**. Everything about how this repo's
subagents are designed, audited, and improved lives here so it stays together and
survives across sessions (this repo runs in an ephemeral cloud environment — only
committed files persist).

> Folder name is intentionally spelled **`SuberAgents`** at the owner's request.

## What's here

```
SuberAgents/
├── README.md                          ← you are here
├── knowledge-base/                    ← the durable "SME" reference (verified against docs)
│   ├── 00-index.md                    ← start here; map of the knowledge base
│   ├── subagents-reference.md         ← frontmatter fields, tools, models, delegation
│   ├── memory-and-state.md            ← memory scopes, exact paths, the #57507 caveat
│   ├── orchestration-patterns.md      ← orchestrator-worker, chaining, parallel, forks, nesting
│   ├── agent-teams.md                 ← teams vs subagents; when each wins
│   └── best-practices-checklist.md    ← the rubric the daily audit scores against
├── research/
│   └── sources.md                     ← cited sources + key findings + live-test log
├── audits/
│   └── YYYY-MM-DD-audit.md            ← one file per consultation (dated)
└── routines/
    └── daily-subagent-consult.md      ← Cloud Routine spec + self-contained morning prompt
```

## The daily consultation (the recurring deliverable)

Every morning, a consultation reviews the repo's current subagents
(`.claude/agents/*.md`, `.claude/settings.json`, memory files) against
`knowledge-base/best-practices-checklist.md` and writes a dated report to
`audits/`. To automate it, create the Cloud Routine described in
`routines/daily-subagent-consult.md` (paste its self-contained prompt into
`/schedule` or <https://claude.ai/code/routines>). Until then, invoke it manually:

> "Run today's SuberAgents subagent consultation."

Each audit is: **findings → prioritized recommendations → exact diffs where
useful**. High-value, clearly-correct fixes may be applied directly on a
`claude/`-prefixed branch; anything subjective is left as a recommendation for
owner approval.

## Maintenance rules

- Treat `knowledge-base/` as the source of truth; **re-verify against official
  docs** (`code.claude.com/docs`) before relying on any claim — Claude Code ships
  frequently and behavior changes between versions. Each KB file carries a
  "verified against" version stamp.
- When a Claude Code version bump changes subagent behavior, update the affected
  KB file and note it in the next audit.
- Keep audits append-only (one dated file each); never rewrite history.
</content>
