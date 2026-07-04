# Spectrum Dating — Moderation & Management Console Redesign

**Author:** moderation-console-designer (read-only design proposal)
**Date:** 2026-07-04
**Scope:** `src/AdminScreen.jsx` (3,585 lines) + admin routes (`server/src/routes/admin.js`,
`adminTelemetry.js`, `adminPopulation.js`, `billing.js` admin router). No product code was changed.
**Customer complaint driving this:** *"Many of our admins are autistic and the moderation feels
cluttered, hard to read."* The console must meet the SAME calm / low-cognitive-load / accessible bar
as the member app.

> **Sandbox reality (stated plainly).** QA/admin harness accounts get **403 on `/admin`**, and the
> sandbox Chromium has **no internet egress**, so I could **not render or screenshot the live
> console**. Every observation below is reasoned from the source code (the whole `AdminScreen.jsx`
> and the four admin route files, read end-to-end) and from the member-app's established calm
> patterns — not from a rendered screen. Any pixel-level claim should be re-verified against a real
> render before ship.

---

## 1. Current-state inventory (with clutter / confusion tags)

The console is a single screen: an `<h1>Moderation</h1>`, a page-level freshness bar, **five
always-present collapsible "dashboard zones"**, then a **10-item horizontally-scrolling tab strip**,
then the active tab's content, then a Maintenance disclosure. To reach the day-one job (working a
report) a moderator scrolls past five zones and a 10-tab strip every time.

### 1a. The always-on top stack (renders above every tab)

| # | Zone | What it is | Tags |
|---|------|-----------|------|
| 1 | **Site health** (collapsible, open by default) | `SiteHealthPanel`: Server/DB dots, uptime, 24h/7d %, last incident. **Has its OWN "Updated HH:MM + Refresh".** | 🟡 *Not daily casework, yet pinned first.* 🔁 *Duplicate freshness control #2.* |
| 2 | **Billing demo (paid tier)** (collapsible, open by default) | `BillingDemoSection`: view-as Free/Companion self-toggle + "Reset demo tiers". | 🟡 *A demo/sales tool pinned above real T&S work.* |
| 3 | **Needs attention** (open by default) | 4 `StatCard`s — Open reports · Photos · Profile photos · Verification, each with oldest-age + amber past-SLA, tappable → its tab. | 🟢 *This is the good part — real triage signal.* |
| 4 | **Report breakdown** (collapsed) | `BreakdownStrip`: Open / Reviewed / Actioned / Dismissed segments → set the Reports filter. | 🔁 *Report status shown a THIRD way (see below).* |
| 5 | **Community health** (collapsed) | 4 `StatCard`s — Members · Suspended · Matches · Messages (→ Members tab / activity drawers). | 🟡 *Analytics parked in the triage header.* |

### 1b. The tab strip — **10 tabs** (past the scannable limit; overflow is horizontally scrolled off-screen)

`Reports · Overview · Population · Transparency · Members · Verification · Photos · Profile photos ·
Feedback · Activity`

- 🔴 **10 tabs** is well past the ~5–7 humans scan at a glance; the strip scrolls sideways, so
  several tabs are **invisible until you drag** — the opposite of predictable.
- 🔁 **Two near-identical photo queues** — `Photos` (message attachments) and `Profile photos` —
  are separate tabs with essentially the same card (image + owner + approve/reject-with-reason).
- 🟡 **Three analytics tabs** (Overview / Population / Transparency) + Activity are four separate
  destinations for "numbers," each with its **own window selector + its own Updated/Refresh**.

### 1c. The Report card (`ReportCard`) — the epicentre of the complaint

A single open report renders, top to bottom, **five separate action clusters**:

1. `EnforcementActions` — **Warn / Ban** (member enforcement).
2. `ReportedContext` — expandable reported-conversation viewer.
3. **"Resolve report"** — a `<select>` of **Reviewed / Actioned / Dismissed** + note + Apply
   (report lifecycle).
4. A **separate Suspend / Unsuspend** block with its own confirm + note.
5. A **Verify / Remove verification** toggle.

Tags:
- 🔴 **Two parallel action vocabularies on one card.** "Warn / Ban / Suspend" (what happens to the
  *member*) sits beside "Reviewed / Actioned / Dismissed" (what happens to the *report*). A moderator
  must hold *two mental models at once* and understand they are different axes. **This is exactly the
  "cluttered, confusing" the customer named.**
