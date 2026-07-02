# Full-team review backlog (mobile + desktop)

Captured from the parallel review panel. The session hit its limit mid-panel:
the **accessibility** and **product** reviewers returned full reports (below);
the **QA**, **design**, **journey**, and **code-review** agents did their work
(20–36 tool calls each) but died before writing final reports — re-run those
four next session (their prompts are in the git history / this session log).

Status legend: [ ] open · [x] done · [~] in progress

## Accessibility findings (verified: code + computed contrast)

- [ ] **A11Y-1 (BLOCKER) — NoteSheet dialog has no focus management.**
  `src/messaging/MessagingApp.jsx:46-94`: `role="dialog" aria-modal="true"` but
  focus never enters on open, no Tab trap, no Escape, no focus restore. SR users
  who pick "Add private note" land in silence; keyboard users must tab the whole
  page behind the scrim. Fix: focus textarea on mount, trap Tab, Escape to close,
  restore focus to the row ⋯ trigger (mirror RowMenu's pattern at
  MatchesListScreen.jsx:233).
- [ ] **A11Y-2 (SERIOUS) — Identity-theme quick revert is gesture-only (WCAG 2.1.1).**
  `src/App.jsx:1224, :1446` bind revert only to `onDoubleClick` on a `div`; no
  keyboard/SR path, and it's silent to AT. Fix: while an identity theme is active,
  render the logo cluster as a real `<button aria-label="Switch back to Warm dim">`
  (keep double-tap for pointer), announce via the polite `role="status"` region,
  update the Settings disclosure copy to mention both paths.
- [ ] **A11Y-3 (SERIOUS) — Row ⋯ menu clipped by list `overflow:hidden`.**
  `src/messaging/MatchesListScreen.jsx:257` popup inside the `<ul>` with
  `overflow:hidden` (300-309). For a single-match list (common case) the menu is
  clipped; keyboard users tab into invisible controls. Fix: drop `overflow:hidden`,
  round first/last rows individually, or flip menu upward for last rows.
  **Confirm in harness before/after.**
- [ ] **A11Y-4 (MOD) — `role="menu"` without menu keyboard behavior.**
  `MatchesListScreen.jsx:226-278`: no focus-into-menu, no Arrow/Home/End, item
  activation drops focus to body. Fix: roving focus + focus restore, OR downgrade
  honestly to a disclosure (drop role=menu/menuitem, keep buttons) — calmer/smaller.
- [ ] **A11Y-5 (MOD) — Theme picker radio semantics without radio behavior.**
  `src/SettingsScreen.jsx:73-158`: `role=radiogroup`/`radio` but every card is a
  Tab stop and arrows do nothing; identity disclosure appears after selection with
  no programmatic tie. Fix: roving tabindex + arrow selection OR plain buttons with
  `aria-pressed`; associate disclosure via `aria-describedby` on identity cards.
- [ ] **A11Y-6 (MINOR) — Sub-44px targets + type-floor slips (house calm bar).**
  Undo btn `minHeight:40` (MatchesListScreen.jsx:617 → 44); clear-filter × `width:32`
  (:704 → `minWidth:44`); collapse pills `fontSize:13` (ConversationScreen.jsx:1101,
  :1234 → 14).

**A11y passes (measured, no action):** all 5 new theme palettes clear AA
(worst 4.51:1); flag ribbon/stripes decorative + reduced-sensory-gated;
icon-only Reviewed seal correctly aria-hidden with row-label text; unread is
triple-coded; nav aria-current + labels + labeled badges; filter input 16px.

## Product opportunities (ranked value ÷ effort)

- [ ] **PROD-1 (S) — Legal links inside the logged-in app.** privacy.html/terms.html
  linked only from the logged-out landing footer; no path from SettingsScreen. Add a
  quiet "About & legal" block (plain links, `rel="noopener"`).
- [ ] **PROD-2 (S/M) — Self-host the two fonts.** index.html:32-36 render-blocks on
  Google Fonts across two third-party origins (owed item). Latin woff2 subsets in
  public/fonts/ + inline @font-face `font-display:swap`; delete preconnects. Accept:
  harness shows zero fonts.googleapis/gstatic requests.
- [ ] **PROD-3 (S) — Push-notification clicks land nowhere.** public/sw.js:28-47
  focuses an existing window but never navigates (`urlToOpen` only used on fresh
  window). Add `client.navigate(urlToOpen)` (or postMessage → Messages tab). Check
  the backend push payload's `data.url` first.
- [ ] **PROD-4 (S) — ReactionPicker keyboard semantics.**
  `src/messaging/ConversationScreen.jsx:125` `role="toolbar"` with no arrow-key nav.
  Cheapest: `role="group"` + aria-label; better: roving tabindex.
- [ ] **PROD-5 (M, careful) — Calm offline fallback for the installed PWA.** sw.js is
  push-only; offline = browser error screen. Add a navigation-only network-first
  fetch handler → one precached offline.html. **Do NOT cache hashed assets**
  (stale-chunk deploy scar tissue). Accept: offline emulation shows calm page AND a
  redeploy still serves newest bundle.
- [ ] **PROD-6 (OUT — needs backend) — Viewer-side photo gallery.** Members curate up
  to 6 photos w/ alt text + main choice, but every viewing surface renders ONE image
  (SuggestionScreen.jsx:904, MatchProfileModal.jsx:108-109). Live API `/matching/
  candidates` returns only `photoUrl`/`photoDescription` — no `photos[]`. Backend must
  expose `photos[]` first. Top backend ask; frontend slice after is S–M.

## Hygiene flags
- [ ] **HYG-1 — STATUS.md is dangerous:** its "CURRENT STATE" header still instructs
  the retired `npm run deploy` + `vercel alias` path CLAUDE.md forbids, and lags git.
  15-min refresh (or delete in favor of CLAUDE.md).
- [x] **HYG-2 — QA driver `scripts/qa/flows_mobile.mjs` fixed:** bad Playwright option
  `{ timeout, timeout: 8000 }` and theme cards queried as `button` not `radio`
  (they're `role="radio"`). Selectors corrected this session.

## Suggested next-session order
A11Y-1 + A11Y-3 together (one builder pass on the messaging surface) → A11Y-2
(safety-relevant) → A11Y-4/5 → the S-tier product wins (PROD-1,3,4) batched into
one lint/build/smoke/ship cycle → re-run the 4 unreported reviewers.
