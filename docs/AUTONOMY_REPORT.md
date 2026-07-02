# Why this project wasn't autonomous — forensic analysis & fixes

Scope: this session's full history plus the reconstructed output of the
original Leroi session (its agent definitions — the chat itself lives with the
backend repo, which is outside this repo's access scope). Every claim below is
grounded in a specific observed failure.

## Part 1 — Why the subagents never QA'd the site themselves

**1. The E2E recipe lived only in chat memory.** Running this app in a browser
here requires five non-obvious tricks (Chromium has no internet; build with
`VITE_API_URL` exported in the same shell; serve `dist/` via `vite preview`;
forward API calls through Node fetch with CORS headers; stub socket.io with
503). None of that was in any agent file or repo doc. A QA agent that tried to
"drive the real UI" (as its definition instructed) would fail at the first
`page.goto` and silently fall back to reading source code. Code-reading cannot
see rendered layout — which is exactly why the bubble-overlap bug (a
zero-height div with a −10px margin) reached the customer instead of being
caught: it was invisible in source review and obvious in one screenshot.
*Fix: `scripts/qa/harness.mjs` encodes the recipe; agent files mandate it and
forbid the silent fallback ("if you can't run it, say so").*

**2. Nothing triggered QA automatically.** Agent auto-delegation keys off the
`description` field. The QA/design descriptions said "use for regression
passes / when asked" — so after a fix shipped, nothing matched. The user became
the QA department. *Fix: `qa-functional-tester` and `design-ux-reviewer` are
now "Use PROACTIVELY after every frontend change"; the builder's own pipeline
embeds the smoke gate so even a solo builder can't skip QA.*

**3. No standing regression suite.** Six one-off E2E drivers were written and
deleted in this session alone (p2verify, p3verify, r1–r3, bugrepro) — each
re-invented account seeding, route forwarding, and assertions. Nothing
accumulated, so old bug classes had no tripwire. *Fix: `scripts/qa/smoke.mjs`
(11 checks, proven green) is now the ship gate, and the rule is "every new bug
class becomes a permanent check", starting with the overlap detector and the
page-growth invariant.*

**4. Stale operational knowledge in the agent files.** They still described the
retired `npm run deploy` / `vercel --prod` / alias flow; the real pipeline
became git ff-merge → Vercel Git auto-deploy mid-project. An agent following
its own instructions would have broken the deploy. *Fix: single source of
truth in `CLAUDE.md`; every agent file now points there and states the git
pipeline.*

**5. One writer, nine advisors — and the writer was benched.** The
"consult with all subagents" pattern produced excellent analysis, then the
main thread implemented everything anyway. The builder agent — the one piece
that could have made work autonomous — was almost never used. *Fix: the
builder now owns the FULL loop (implement→lint→build→smoke→ship→live-verify)
and is the default Tier-1 crew.*

## Part 2 — Why session limits were hit

1. **Panels for the wrong jobs.** Six agents × each independently re-reading
   the same screens/files ≈ 40–70k tokens per agent. Right for the theme
   initiative (once); wasteful for "here are 4 screenshot bugs". The tier
   system in `executive-assistant.md` makes crew size an explicit decision.
2. **Analysis paid twice.** Panels analyzed, then the main thread ALSO read
   everything to implement. Delegating implementation to the builder puts the
   heavy file-reading in a disposable context.
3. **Re-derived environment lessons.** The `VITE_API_URL`-in-same-shell rule,
   the heredoc/exit-144 trap, the code-split live-verify subtlety — each cost
   a debugging loop before being (re)learned, because no `CLAUDE.md` existed.
4. **Throwaway verification.** Rebuilding the E2E scaffold ~6 times.
5. **Main-thread mechanics.** 3,000-line files edited, deploys polled, and
   screenshots reviewed in the primary context, inflating every subsequent
   turn's history.

## Part 3 — Where you (the user) went wrong (small list, honestly)

1. **The team's files lived outside version control** (only in the backend
   repo/chat) — when that session died, the team had to be reconstructed from
   memory. Everything now lives in THIS repo and ships in the bundle.
2. **Asking for panels but accepting main-thread implementation.** The phrase
   that gets autonomy is "have the builder fix X" (or just "fix X" — the
   proactive descriptions now route it); the phrase that burns sessions is
   "consult all subagents" on small bugs.
3. **Playing QA yourself.** Reporting bugs worked, but each round-trip cost a
   day and session budget. With the smoke gate + proactive QA, the loop is:
   one sentence of direction → verified, shipped result with evidence.
4. Scope-batching mid-session was fine — the cost was never your request
   style; it was the missing infrastructure above.

## Part 4 — What was implemented (this commit)

- **`CLAUDE.md`** — project brain, auto-loaded every session: ship pipeline,
  sandbox E2E recipe, product law, definition of done, session-economy rules.
- **`scripts/qa/harness.mjs`** — permanent account-seeding + browser harness.
- **`scripts/qa/smoke.mjs`** — standing 11-check regression gate (verified
  11/11 green against the live backend before landing).
- **10 rewritten/patched agent definitions** — proactive triggers, mandatory
  harness, evidence rules, cost tiers, current deploy truth, "say so if you
  can't run it" honesty rule.
- **`.claude/agents/README.md`** — cheat sheet + cross-repo install guide.

## Part 5 — How to run the next project autonomously

1. Start every repo with the three files (brain, harness, smoke) — copy from
   this bundle and edit the header facts.
2. Give direction in outcomes ("ship X", "fix Y"), not process; the
   descriptions route work to the builder, whose pipeline self-verifies.
3. One workstream per session; let the builder's disposable context absorb the
   heavy reading.
4. Reserve panels for one planning pass per initiative — then Tier-1/2 loops.
5. When a bug reaches you anyway, the response is two-part: fix it AND add its
   detector to smoke.mjs, so it is the last time you see that class.