- 🔴 **The decided bug: Warn does not close the report.** Backend `/users/:id/warn` records a notice
  but never touches `reports` (`admin.js:292–310`). So "Warn" then **still leaves the report Open** —
  the moderator must *also* go to the Resolve dropdown and mark it Actioned. A **two-step** for one
  decision. (By contrast Ban/Suspend *do* auto-close via `autoCloseOpenReports`, `admin.js:59–70` —
  so the three actions behave inconsistently, deepening the confusion.)
- 🟡 **`reviewed` is a fourth, noteless status** that means "I looked but didn't decide" — a
  triage-limbo state that adds a word without closing anything.
- 🟡 **Suspend appears in two shapes** — its own block here (`includeSuspend={false}` on the card's
  `EnforcementActions`, plus a bespoke suspend confirm) and *inside* `EnforcementActions` in the
  member drawer (`includeSuspend={true}`). Same action, two layouts.
- 🟡 **Verify-on-a-report** — identity verification is an odd fifth action to meet while triaging an
  abuse report.

### 1d. Freshness / refresh sprawl

There are **six independent "Updated HH:MM + Refresh" controls**: the page bar, `SiteHealthPanel`,
`OverviewTab`, `PopulationTab`, `TransparencyTab`, and `MembersTab`. Each polls on its own. No single
"as of" truth; lots of identical chrome.

### 1e. Demo scaffolding interleaved with real controls

`DemoToggle`, `DemoDataControls` (Load/Clear ~500 sample members), `includeTest`, `includeDemo`, and
the Billing-demo view-as all live amid the real surfaces. Individually well-labelled, collectively
another layer of switches to parse.

### What's genuinely good and must be preserved (do not "reduce" these)

- The **"Needs attention" 4-card triage row** with oldest-age + amber (never red) past-SLA — this is
  best-practice operational-priority-first signalling.
- **Audit integrity**: `moderation_log` (append-only), `resolved_by`/`resolved_at`, required notes on
  terminal actions, the **409 terminal guard** (`admin.js:192–194`) that stops two moderators
  overwriting a decision, and due-process `enforcement_notices` the actioned member can see.
- **A11y foundations**: focus-to-heading after an action, focus-trapped drawers with Escape + return
  focus, `aria-live` polite status region, 44px targets, ≥16px inputs (no iOS zoom), chevron motion
  gated on `prefers-reduced-motion`, k=5 demographic masking, counts-only privacy on drilldowns.
- **Static, stamped numbers — never a live ticker** (already the house rule).

---

## 2. Before → After information architecture

### Before
```
Moderation
[Updated · Refresh]                        ← freshness #1
▸ Site health           (open)  [Updated · Refresh]   ← #2
▸ Billing demo          (open)
▸ Needs attention       (open)  4 cards
▸ Report breakdown      (closed)
▸ Community health      (closed)
[ Reports | Overview | Population | Transparency | Members | Verification | Photos | Profile photos | Feedback | Activity ]  ← 10 tabs, scrolls off-screen
   …active tab… (many carry their OWN Updated·Refresh)
▸ Maintenance           (closed)
```

### After — **4 areas, one freshness truth, casework first**
```
Moderation                                  [ as of 14:02 · Refresh ]   ← the ONLY freshness control
┌─────────────────────────────────────────────────────────────────┐
│  QUEUE   ·   MEMBERS   ·   INSIGHTS   ·   SYSTEM                   │  ← 4 top-level areas
└─────────────────────────────────────────────────────────────────┘

QUEUE  (default landing — the daily driver)
  Needs attention:  [Reports 3 · oldest 2d]  [Photos 1]  [Profile 0 ✓]  [Verify 2]   ← the kept triage row
  ─────────────────────────────────────────────
  One case at a time  ▸  [ current case ]     ← focused case flow (§3)
  Filter: Open ▾   (Reports · Photo review · Verification)

MEMBERS
  Search · status · sort → table → Member drawer (enforcement · membership · history)

INSIGHTS   (all the "numbers", one window selector, one refresh)
  Overview (visits/uptime) · Population · Transparency · Activity · Feedback

SYSTEM     (rare / ops)
  Service health & uptime · Billing demo (paid tier) · Maintenance (purge test data)
```

