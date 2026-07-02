# Spectrum Dating — Subagent Cheat Sheet

A standing team of specialist subagents, tuned to this stack and the calm-by-design
principles. This is the "when to reach for which" reference.

**Definitions live in [`.claude/agents/`](.claude/agents/) in this repo** (committed, so they
travel with the project and auto-load for anyone who clones). For user-global use across
projects, copy them to `~/.claude/agents/`:
`cp .claude/agents/*.md ~/.claude/agents/`

## When you want to… → reach for

| Say / situation | Agent |
|---|---|
| "Build / implement / wire / fix / ship X" | `frontend-feature-builder` ✍️ writes & deploys |
| "Did my change break anything?" / "regression pass" / "QA the site" | `qa-functional-tester` |
| "Test it like a real user" / "what would frustrate a new user" | `user-journey-tester` |
| "Is this WCAG-compliant?" / "check contrast" / "is this calm enough?" | `accessibility-auditor` |
| "Review the design" / "on-brand?" / "polish pass" / "check both themes" | `design-ux-reviewer` |
| "Is this endpoint secure?" / "can A see B's data?" / "check the migrations" | `backend-security-auditor` |
| "Review this code" / "find latent bugs" / "pre-merge check" / "tech-debt" | `code-reviewer` |
| "What should we build next?" / "what's half-built?" / "prioritize backlog" | `product-strategist` |
| "Is our moderation enough?" / "audit reporting/blocking" / "anti-abuse" | `trust-safety-specialist` |
| "Run everything" / "coordinate this" / "status?" | `executive-assistant` (orchestrates the above) |

## Rules of thumb

- **Fan out in parallel:** all read-only agents (QA, user-journey, a11y, design, backend, code, product, trust-safety) compose cleanly — ideal for a full audit.
- **Serialize the builder:** only `frontend-feature-builder` writes/deploys — never run two builders at once (deploy/alias + working-tree race). Read-only agents *can* run alongside one build.
- **Overlap to watch:** `backend-security-auditor` = *exploitability*; `trust-safety-specialist` = *user-harm / moderation ops*. Use both for safety-critical work; they cover different angles.
- **Pipeline pattern:** `product-strategist` (what to build) → `frontend-feature-builder` (build it) → `qa-functional-tester` + `accessibility-auditor` (verify it).
- **Credentials are supplied at invocation** — they are intentionally not stored in the agent definitions.

## Read-only vs. writes

| Mode | Agents |
|---|---|
| ✍️ Writes code & can deploy | `frontend-feature-builder` |
| 👁️ Read-only (reports/recommends; restores any sample data) | the other eight |

## House rules every agent honors

- Calm-by-design is product law: **no** typing indicators, online-now/last-seen, read receipts, streaks, urgency, or gamification.
- ALL React hooks before any early return.
- Coarse location only — never expose a precise ZIP to strangers.
- Migrations must be idempotent and registered in the `MIGRATIONS` array.
- Frontend deploy: `npm run deploy`, then manually `npx vercel alias set <deployment-url> spectrum-dating-eta.vercel.app`, then verify the live bundle.

_Stack: React 18 + Vite (Vercel) · Node/Express + better-sqlite3 + socket.io + JWT (Railway)._
