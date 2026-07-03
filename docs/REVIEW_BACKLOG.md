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

## Open — JOURNEY / product (from user-journey pass)
- [ ] **JRN-1 (MED) — Junk profile served as newcomer's first Discover card**
  ("Kinda Stupid, 34", "Bla bla bla"). Bad trust signal at the trust-critical moment.
  Screen abusive display names from the deck or curate the first-session deck.
  (Data/moderation — likely backend `server/`.)
- [ ] **JRN-2 (LOW) — Duplicate "Pause my profile" controls** (top card
  `ProfileScreen.jsx:3090` + collapsed section `:4034`). Remove the redundant one.
- [ ] **JRN-3 (LOW) — Match Moment has no explicit × close** (`MatchMoment.jsx`).
- [ ] **JRN-4 (LOW) — Signup 429 message is mildly urgency-flavored** ("try again in
  15 minutes"); calmer non-countdown phrasing if it surfaces on the signup screen.

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
