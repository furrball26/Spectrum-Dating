# Subagent Audit Rubric

The scored checklist the daily consultation runs against every
`.claude/agents/*.md`, plus `.claude/settings.json` and the memory files. Score
each item ✅ pass / ⚠️ improve / ❌ fail, then rank findings by
**impact × confidence**.

## A. Description & auto-delegation (autonomy)
- [ ] **A1** Leads with **trigger conditions**, not just capability.
- [ ] **A2** Includes a **proactivity cue** where appropriate ("Use proactively /
  immediately after …") for hands-off delegation.
- [ ] **A3** States **boundaries** vs adjacent agents (prevents mis-fire / overlap).
- [ ] **A4** Self-contained and specific — no reliance on unstated intent.
- [ ] **A5** No two agents have overlapping descriptions that would race for the
  same task.

## B. Tools & least privilege
- [ ] **B1** `tools` scoped to the minimum the job needs.
- [ ] **B2** Read-only/design agents hold **no** Write/Edit/Bash.
- [ ] **B3** Agents needing cross-session memory list **Read, Write, Edit**
  explicitly (see the #57507 caveat).
- [ ] **B4** `Agent` present only where nesting is intended; absent otherwise.
- [ ] **B5** MCP access (`mcp__*`) granted only where required.

## C. Model & effort (cost/quality)
- [ ] **C1** `model` deliberate: `opus` judgment/design, `sonnet` implementation,
  `haiku` cheap/mechanical.
- [ ] **C2** No opus where sonnet/haiku would do (cost) and no haiku where the task
  needs judgment (quality).
- [ ] **C3** `effort`/`maxTurns` sane for the workload.

## D. System prompt (the body)
- [ ] **D1** Clear role + scope in the first lines.
- [ ] **D2** A "when invoked" procedure (numbered steps).
- [ ] **D3** An explicit **output format** (esp. important when another agent
  consumes it — keep it terse).
- [ ] **D4** Tells the agent to **return hand-offs** rather than call peers.
- [ ] **D5** "Verify, don't rely on memory" for anything time-sensitive (law,
  standards, advisories).
- [ ] **D6** Body length reasonable (focused, not bloated).

## E. Memory & state
- [ ] **E1** Every `memory:` agent points to its **exact** path in the prompt.
- [ ] **E2** Seed `MEMORY.md` exists at `.claude/agent-memory/<name>/`.
- [ ] **E3** Scope fits persistence needs (`project` survives the ephemeral cloud
  container; `user`/`local` do not).
- [ ] **E4** Prompt tells it to **read at start / update at end**.
- [ ] **E5** No stray `MEMORY.md` at repo root (symptom of the wiring bug).
- [ ] **E6** Sensitive memory scope matches the recorded decision in
  `decisions.md` (currently: stays `project`/committed while the repo is
  private). Do **not** re-raise unless that condition changes.

## F. Orchestration & fit
- [ ] **F1** Roster has no gaps/overlaps vs the product's actual work.
- [ ] **F2** Hand-off targets named in bodies actually exist as agents.
- [ ] **F3** Team flag usage matches the "needs live cross-talk" bar.
- [ ] **F4** README orchestration sequences still match the roster.

## G. Docs & hygiene
- [ ] **G1** `.claude/agents/README.md` and `CLAUDE.md` match the actual agent set
  and behavior (no drift).
- [ ] **G2** Version stamps current; claims re-verified after Claude Code updates.
- [ ] **G3** `name` values unique; `/doctor` clean.

## Scoring output
For each finding: **ID · severity (high/med/low) · what · why it matters · exact
fix (diff if useful)**. Then a one-line **verdict** and the top 3 actions.
</content>
