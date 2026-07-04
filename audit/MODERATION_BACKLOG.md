# Spectrum Dating — Moderation Console overhaul

**Synthesized 2026-07-04** from a 7-lens read-only panel (scoping, trust-safety,
product-strategy, backend-security, design-UX, accessibility, code-review) run against
`src/AdminScreen.jsx` + `server/src/routes/admin.js` + moderation migrations, triggered by
customer feedback: *"the moderation panel is not ideal — no real-time data, the state seems
arbitrary (no breakdown), taking action doesn't save notes, and an action can be redone at
any point — it does not feel resolute."*

Scope approved by owner: **Phase 0 + Phase 1 ("the works").**

## Root causes (all confirmed in code)
1. **Stale:** every queue + the stats row loads once on mount (`AdminScreen.jsx:1235`), no
   refresh, no "as of". Queues optimistically drop the acted item but never refetch
   (`:546,:683,:1026`); stats only refresh after a *reports*-tab action (`:1238`).
2. **Arbitrary counts:** Members/Matches/Messages are unfiltered `COUNT(*)`
   (`admin.js:245-249`) that include `@spectrum-test.dev`/`@sample.spectrum-dating.app` — the
   "597" was never structurally fixed, only manually purged. Report breakdown
   `{open,reviewed,actioned,dismissed}` is computed (`admin.js:251-255`) but UI shows only
   `open` (`:1285`). Pending photo/profile-photo/verification depths never reach the dashboard.
3. **Notes look lost:** report note IS saved (`admin.js:110-112`) + serialized (`:476`) but
   `ReportCard` never renders it. Suspend/verify/photo-reject persist NO reason
   (`admin.js:143,:169,:380,:453` pass empty `logMod` detail).
4. **Not resolute:** resolve (`admin.js:96-116`), suspend (`:121-146`), verify (`:154-185`)
   have NO terminal/idempotency guard — re-actionable forever, overwriting note/timestamp.
   Resolved cards show no who/when/why and keep live "Apply" controls (`:319-428`). The
   photo/attachment queues DO guard (409 if not `pending_review`, `:373-375,:435-437`) — the
   pattern to copy.

### Bugs the panel already has (fix during the rebuild)
- `statusColor` maps `reviewed` AND `actioned` to the same `accentFill` (`AdminScreen.jsx:66-67`).
- `reportedVerified` always false — `serializeReport` never returns `verified` and the query
  never SELECTs `identity_verified` (`admin.js:43-55,:480-484`; `api.js:428`). Badge/button lie.
- 409 conflicts collapse into generic "try again" retry loops (bare `catch{}` at
  `:206,:225,:244,:473,:605,:931,:1092`; no `safeErrorMessage`).
- Focus lost after every action — acted card unmounts, focus falls to `<body>` (a11y BLOCKER).

---

## Phase 0 — MVP (fixes all four complaints). ONE Railway migration + ONE Vercel ship.

### Backend (`server/src/routes/admin.js`, `db.js`, one migration)
- **B-A Real counts (query-only).** Exclude test/demo domains (constants already at
  `admin.js:12-13`) from `totalUsers` (+ optionally return `testUsers` for an explainable
  "(+N test)"). `WHERE email NOT LIKE '%@spectrum-test.dev' AND email NOT LIKE '%@sample.spectrum-dating.app'`.
- **B-B Richer `/admin/stats` (query-only).** Add `pendingAttachments`, `pendingProfilePhotos`,
  `pendingVerifications` (`COUNT(*) WHERE …pending`), `oldestOpenReportAt` + oldest-pending age
  per queue (`MIN(created_at)`), and return the full report breakdown (already computed). All
  hit existing indexes.
- **B-C Resolute reports (migration `043_report_resolution.sql`).** `ALTER TABLE reports ADD
  COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL` — **ADD COLUMN ONLY, never a
  table rebuild** (the `030` migration preserves report evidence; a rebuild risks it). In
  `POST /admin/reports/:id/resolve`: 409 if status already terminal (`actioned`/`dismissed`);
  write `resolved_by = req.ctx.userId`; require a non-empty `note` for `actioned`/`dismissed`.
  Serialize `resolvedBy` (join to email/name) + `resolvedAt`.
- **B-D Idempotency guards (query-only).** 409 on suspend/verify when already in the target
  state; make the audit row conditional on an actual change.
- **B-E Notes on destructive actions (query-only).** Accept optional `note` on
  suspend/verify/photo-reject/profile-photo-reject → pass as `logMod` `detail` (no new column).
  Required on suspend + any reject.
- **B-F Fix verified badge (query-only).** Join `profiles.identity_verified` into the reports
  query + `serializeReport.reported.verified`.