**How the 10 tabs + 5 zones collapse to 4 areas:**

| Old surface | New home |
|---|---|
| Reports tab · Photos · Profile photos · Verification | **QUEUE** (one casework area; the four "Needs attention" cards become its header) |
| Report breakdown zone | **QUEUE** filter (folded into the queue's status filter — one control, not three) |
| Members tab · Community-health "Members/Suspended" cards | **MEMBERS** |
| Overview · Population · Transparency · Activity · Feedback · "Matches/Messages" cards | **INSIGHTS** |
| Site health zone · Billing demo zone · Maintenance | **SYSTEM** |

Net: **from (5 pinned zones + 10 tabs + 6 refresh controls) → (1 kept triage row + 4 areas + 1
refresh)**. Nothing is deleted; low-frequency surfaces stop competing with daily casework.

---

## 3. The calm case flow — three atomic actions (DECIDED: dismiss / warn / ban)

The user has **decided**: remove the standalone "Resolve report" step. A report is resolved
**atomically by the enforcement action taken**. The card presents **exactly three terminal actions**,
each of which records the outcome *and* closes the report in one step.

### 3a. One-case-at-a-time layout (research-backed; see §7 ADOPT)

```
┌──────────────────────────────────────────────────────────────┐
│  Reporter → Reported member                        [ Open ]   │
│  reported@email · ✓ Verified                                  │
│                                                              │
│  Reason:  Harassment                                          │
│  "free-text details from the reporter…"                       │
│  ⚑ Reporter flagged this message:  "…the pinned message…"      │  ← evidence up top
│                                                              │
│  Context ·  2 prior reports (1 actioned) · blocked by 4 ·     │  ← calm repeat-offender line
│             account age 3mo · ⚠ 1 off-platform signal         │
│  ▸ View reported messages                                     │  ← progressive disclosure
│                                                              │
│  ── Decision ───────────────────────────────────────────     │
│   [ Dismiss ]      [ Warn ]        [ Ban ]                     │  ← THREE actions, nothing else
│   no action        keeps access    permanent removal          │
│                                                              │
│   More ▾  (Suspend temporarily · Mark verified)               │  ← advanced, tucked away
└──────────────────────────────────────────────────────────────┘
```

Selecting any of the three reveals **one** reason field + a confirm, in place:

- **Dismiss** — "Close with no action against *Name*. Reason (recorded)." → report `dismissed`.
- **Warn** — "Send *Name* a warning (they keep access and see the reason). Reason (recorded &
  shown to the member)." → warning notice **+ report closed** atomically.
- **Ban** — danger-styled confirm — "Permanently remove *Name*? They'll be logged out and can't sign
  in. Harder to undo than a suspension. Reason (recorded & shown)." → ban **+ report closed** (+ their
  sibling open reports close, as today).

**One vocabulary. One decision. One reason box. One click-through.** The parallel "Reviewed /
Actioned / Dismissed" dropdown is **gone**; "Warn / Ban" are no longer a *second* cluster beside the
resolver — they **are** the resolver.

### 3b. Where "Suspend" goes (reconciling the enforcement ladder)

The backend ladder is **warn → suspend → ban** (`admin.js`); the user's three are **dismiss / warn /
ban**. Suspend is the *reversible* middle rung. Product law forbids weakening enforcement, so we **do
not remove suspend** — we **demote** it:

- On the **case card**, the three primary buttons are Dismiss / Warn / Ban. **Suspend lives under a
  quiet "More ▾"** (temporary removal) — available, not deleted, but off the main path so the daily
  decision is three, not five.
- In the **Member drawer**, the full ladder stays (Warn / Suspend / Unsuspend / Ban / Unban) for the
  deliberate, non-case context. That's the right home for the reversible/administrative actions.

Mental model to teach admins: **Dismiss = nothing. Warn = keep, on notice. Ban = gone.** Suspend =
"gone *for now*" — a softer Ban, reachable when you want reversibility.

### 3c. Status / audit reconciliation (what each action writes)

