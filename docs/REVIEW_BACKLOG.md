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

---

## Open — frontend (fixable in this repo; next builder pass)

Grouped as the a11y auditor recommended: items on the messaging surface
(`MatchesListScreen.jsx` / `MessagingApp.jsx`) ship together; verify each in the
harness at 390px before/after.

- [ ] **FE-1 (MEDIUM trust&safety) — Failed report silently dropped when block
  succeeds.** `src/ReportModal.jsx` (+ mirrored in `messaging/MessagingApp.jsx`,
  `messaging/BlockReportScreen.jsx`): when a user ticks BOTH block + report and the
  block lands but `reportUser` throws, the flow reports success ("Blocked") and the
  report is lost with no retry prompt — the retry path only exists for the
  block-free report case. Surface a calm non-blocking notice when
  `doReport && !reported` even if the block succeeded.
- [ ] **FE-2 (SERIOUS a11y, NEW) — Row ⋯ safety menu loses keyboard focus to
  `<body>` after any modal closes.** `MatchesListScreen.jsx:258-273`: menu items
  call `setOpen(false)` (unmounts the trigger) *before* firing the callback, so the
  modal snapshots `activeElement` as `<body>` and restores focus there on close —
  keyboard users get dumped to the top of the list. Restore focus to the ⋯
  `triggerRef` on item-activation (mirror the Escape branch at `:233`).
- [ ] **FE-3 (SERIOUS a11y = old A11Y-3) — Row ⋯ menu clipped by list
  `overflow:hidden`.** `MatchesListScreen.jsx:257` popup inside the `<ul>` at
  `:300-309`; for a single-match/last-row list the menu is clipped and keyboard
  users tab into invisible controls (worst at 390px). Drop `overflow:hidden`
  (round rows individually), portal the menu, or flip it upward for last rows.
- [ ] **FE-4 (SERIOUS a11y = old A11Y-2) — Identity-theme quick revert is
  gesture-only.** `src/App.jsx:1224,1446` bind revert only to `onDoubleClick` on a
  `div`; no keyboard/SR path and it's silent. While an identity theme is active,
  render the logo cluster as a real `<button aria-label="Switch back to Warm dim">`
  (keep double-tap for pointer) + announce via the polite `role="status"` region;
  update Settings copy.
- [ ] **FE-5 (MOD a11y = old A11Y-4) — `role="menu"` without menu keyboard
  behavior.** `MatchesListScreen.jsx:226-278`: no focus-into-menu, no Arrow/Home/End.
  Add roving focus + restore, OR downgrade honestly to a disclosure (drop
  role=menu/menuitem) — calmer/smaller.
- [ ] **FE-6 (MOD a11y = old A11Y-5) — Theme picker radio semantics without radio
  behavior.** `src/SettingsScreen.jsx:73-158`: every card is a Tab stop, arrows do
  nothing. Roving tabindex + arrow selection OR plain buttons with `aria-pressed`;
  tie the identity disclosure via `aria-describedby`.
- [ ] **FE-7 (MINOR a11y = old A11Y-6) — Sub-44px targets + type-floor slips.**
  Archive Undo `minHeight:40` (`MatchesListScreen.jsx:616`→44); clear-filter ×
  `width:32` (`:704`→add `minWidth:44`); collapse pills `fontSize:13`
  (`ConversationScreen.jsx:1101,:1234`→14).
- [ ] **FE-8 (LOW, low-confidence) — Text-send has no explicit in-flight guard.**
  `ConversationScreen.jsx:2037` relies on `setComposeValue("")` to prevent
  double-send; a `sending` ref would make it bulletproof. No reliable repro.
- [ ] **PROD-1..6** (product opportunities — carried forward, unchanged): legal
  links inside the app; self-host fonts; push-click navigation; ReactionPicker
  keyboard semantics; calm PWA offline fallback; viewer-side photo gallery
  (needs backend `photos[]`). Detail in git history of this file.

---

## Open — backend-owned (server repo `spectrum-dating-server`, NOT fixable from this frontend repo)

Confirmed by the backend-security + trust-safety auditors. Overall backend posture
is strong (no SQLi, tenant scoping correct, admin authZ uniform, coarse-location
applied everywhere). These are the real gaps:

- [ ] **BE-1 (MEDIUM) — Blocked users not excluded from Discover/swipe/matching.**
  `candidates.js:41-53` never consults the `blocks` table; a blocked person still
  appears in the deck, can re-like, and a mutual like still creates a match + fires
  a "New match" push. Chat *is* block-gated (masks it). Exclude blocked pairs from
  `getCandidates` and reject `/swipe` across a block. (Harass-around-a-block.)
- [ ] **BE-2 (MEDIUM) — `requireAuth` accepts purpose-scoped tokens.**
  `auth.js:59-70` never checks `payload.purpose`, so a leaked password-reset link
  can be replayed as a full 1-hour `Bearer` session — silently (no token_version
  bump). Reject `payload.purpose` in `requireAuth`/`optionalAuth`.
- [ ] **BE-3 (LOW-MED) — `GET /profile/:userId` doesn't filter ended matches.**
  `profile.js:488-495` lacks `AND ended_at IS NULL`; after an unmatch both parties
  keep permanent read access to each other's full profile incl. the post-match-only
  `context_card`.
- [ ] **BE-4 (LOW) — `verifyPurposeToken` skips version/suspension checks.**
  `export.js:44-56` honors a 5-min export token even if the user was suspended /
  signed out in the window, returning full message bodies.
- [ ] **BE-5 (LOW) — `POST /push/subscribe` reassigns a subscription by endpoint.**
  `push.js:24-32` overwrites `user_id` on endpoint collision — an attacker who
  learns a victim's push endpoint could hijack it. Reject on collision instead.
- [ ] **BE-OPS — admin reset-password hook re-runs every boot** if
  `RESET_PASSWORD_EMAIL`/`_VALUE` stay set in Railway (`reset-password.js`,
  `index.js:143`): re-hashes admin password + force-logout each deploy. Confirm
  both env vars are UNSET in prod; add a one-time marker.

---

## Hygiene
- [ ] **HYG-1 — STATUS.md is dangerous:** its "CURRENT STATE" header still
  instructs the retired `npm run deploy` + `vercel alias` path CLAUDE.md forbids,
  and lags git. Refresh on a 15-min cadence or delete in favor of CLAUDE.md.

---

## Pending (3 reviewers re-running against the fixed branch)
- [~] QA-functional-tester — full-flow harness pass, 390px + desktop, both themes.
- [~] user-journey-tester — first-time autistic user on a phone.
- [~] design-UX-reviewer — real-screenshot visual/layout pass, both themes.

Feature-gap backlog (F1–F29) lives separately in `audit/FEATURE_BACKLOG.md` —
unchanged this session; it tracks missing features, not production bugs.