### Frontend (`src/AdminScreen.jsx`, `api.js`)
- **F-A Dashboard split.** "Needs attention" zone (open reports + pending photo/profile/verif
  each with count + oldest-age) vs de-emphasized "Community health" (Members/Suspended/Matches/
  Messages). "Excludes test accounts" subtext under Members. Report-breakdown strip
  (Open·Reviewed·Actioned·Dismissed), each tappable to set the filter. Amber only for
  past-SLA; `0` reads calm ("All clear"), never red.
- **F-B Resolute UI.** When `status !== 'open'`: hide the resolve select/Apply/suspend/verify
  controls, render a read-only receipt "Actioned by X · 14:36 · '<note>'" (data from B-C).
  Required note + a confirm step (reuse the suspend-confirm shape `:389-409`) for
  `actioned`/`dismissed`. Prefill/echo the saved note.
- **F-C Freshness.** "Updated HH:MM" + a real `<button>` Refresh (44px, focus ring); refetch
  the active queue AND stats after every mutating action; surface `loadStats` errors; 409 →
  "already handled by another moderator" + refetch (not a retry loop). Optional quiet 60s
  count-only refetch — NO ticker, NO live badge, reduce-motion-safe.
- **F-D Bug/polish.** Distinct `reviewed` vs `actioned` styling; focus-restore after an item
  unmounts (move focus to next card's primary control or the section heading — reuse
  `headingRef.focus()` `:1214`); `SectionRule` under the `<h1>` (`:1258`); age chips on queue
  items; move `PurgeTestAccountsPanel` (`:1290`) out of prime position into a low-emphasis
  Maintenance area.

### A11y requirements to bake in (from the a11y lens)
- Keep dashboard numbers as plain static text — do NOT put `aria-live` on each (chatty).
  Announce ONE calm summary via the existing single polite `role="status"` region (`:1274`)
  on refresh: "Updated. 3 open reports."
- New note fields get a real visible `<label htmlFor>` (not placeholder-only); `fontSize:16`.
- Resolved/final badges never color-only — always carry the word (icon `aria-hidden`).
- Confirm panels: move focus in on reveal + bind Escape to Cancel.
- Per-item action labels ("Approve photo from <owner>").

---

## Phase 1 — makes it genuinely useful

- **P1-A Surface the reported conversation (blind-triage fix, the biggest usefulness gap).**
  Reports capture `conversation_id` (`messaging.js:657-660`) but nothing shows the messages.
  Add `GET /admin/reports/:id/context` returning the last N messages of the conversation
  (sender-attributed, attachment thumbnails), read-only, rendered in `ReportCard`. **For
  evidence durability** (conversation/user may be deleted): snapshot the reported message
  text into the report row at report time — new column, second migration (ADD COLUMN,
  `044_report_evidence_snapshot.sql`). Decide snapshot-vs-live-fetch at build time; snapshot
  is safer for a T&S trail.
- **P1-B Repeat-offender / history (query-only).** On each report card + a
  `GET /admin/users/:id/history`: prior report count against this user (M actioned), distinct
  members who blocked them (`blocks` table — strong, non-gameable), account age. Uses the
  existing `idx_reports_reported` index.
- **P1-C Human-readable audit log (query-only).** `GET /admin/audit-log` LEFT JOIN to resolve
  `target_id` → email/display-name; `AuditLogView` shows the name, not `target <id>` (`:824`).
  Notes captured in B-E now flow into `detail` and render as a real trail.
- **P1-D Link suspend↔report (kill false "actioned").** Suspend from a report context offers to
  resolve the linked open report(s) atomically; suspending a user auto-closes sibling `open`
  reports against them. Surface "reported user is currently suspended" (exists `:310`).

## Phase 2 — optional later (NOT in this scope unless asked)
- Escalation ladder warn→suspend→ban (severity column, migration).
- Tab count badges, `StatCardSkeleton`, ARIA tab-pattern cleanup, `t.radius`/`t.space` adoption.

---

## Build order & deploy gating
1. **Backend Phase 0 + 1** (all `admin.js` changes + migrations 043 [+ 044 if snapshotting]).
   BRANCH-ONLY first — coordinator reviews the resolve-guard + migration diff (report evidence
   trail is sensitive: ADD COLUMN only, no rebuild) before the Railway deploy. Backend tests:
   idempotency guards (re-resolve → 409), real-count filtering, note-required, verified join,
   history counts. Then Railway deploy, health-verify the SHA.
2. **Frontend Phase 0 + 1** (Vercel) once the backend fields are live — it consumes them.
   Gates: eslint 0, build w/ env var, smoke 11/11, a design-review pass (both themes) since
   this is a big visual change, and a focus-management check.

**Migrations:** `043_report_resolution.sql` (resolved_by) always; `044_report_evidence_snapshot.sql`
only if P1-A snapshots. Both ADD COLUMN only.
**Biggest risk:** the reports table is the abuse-evidence trail (`030` preserves it) — never
rebuild it; guard the resolve endpoint without breaking the existing "resolved drops out of the
Open filter" behavior (`AdminScreen.jsx:1238`).