| Action | `reports.status` | `enforcement_notices` | `moderation_log` | Member effect |
|---|---|---|---|---|
| **Dismiss** | `dismissed` + `resolved_by/at` + note | — | `resolve_report` (`dismissed: note`) | none |
| **Warn** | `actioned` + `resolved_by/at` + note | `warn` (reason) | `warn` + `resolve_report` | notice only, keeps access |
| **Ban** | `actioned` + `resolved_by/at` + note (this + sibling open reports) | `ban` (reason) | `ban` + `resolve_report`×N | banned, force-logout, sockets dropped |

- **Who / what / when / why is preserved on all three** — `resolved_by`, `resolved_at`, the required
  reason (`moderator_note`), and the append-only `moderation_log`. The audit trail is untouched;
  we're removing a *button*, not a record.
- The **receipt** on a closed report reads the outcome as a plain verb — **"Dismissed / Warned /
  Banned by *Moderator* · 14:02 · 'reason'"** — derived from the enforcement notice + status, so the
  human outcome is legible without a fourth status word.
- **`reviewed` is retired as an action.** Old `reviewed` rows still render (read-only history); the
  UI simply stops offering it. A moderator who isn't ready to decide uses **"Skip for now"** (leaves
  the report Open, advances to the next case) — a *navigation* affordance, not a persisted limbo
  state.

---

## 4. Management / analytics dashboard layout (INSIGHTS)

Consolidate Overview + Population + Transparency + Activity + Feedback into **one Insights area** with
**one** window selector and **one** refresh, organized by question, not by table:

```
INSIGHTS                                   window: [24h · 7d · 30d]   (inherits page refresh)
  ── At a glance ──  (≤5 tiles, per research)
    Members  ·  Reports filed  ·  Actions taken  ·  Median time-to-resolve  ·  Uptime 7d
  ── Traffic ──     Visits sparkline · top locations · sources · member email domains
  ── Population ──  gender/orientation/seeking/… (k=5 masked, tap-to-drill to Members)  [collapsed]
  ── Transparency ── enforcement by type · reports by reason/outcome · QA calibration    [collapsed]
  ── Activity ──    matches/day · messages/day (counts only)                             [collapsed]
  ── Feedback ──    member feedback inbox                                                [collapsed]
```

Principles applied (cited in §7): **≤5 headline tiles**, **progressive disclosure** (secondary
breakdowns collapsed), **KPIs top-left**, **one freshness truth**, **static charts** (`Sparkline` /
`RankedBars`, already used), **color = signal not decoration**. Population's k=5 masking, "multi-select
can exceed member count" notes, and Transparency's counts-only/PII-free guarantees are **unchanged**.

---

## 5. Membership / entitlements admin surface (SYSTEM + Member drawer)

Research (Schematic/Orb) draws a hard line: **billing state ≠ entitlements**. Reflect that and stop
pinning a sales tool above T&S work.

- **Move "Billing demo (paid tier)" out of the always-open top → into SYSTEM.** It's a
  demo/walkthrough tool, not daily casework. Keep the self "view-as Free/Companion" toggle and
  "Reset demo tiers" there, under a **persistent, unmissable "DEMO — not real billing" tag** (the
  code already forces `source='admin_demo'`, `billing.js:94,110`).
- **Per-member tier stays in the Member drawer** (correct home) — but presented as a small
  read-then-act block: **Plan: Free · Source: —** with **[Grant Companion (demo)] [Set Free (demo)]**.
- **Forward-compatible with real billing:** when a provider webhook eventually writes real rows, the
  same drawer block shows **Plan · Status · Source (`admin_demo` vs provider) · renews/cancels** as
  read-only facts with the demo actions clearly separated. No dark-pattern framing, no fabricated MRR
  — honest counts only (Insights already respects no-fabricated-metrics).

---

## 6. Real-time data-flow model (calm freshness)

**Problem today:** six independent pollers/refresh buttons; no single "as of."
**House rule (keep):** numbers are static and stamped — **never a live ticker / flashing counter.**

**Proposed model — one truth, gentle, optional, never alarming:**

1. **One page-level "as of HH:MM · Refresh"** is the single source of freshness. It refetches the
   **active area** on demand. All the per-panel Refresh buttons collapse into it.
2. **Manual refresh is primary** (matches product law). The QUEUE header's four counts may **opt into
   a gentle 60-second background poll** — *counts only*, with a **count-up transition (gated on
   `prefers-reduced-motion`)**, **no red, no sound, no badge/notification**, and it **never reflows
   the case a moderator is currently reading** (freshness updates the header, not the open case).
