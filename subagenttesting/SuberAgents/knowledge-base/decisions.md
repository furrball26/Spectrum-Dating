# SuberAgents — Decision Log

Settled decisions the daily consultation must **respect**. Do NOT re-raise an
item recorded here as an open question — reference the decision instead. Add
entries with date + rationale; supersede rather than delete.

## 2026-07-01 — Sensitive-agent memory stays `project` scope (committed)
**Decision:** `security-engineer`, `trust-safety`, and `privacy-compliance` keep
`memory: project`; their memory (threat models, known-issue register, compliance
record) is committed to version control.
**Rationale:** the repo is private, and `project` is the only scope that survives
the ephemeral cloud container across sessions (`user`/`local` do not). Owner
confirmed 2026-07-01. **Resolves audit finding E6 — do not re-raise.**
**Revisit only if:** the repo is ever made public — then move these three to
`local` and gitignore `.claude/agent-memory-local/`.

## 2026-07-01 — Daily consultation schedule
**Decision:** run at ~9:07am **America/Phoenix** (Arizona, UTC−7, no DST) →
`cron: "7 16 * * *"` (UTC) in `.github/workflows/daily-subagent-consult.yml`.
**Rationale:** owner's local morning. Arizona observes no daylight saving, so a
fixed UTC cron does not drift across the year.
</content>
