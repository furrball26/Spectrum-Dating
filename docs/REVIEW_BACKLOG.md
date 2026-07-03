# Production-bug review backlog

Rebuilt 2026-07-03 from a full read-only review panel (accessibility, trust &
safety, backend security, code review) plus a frontend builder pass that shipped
7 confirmed fixes. Three harness-driving reviewers (QA-functional, user-journey,
design-UX) are re-running against the fixed branch — their findings append below
when in.

Status legend: [ ] open · [x] done · [~] in progress

---

## ✅ Fixed this session (commit 9b5fa2d, branch `claude/production-bugs-backlog-okvown`)

Lint 0 errors · smoke 11/11 PASS · new regression driver
`scripts/qa/report-modal-reach.mjs` 9/9 PASS (screenshot proof at 390px).

- [x] **BUG-1 (HIGH) — Report/Block dialog submit unreachable on mobile** (the
  archetype "can't scroll to complete the report form" bug). `src/ReportModal.jsx`
  was a `position:fixed` transform-centered dialog with no `maxHeight`/`overflowY`,
  so on a small/zoomed phone or keyboard-open the reason radios + textarea +
  "Block and report" clipped off-screen with no scroll. Added
  `maxHeight:"88vh", overflowY:"auto", WebkitOverflowScrolling:"touch"` (matches
  DiscoverFilters/MatchProfileModal). Triple-confirmed by a11y + trust-safety +
  code review; regression-tested reachable at 390px.
- [x] **BUG-2 (BLOCKER a11y = old A11Y-1) — NoteSheet dialog had zero focus
  management** + same no-scroll issue. `src/messaging/MessagingApp.jsx` NoteSheet:
  added maxHeight/overflow + focus-in on textarea, activeElement capture/restore,
  Tab trap, Escape→close (copied from ReportModal/UnmatchSheet).
- [x] **BUG-3 (MEDIUM trust&safety) — Identity theme leaked across same-session
  logout→login.** `clearAuth` reset localStorage+DOM but not in-memory `a11y`
  state, so a next user on the same page load saw the prior user's pride/trans
  ribbon and could re-persist it. `src/App.jsx` `handleSignOut` + `auth:expired`
  now reset the in-memory identity theme too (safety invariant restored).
- [x] **BUG-4 (MEDIUM) — Raw backend error string leaked on onboarding save.**
  `src/OnboardingScreen.jsx:1072` now routes through `safeErrorMessage`.
- [x] **BUG-5 (LOW-MED) — Raw error string leaked on photo upload.**
  `src/ProfileScreen.jsx` `photoErrorMessage` now routes the non-503 fallback
  through `safeErrorMessage`.
- [x] **BUG-6 (MEDIUM crash) — Unguarded `otherUser` deref could white-screen the
  conversation thread** for a deleted/suspended partner.
  `src/messaging/ConversationScreen.jsx` now defaults `otherUser = otherUserProp || {}`.
- [x] **BUG-7 (LOW crash) — `ProfilePreviewModal` dereferenced `photos` without a
  guard.** `src/ProfileScreen.jsx:1668` now `(photos || []).find(...)`.

### ✅ Also fixed + SHIPPED TO PROD (master `fd12541`, live-verified)
Rebased cleanly onto the monorepo `origin/master` (`c85221a`, +30 commits adding
`server/`, `audit/`, `legal/`); no force-push, monorepo work preserved. Gate:
lint 0 · smoke 11/11 · `block-report-reach.mjs` 14/14 · `report-modal-reach.mjs`
9/9. Live bundle SHA256 == local dist; fix markers present in served bundle.

- [x] **BUG-8 (HIGH, user-reported w/ screenshot) — Full-page in-conversation
  Block/Report couldn't scroll to Submit on mobile.** This was the REAL surface
  behind the report; the earlier ReportModal fix was a *different* component.
  `BlockReportScreen.jsx:127-149` root now `height:100%, overflowY:auto,
  WebkitOverflowScrolling:touch` (internal scroller; Messages-tab height invariant
  preserved).