3. **A "Pause updates" control** accompanies any auto-refresh (research: give users a pause/snapshot).
4. **Freshness is shown as words** — "as of 14:02" — and **skeletons**, not spinners, cover loads
   (already the pattern).
5. **Never** WebSocket-push the counts. A live ticker on an abuse queue is precisely the
   anxiety-inducing motion the customer is complaining about. Polling's "staleness" is a *feature*
   here — calm > instant.

Freshness cadence by data type (research: stagger by type): **queue counts** = 60s optional poll or
manual; **case content** = manual only (never move under the reader); **Insights/analytics** =
manual; **health/uptime** = manual (it already degrades gracefully to "Unreachable").

---

## 7. ADOPT / ADAPT / REJECT — "dense enough to run T&S" vs "calm enough for an autistic admin"

### ADOPT (industry practice that *is* calm)
- **One case at a time**, decision + evidence on one screen, minimize clicks-to-decision
  (ActiveFence/Besedo; the §3 flow).
- **Operational-priority-first**: what needs attention surfaces first (the kept "Needs attention"
  row) — *not* data-availability-first (UXPin/DataCamp).
- **Progressive disclosure**: headline first, drill for detail (UXPin; Insights + case "View
  messages").
- **≤~5 headline metrics per view**; group into modular cards; generous whitespace (Smashing;
  neurodiversity sources).
- **Semantic color = signal, not decoration**; never color-alone (Smashing; the app already pairs a
  word with every badge/dot).
- **Timestamps ("as of…") + manual refresh + skeletons** (Smashing).
- **Predictable, consistent layout + plain language + chunking** (Stéphanie Walter; accessiBe) — the
  throughline for autistic operators.

### ADAPT (keep the concept, dial out the adrenaline)
- **SLA / oldest-first** → keep, but **amber not red, and no countdown timers** (product law: no
  urgency/countdowns). The existing `isPastSla` → amber is exactly right.
- **Delta / trend indicators** → allow **static** "▲ +3 since yesterday" with an icon+label, **not**
  live-flashing deltas.
- **Real-time freshness** → **gentle poll / manual**, never push-ticker (§6).
- **KPI-top dashboards** → keep the headline row, but **collapse everything below it** so it's a calm
  summary, not a wall.

### REJECT (dense-ops habits that would hurt an autistic admin — or break product law)
- **Live push tickers / WebSocket-driven flashing counts / real-time motion** on the queue.
- **Urgency, countdown timers, streaks, gamification, fabricated MRR/vanity metrics.**
- **Per-moderator scoreboards / punitive QA** — keep QA **calibration-only** (already the design;
  `adminTelemetry.js:434–520`).
- **Auto-playing anything; red-as-default "attention" color** (reserve red strictly for
  destructive-action confirms).
- **Multi-KPI walls / 10-tab strips / six refresh controls / two action vocabularies on one card.**

---

## 8. Wireframe-level sketches (section summary)

- **Shell:** `H1 Moderation` + **one** `[as of HH:MM · Refresh]` → **4-area nav** (Queue · Members ·
  Insights · System). Default: Queue.
- **Queue:** kept 4-card "Needs attention" header (oldest-age + amber SLA) → **status filter (one
  control)** → **one-case-at-a-time** card (§3a) with three decision buttons + "More ▾" (Suspend /
  Verify) + "Skip for now."
- **Members:** search/status/sort → table → drawer (full enforcement ladder · membership demo block ·
  report history) — largely as today, minus duplication.
- **Insights:** one window selector, ≤5 tiles, collapsed breakdowns (§4).
- **System:** health/uptime · billing demo (tagged DEMO) · maintenance/purge — all low-emphasis.

---

## 9. Smallest-valuable-slice → later polish

**v1 — the fix the customer asked for (1 builder + 1 qa-functional-tester; NOT a 6-agent panel).**
Rework `ReportCard` to the **three atomic actions**:
- Replace the "Resolve report" `<select>`+Apply and the separate Suspend block with **Dismiss / Warn
  / Ban** (each: reason field → confirm → atomic close). Move Suspend + Verify under "More ▾".
- **Backend:** make **Warn-from-a-case close that report atomically.** Cleanest: a single endpoint
  `POST /admin/reports/:id/action { action: 'dismiss'|'warn'|'ban', note }` that does the enforcement
  **and** the resolve in one transaction, one audit path. (Dismiss = today's resolve `dismissed`;
  Warn = record `warn` notice + close *this* report `actioned`; Ban = today's ban path, which already
  closes sibling reports.) Keep the existing `/warn`, `/suspend`, `/ban`, `/resolve` endpoints for the
  **Member-drawer** (non-case) context and back-compat.
- Retire `reviewed` as an offered action (still render legacy rows); add "Skip for now."

This slice alone removes the two-vocabulary confusion and the Warn-doesn't-close two-step — the heart
of "cluttered, confusing."

**v2 — IA consolidation.** 10 tabs + 5 zones → 4 areas; merge the two photo queues into one "Photo
review" with a source filter; collapse the six freshness controls into one; demote Site health +
Billing demo out of the always-open top into System.

**v3 — calm polish.** Optional 60s gentle queue-count poll + Pause control; static "since yesterday"
deltas; Insights layout refinement; design-ux-reviewer pass in both themes at 390px + desktop.

---

## 10. Migration risks

- **`resolve` → atomic action (highest risk).** *Warn currently never touches `reports`*
  (`admin.js:292–310`); making a **case-Warn** close the report is a semantic change. **Scope it
  carefully:** case-Warn closes **only the current report**; a **drawer-Warn** must still warn
  **without** closing unrelated reports. Ban's `autoCloseOpenReports` (closes *all* sibling open
  reports) is fine for a case-Ban and should stay.
