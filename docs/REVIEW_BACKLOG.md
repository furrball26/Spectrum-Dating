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

## Open — CHAT / touch UX (user-reported 2026-07-03; NEXT builder pass, ship to prod)

- [ ] **CHAT-1 (MED) — Conversation log scrolls sideways; should be up/down only.**
  `ConversationScreen.jsx:2644` `[role="log"]` has `overflowY:auto` but no
  `overflowX:hidden`; an over-wide child drifts the thread horizontally. Lock
  `overflowX:hidden` + enforce `minWidth:0` on message rows + `maxWidth` on bubbles.
- [ ] **CHAT-2 (MED, feature) — Hold-to-react on a message bubble.** Reactions only
  open via the ＋ button today. Add a long-press (~450ms press-and-hold via
  touchstart timer) on the bubble to open the ReactionPicker. Touch-only; needs real
  390px harness testing. `ConversationScreen.jsx` message row + ReactionPicker (:78).
- [ ] **CHAT-3 (MED) — Reaction ＋ button is invisible/too small on touch.**
  `ConversationScreen.jsx:784-812`: `fontSize:16`, muted color, and
  `opacity:0 until hover/focus` — touch has no hover, so it's effectively hidden on
  phones. Make it visibly present on touch (larger glyph, stronger contrast, drop the
  hover-gate) as the discoverable fallback alongside CHAT-2.
- [ ] **UX-TAP (MED, journey) — Toggle rows only respond to the tiny switch, not the
  label/row.** Tapping the words "Plain language"/"Low stimulation"/"Pause my
  profile" does nothing. `SettingsScreen.jsx:163-219` (ToggleRow),
  `ProfileScreen.jsx:1076-1119` (PauseToggle): make the whole row the tap target.
  (Batch with the chat pass — same touch-affordance theme.)

---

## Open — DESIGN contrast (systemic; own builder pass)

One root cause: hand-rolled buttons use `t.accentStrong`/`t.danger` as a SOLID FILL
under white text, but those tokens are light tints in dark themes (`dim` default,
`navy`) → fail AA. The `*Fill` variants exist for white-on-fill and pass; `Button.jsx`
already documents the 2.10:1 failure. Mechanical swaps:
- [ ] **DSGN-1 — Landing "Create your profile"** `LandingScreen.jsx:49` (hero + bottom
  CTA) → `accentFill`/shared Button. **First screen, default theme, fails twice.**
- [ ] **DSGN-2 — Auth "Sign in / Create account"** `AuthScreen.jsx:441` → `accentFill`.
- [ ] **DSGN-3 — Profile "Pause my profile"** `ProfileScreen.jsx:3121` → `accentFill`.
- [ ] **DSGN-4 — Block/Report submit** `BlockReportScreen.jsx:383` → `dangerFill`
  (ReportModal already uses dangerFill — fix the inconsistency).
- [ ] **DSGN-5 — Profile photo "Remove"** `ProfileScreen.jsx:684` → `dangerFill`.
- [ ] **DSGN-6 — Profile save-error toast** `ProfileScreen.jsx:2981` → `dangerFill`.
- [ ] **DSGN-7 (MED) — Match Moment muddy + subline fails contrast in `light`.**
  `MatchMoment.jsx:156,250`: darker/opaque panel behind white text so AA passes.

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

## Reviewer panel status
- [x] user-journey-tester — done (findings folded into JRN-1..4 + UX-TAP above).
- [x] design-UX-reviewer — done (findings folded into DSGN-1..7 above).
- [~] QA-functional-tester — still running (full-flow harness pass, 390px + desktop).

Feature-gap backlog (F1–F29) lives separately in `audit/FEATURE_BACKLOG.md` —
unchanged this session; it tracks missing features, not production bugs.