- [x] **BUG-9 (user-reported) — Bottom-nav "Messages" was dead inside a
  sub-screen.** Tapping Messages while in a conversation/block-report did nothing
  (activeTab already "messages", MessagingApp's internal `screen` never reset).
  `App.jsx:1042,1490,1376` new `homeSignal` counter → `MessagingApp.jsx:150,205`
  resets to the conversation list (initial mount skipped so deep-links aren't yanked).

---

## ✅ CHAT / touch UX (user-reported 2026-07-03) — SHIPPED TO PROD (master `3146860`, live-verified)
Driver `scripts/qa/touch-chat-ux.mjs` 15/15 · smoke 11/11 · block-report 14/14 ·
report-modal 9/9 · clean ff-merge (no force) · live bundle markers confirmed.

- [x] **CHAT-1 — Thread scrolls vertically only.** `[role="log"]` gains
  `overflowX:hidden`; fixed the SOURCE too: message rows `minWidth:0` + side-aware
  bubble `maxWidth` reserving the floated ＋/⋯ footprint (was pushing ＋ ~21px past
  the viewport). Log `scrollWidth` 411→390.
- [x] **CHAT-2 — Hold-to-react.** ~450ms long-press on a bubble opens the
  ReactionPicker; a scroll (touchmove >10px) or early release cancels; light
  vibrate (reduced-motion-gated); native context menu suppressed. Additive — ＋
  button + keyboard path untouched.
- [x] **CHAT-3 — ＋ visible on touch.** New `useCoarsePointer`: on touch the ＋ rests
  at `opacity:0.7`, `fontSize` 16→20, `textMuted`→`textSoft`; fine pointers keep
  hover-reveal. 44×44 target kept.
- [x] **UX-TAP — Whole toggle row tappable.** SettingsScreen ToggleRow +
  ProfileScreen PauseToggle: row `onClick`→onChange; switch `stopPropagation` so one
  tap = one toggle. Label tap now flips persisted state.

---

## ✅ DESIGN contrast (systemic) — SHIPPED TO PROD (master `070081c`, live-verified)
White text on `accentStrong`/`danger` light-tint fills → `accentFill`/`dangerFill`.
Computed white-text contrast **dim 2.10→6.27, navy 1.89→7.82** (accent);
**dim 2.67→6.68, navy 2.43→6.50** (danger). Driver `scripts/qa/contrast-fills.mjs`
20/20 · smoke 11/11 · all drivers green · markers grep-confirmed in live bundles.
- [x] **DSGN-1** Landing "Create your profile" (hero + bottom CTA) → accentFill.
- [x] **DSGN-2** Auth submit → accentFill.
- [x] **DSGN-3** Profile "Pause my profile" (filled branch) → accentFill.
- [x] **DSGN-4** Block/Report submit → dangerFill (now matches ReportModal).
- [x] **DSGN-5** Profile photo "Remove" → dangerFill.
- [x] **DSGN-6** Profile save-error toast → dangerFill.
- [x] **DSGN-7** MatchMoment scrim 0.55→0.70 + opaque subline → white passes AA in light.
- [x] **DSGN-8 (found in sweep)** AccountSecurityScreen delete-account confirm → dangerFill.

---

## Open — DESKTOP / TABLET (from the desktop responsive review; the mobile panel missed these)
Reviewed 768/1024/1280/1440 in dim+light + navy/pride/trans. All 14 shipped fixes
verified HOLDING at desktop. New defects:
- [ ] **DT-1 (HIGH) — Liked-you card names truncate in the 340px desktop messages
  rail** — even 6-char names ("Cal QA"→"Cal …"). `LikedYouSection.jsx:56-77`: the
  fixed-width "I'm interested" button on row 1 starves the `minWidth:0` name column.
  Same component in the full-width Likes tab renders fine — it's the 340px rail
  (`MessagingApp.jsx:732`). Fix: in narrow containers move "I'm interested" to the
  actions row (row 2) or render a compact rail variant.
- [ ] **DT-2 (HIGH, safety) — Conversation-row ⋯ menu is downward-only; clips Block
  or report / Unmatch below the fold on the desktop rail.**
  `MatchesListScreen.jsx:279` positions the menu `top:calc(100%+4px)` with no upward
  flip; bottom rows in the short viewport-height rail push the safety items past the
  viewport (rail `overflowY:auto` clips). The thread-HEADER ⋯ menu (top-anchored) is
  fine. NOTE: distinct from FE-3 (that removed the `<ul>` `overflow:hidden`); this is
  the positioning gap. Fix: flip the menu upward when the trigger sits low in its
  scroll container (mirror the header menu).
- [ ] **DT-3 (MED) — Nested-background white band under short content (Likes tab).**
  `LikesScreen.jsx:82-91` paints its own `t.bgGradient` at `minHeight:100%` inside
  the desktop surface panel (`App.jsx:1394`); short content leaves the panel's
  `t.surface` showing beneath as a stark white band (worst in light) on tablet +
  desktop. Fix: make the screen bg transparent (inherit the panel) or fill it on
  tablet/desktop. Audit SuggestionScreen for the same pattern.
- [ ] **DT-4 (LOW-MED, polish) — Ragged theme-grid card heights** in the 4-col
  desktop layout (cards with a description line are taller). Equal-height per row.
- [ ] **DT-5 (LOW, polish) — Onboarding card top-anchored** with large empty space
  below on tall desktop/tablet viewports; vertically center it.

## JOURNEY / product (from user-journey pass)
- [ ] **JRN-1 (MED) — Junk profile served as newcomer's first Discover card**
  ("Kinda Stupid, 34", "Bla bla bla"). Bad trust signal at the trust-critical moment.
  Screen abusive display names from the deck or curate the first-session deck.
  (Data/moderation — backend `server/`.)
- [x] **JRN-2 — Duplicate "Pause my profile" controls — FIXED, SHIPPED (`0ae1120`).**
  Removed the redundant collapsed section; top "Take a break" card is the single
  control. (Also cleared the pre-existing `deep_profile_settings` failure → 26/26.)
- [x] **JRN-3 — Match Moment explicit × close — SHIPPED (`0ae1120`).** 44×44 Close
  button in the focus trap; Escape still works.
- [x] **JRN-4 — Calmer signup 429 copy — SHIPPED (`0ae1120`).** `safeErrorMessage`
  maps 429 to a non-countdown message.

---

## Open — frontend (fixable in this repo; next builder pass)

Grouped as the a11y auditor recommended: items on the messaging surface
(`MatchesListScreen.jsx` / `MessagingApp.jsx`) ship together; verify each in the
harness at 390px before/after.

- [x] **FE-1 — Failed report silently dropped when block succeeds — FIXED, SHIPPED
  (master `2966e1c`).** All three surfaces (ReportModal `:113`, BlockReportScreen
  `:98`, MessagingApp `:505`) now emit an honest "You've blocked {name}. We couldn't
  send your report — try again from Safety Center." — block preserved, no false
  "reported". Verified with a forced report-endpoint 500.
- [x] **FE-2 — Row ⋯ menu focus dumped to `<body>` — FIXED, SHIPPED (master
  `2966e1c`).** `MatchesListScreen.jsx:246` new `runItem()` moves focus to the ⋯
  trigger synchronously before the modal mounts, so the modal restores to the
  trigger. Verified: after Block/report modal Escape-close, `activeElement` is the ⋯
  button (`isBody=false`). Driver `messaging-safety-a11y.mjs` 13/13.
- [x] **FE-3 — Row ⋯ menu was COMPLETELY INVISIBLE on the Matches list — FIXED,
  SHIPPED TO PROD (master `e8d6fa7`).** Removed `overflow:hidden` from the `<ul>`
  and moved corner-rounding onto the rows (first/last props); the popover no longer
  gets clipped. `deep_messaging.mjs` row-⋯ checks: `clippedPx 201→0`,
  `covered:false, visible:true` in dim AND light; 28/28. All 5 items reachable.
  Live bundle marker confirmed.
- [x] **FE-4..FE-7 — a11y semantics + target sizes — FIXED, SHIPPED (master
  `2994dbe`).** Driver `a11y-fe4-7.mjs` 37/37; all regressions green.
  - FE-4: identity-theme revert now has a real `<button aria-label="Switch back to
    Warm dim">` + polite announcement (`App.jsx` `LogoRevertShell`); double-tap +
    logout-reset invariants re-verified intact.
  - FE-5: fake `role="menu"` → honest `role="group"` disclosure
    (`MatchesListScreen.jsx`); FE-2 focus behavior preserved.
  - FE-6: theme picker `role="radio"` → buttons with `aria-pressed` + identity
    disclosure tied via `aria-describedby` (`SettingsScreen.jsx`).
  - FE-7: archive Undo 40→44, clear-filter × `minWidth:44`, collapse pills →14px.
- [x] **KNOWN driver failure — RESOLVED by JRN-2.** `deep_profile_settings.mjs` now
  targets the top "Take a break" card → 26/26. (Builder also fixed 2 masked latent
  driver bugs: stale anchored hub-row selectors + wrong localStorage key.)
- [x] **FE-8 — Text-send in-flight guard — FIXED, SHIPPED (master `0ae1120`).**
  `ConversationScreen.jsx` `sendingRef` guard around the plain-text send path.
- [x] **PROD-1 — In-app legal links — SHIPPED (`0ae1120`).** "About & legal" nav in
  Settings → `/privacy.html` + `/terms.html`.
- [x] **PROD-4 — ReactionPicker semantics — SHIPPED (`0ae1120`).** `role="toolbar"`
  → `role="group"` + aria-label.
- [ ] **PROD-2 (S/M) — Self-host the two fonts** (drop render-blocking Google Fonts).
- [ ] **PROD-3 (S) — Push-notification clicks land nowhere** (`public/sw.js` never
  navigates on click). Needs the backend push payload's `data.url`.
- [ ] **PROD-5 (M, careful) — Calm PWA offline fallback** (navigation-only
  network-first → one precached offline.html; do NOT cache hashed assets).
- [ ] **PROD-6 (OUT — needs backend) — Viewer-side photo gallery** (`/matching/
  candidates` returns only `photoUrl`; backend must expose `photos[]` first).

---

## ✅ Backend security — DEPLOYED TO PRODUCTION (Railway `/health` sha `608f639`)
All five on `master 608f639`, `npm test` 31/31, deployed via `railway up` and
health-gated — new SHA live in ~40s. **Live in prod.**

> ⚠️ Deploy-path bug found + fixed en route (`server/scripts/deploy.mjs`): the
> RUNBOOK's `npm run deploy` ran `railway up` from `server/`, but the monorepo
> service Root Directory is `server`, so Railway looked for `server/server` and the
> build FAILED — this had silently broken the last ~3 deploys. Fixed: the script now
> runs `railway up --detach --service spectrum-dating-server` from the REPO ROOT.
> `RESET_PASSWORD_*` confirmed unset (BE-OPS clear).

- [x] **BE-1 (MEDIUM) — Blocked users excluded from Discover/swipe/matching.**
  `candidates.js` folds bidirectional `blocks` into the exclude set; `/swipe`
  (`matching.js`) silently no-ops across a block (no match, no push, no disclosure).
- [x] **BE-2 (MEDIUM) — Purpose tokens no longer accepted as full sessions.**
  `auth.js` `requireAuth`/`optionalAuth` reject `payload.purpose`.
- [x] **BE-3 (LOW-MED) — `GET /profile/:userId` now filters `ended_at IS NULL`.**
  Unmatched pair loses full-profile + `context_card` access.
- [x] **BE-4 (LOW) — `verifyPurposeToken` now runs `checkTokenVersion`** (honors
  suspension / sign-out for export/reset tokens).
- [x] **BE-5 (LOW) — `/push/subscribe` returns 409 on cross-user endpoint
  collision** instead of reassigning; same-user re-subscribe still refreshes keys.
- [x] **BE-OPS — `RESET_PASSWORD_EMAIL`/`_VALUE` confirmed UNSET in Railway** (user
  verified). Optional follow-up: add a one-time marker so the hook can't re-fire.

---

## Hygiene
- [ ] **HYG-1 — STATUS.md is dangerous:** its "CURRENT STATE" header still
  instructs the retired `npm run deploy` + `vercel alias` path CLAUDE.md forbids,
  and lags git. Refresh on a 15-min cadence or delete in favor of CLAUDE.md.

---

## Reviewer panel status — COMPLETE (7/7)
- [x] accessibility-auditor, trust-safety-specialist, backend-security-auditor,
  code-reviewer — done (folded into FE-*/BE-*/DSGN-* above).
- [x] user-journey-tester — done (JRN-1..4 + UX-TAP).
- [x] design-UX-reviewer — done (DSGN-1..8).
- [x] QA-functional-tester — done. Post-fix regression pass: all shipped fixes
  hold; one functional bug found → FE-3 (row-⋯ clip, upgraded). Regression drivers
  added: `scripts/qa/deep_{messaging,onboarding,hub,profile_settings}.mjs`.

Feature-gap backlog (F1–F29) lives separately in `audit/FEATURE_BACKLOG.md` —
unchanged this session; it tracks missing features, not production bugs.