- **Concurrency.** Preserve the **409 terminal guard** (`admin.js:192–194`) and the "already handled
  by another moderator" copy. A case-**Ban** must handle **409 already-banned** (another case banned
  them first) gracefully — still close *this* report as actioned, don't error the moderator out.
- **Status enum.** Mapping Warn→`actioned` needs **no migration** (note/notice carries the verb). If
  product later wants an explicit `warned` outcome, that's an additive migration, not a v1 blocker.
  **Don't** destroy or rewrite historical `reviewed`/`actioned` rows.
- **Endpoint surface.** Adding `POST /reports/:id/action` while keeping the four existing endpoints
  means two code paths transiently — document which the *case card* uses vs the *drawer*. Coordinate
  the transaction/audit semantics with **trust-safety-specialist** (enforcement correctness) and
  **backend-security-auditor** (the new endpoint is admin-gated + rate-limited like the rest;
  reason-required guards preserved).
- **IA churn.** Collapsing tabs changes muscle memory for existing admins — acceptable for an internal
  tool, but land v2 with a one-line "we reorganized into Queue / Members / Insights / System" note.
- **No safety regressions.** k=5 masking, is_demo/test separability, counts-only drilldowns,
  due-process notices, socket-drop-on-ban — **all unchanged.** The redesign moves and merges UI; it
  must not touch these guarantees.

---

## 11. Accessibility specifics (the throughline)

- **Contrast, both themes.** All actions use existing tokens (`t.accentFill`, `t.dangerFill`,
  `t.warningSurface`, etc.) that are AA-tuned for the 7 themes (`dim` default + light). The three
  decision buttons must each pass AA in dim **and** light — re-verify on a real render (§ sandbox
  caveat). **Red is reserved for the Ban/destructive confirm only**, never for "attention."
- **Scannability.** The single biggest win: **one action vocabulary (3 verbs), one reason box, one
  column** — collapses the card's five clusters to a linear read. ≤5 tiles per Insights view.
- **Keyboard / screen reader.** Preserve the strengths: focus-to-heading after an action, focus-
  trapped drawers (Escape + return focus), `aria-live="polite"` status region announcing the outcome
  ("*Name* has been warned. Report closed."), `aria-pressed` on filters, real `<button>`s with focus
  rings. The three actions are real buttons carrying **words** (never color-only).
- **Reduced-sensory.** No new decoration. Honor `prefers-reduced-motion` (already done for the
  chevron) for any count-up/transition; the 200–400ms transitions from research are **gated off**
  under reduce-motion. No auto-play, no flashing, no sound, no live ticker.
- **Predictability & plain language.** Fixed 4-area layout that doesn't rearrange; plain verbs
  (Dismiss / Warn / Ban / Skip for now); each destructive action states its consequence in a sentence
  before you confirm (already the pattern — keep it).
