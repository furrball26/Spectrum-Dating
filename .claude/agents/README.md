# Subagent roster & orchestration guide

This directory holds the specialist subagents for building a dating website for
adults on the autism spectrum. This file explains **how they work together** —
read it before driving a multi-agent task.

## The one rule that shapes everything

**Subagents cannot talk to each other.** Each runs in an isolated context and
returns a single result *up* to whoever spawned it. Sibling agents can't see or
message one another. (Nested spawning exists but is still parent→child, not
peer-to-peer; true peer messaging only exists in experimental Agent Teams.)

So the **main conversation is the orchestrator/conductor.** It spawns an agent,
reads the result, and decides what runs next. Agents surface cross-cutting
concerns in a trailing `## Hand-offs` section of their output; the orchestrator
reads those and routes the follow-up work. Agents do **not** call each other.

When you read "hand this to X" or "spec from Y" inside an agent, that means
*"emit a hand-off for the orchestrator to route,"* not *"call agent X yourself."*

## Roster

| Agent | Role | Model |
| --- | --- | --- |
| `user-research` | Participatory co-design *with* autistic users | opus |
| `accessibility-ux` | Neurodivergent UX design/specs/review (WCAG 2.2 AA+) | opus |
| `matchmaking` | Reciprocal compatibility/recommendation model design | opus |
| `trust-safety` | Verification, moderation, anti-scam/abuse design | opus |
| `privacy-compliance` | GDPR/CCPA, sensitive data, age assurance, EU AI Act | opus |
| `security-engineer` | AppSec, authz/IDOR, encryption, threat modeling | opus |
| `frontend-engineer` | React/Next.js web client implementation | sonnet |
| `backend-engineer` | APIs, profiles, media pipeline, search, notifications | sonnet |
| `realtime-chat` | WebSocket messaging transport | sonnet |
| `database-architect` | Schema/migrations, geo/search data layer | sonnet |
| `devops-infra` | IaC, CI/CD, observability, deploy safety | sonnet |
| `payments-subscriptions` | Ethical billing/entitlements | sonnet |
| `qa-accessibility-test` | Test strategy + automated/manual a11y | sonnet |
| `test-runner` | Executes an existing test suite, reports pass/fail | sonnet |

## Who does what (avoid overlap)

- **Design vs build:** `accessibility-ux` designs UX/specs/copy → `frontend-engineer`
  implements them. Don't ask the implementer to invent UX.
- **Three "safety-ish" agents:** `security-engineer` = technical attack surface;
  `privacy-compliance` = legal/regulatory data rules; `trust-safety` = user-facing
  abuse/moderation. Pick by which lens the task needs.
- **Data:** `database-architect` designs the schema/indices; `backend-engineer`
  consumes it; `privacy-compliance` sets retention/deletion rules the DB enforces.
- **Testing:** `qa-accessibility-test` designs/authors tests; `test-runner` only
  executes an existing suite.

## Typical orchestration sequences (the main thread drives these)

- **New user-facing feature:** `user-research` → `accessibility-ux` (spec) →
  `frontend-engineer` + `backend-engineer` (build) → `qa-accessibility-test`
  (tests) → `test-runner` (run). Route `privacy-compliance` / `trust-safety`
  hand-offs whenever data or safety is touched.
- **Matching feature:** `matchmaking` (model) → `database-architect` (indexes) →
  `backend-engineer` (serve) → `privacy-compliance` (profiling consent).
- **Messaging:** `accessibility-ux` + `trust-safety` (specs) → `realtime-chat`
  (build) → `security-engineer` (review) → `qa-accessibility-test`.

## Want real inter-agent coordination?

Enable experimental **Agent Teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`),
where teammates message each other and a lead coordinates. It costs
significantly more tokens and is experimental — prefer orchestrator-routed
hand-offs for normal work.