- **Cognitive load.** Progressive disclosure everywhere (evidence, breakdowns, advanced actions);
  one case at a time; generous whitespace; chunked sections. Per the research, **validate with actual
  neurodivergent operators** — checklists alone aren't enough.

---

## 12. Recommended redesign (crisp)

1. **Rework the report card to three atomic actions — Dismiss / Warn / Ban** — each records the
   outcome *and* closes the report in one step, one reason box, one vocabulary. Kill the "Resolve
   report" dropdown and the parallel Suspend block; move **Suspend + Verify under "More ▾"**; add
   **"Skip for now."** Back it with one atomic `POST /reports/:id/action` endpoint so **Warn closes
   the report** (fixing today's silent two-step). Preserve every audit record and the 409 guard. *(v1
   — the customer's actual ask; builder + qa only.)*
2. **Collapse the console to four areas — Queue · Members · Insights · System** — from 5 pinned zones
   + 10 tabs + 6 refresh controls to a calm, casework-first shell with **one** freshness truth. Keep
   the excellent "Needs attention" triage row as the Queue header; merge the two photo queues; demote
   Site health + Billing demo into System. *(v2.)*
3. **Adopt a calm real-time model** — manual refresh primary; an *optional*, pausable, reduced-motion-
   safe 60s poll of queue **counts only** that never moves the case you're reading; **never** a live
   push ticker. *(v3.)*

Every step **reduces** surfaces and vocabulary (the complaint was clutter), keeps T&S dense enough to
run (all evidence, ladder, audit, SLA signal intact), and holds the calm/accessibility bar.

---

## Executive summary (for user sign-off)

Our autistic admins are right: the moderation console is cluttered because it asks them to hold **two
mental models at once** — every report card offers "Warn/Ban/Suspend the member" *and* a separate
"Resolve report → Reviewed/Actioned/Dismissed" dropdown, and confusingly, "Warn" doesn't even close
the report (so it's a hidden two-step), while five always-open dashboard zones and a ten-tab strip
bury the actual work. The redesign fixes exactly what you decided: a report is now resolved
**atomically by the action taken — Dismiss, Warn, or Ban** — one decision, one reason box, one click,
with the full audit trail (who/what/when/why) preserved and the standalone "Resolve" step gone;
Suspend is kept but demoted to an advanced option so the daily choice is a clean three. Around that, we
collapse the whole console from five pinned panels + ten tabs + six refresh buttons down to **four
calm areas (Queue · Members · Insights · System) with a single "as of" refresh**, keep the genuinely-
good triage signals, and replace anxious real-time motion with gentle, pausable, manual freshness —
so the tool our autistic moderators use meets the same calm, low-cognitive-load, accessible bar as the
app itself. Ship it in three slices, smallest first: the three-action card is the whole customer ask
and needs only a builder + a QA pass.

---

### Sources (accessed 2026-07-04)
- ActiveFence — *What Is Trust and Safety?* — https://www.activefence.com/what-is-trust-and-safety/
- Besedo — *Creating Trust and Safety in UX Design* — https://besedo.com/blog/creating-trust-and-safety-in-ux-design/
- UXPin — *Dashboard Design Principles (2026)* — https://www.uxpin.com/studio/blog/dashboard-design-principles/
- DataCamp — *Effective Dashboard Design* — https://www.datacamp.com/tutorial/dashboard-design-tutorial
- Smashing Magazine — *UX Strategies for Real-Time Dashboards* (2025) — https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/
- Stéphanie Walter — *Neurodiversity and UX: Essential Resources for Cognitive Accessibility* — https://stephaniewalter.design/blog/neurodiversity-and-ux-essential-resources-for-cognitive-accessibility/
- accessiBe — *Designing for Neurodivergent Users: 8 Practical Tips* — https://accessibe.com/blog/knowledgebase/how-to-design-digital-environments-for-people-with-neuro-divergency
- Schematic HQ — *Entitlement Management System for SaaS (2026)* — https://schematichq.com/blog/entitlement-management-system
- Orb — *What are entitlements in SaaS?* — https://www.withorb.com/blog/what-are-entitlements-in-saas

*Sources are cited to support design direction; specific vendor claims not independently verified beyond the pages above. All internal code references (file:line) are verified against the repo at 2026-07-04.*
