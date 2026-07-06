# Spectrum Dating — Backlog (fine-tooth-comb final review)

_De-duplicated findings from a 12-agent audit panel (security, trust & safety,
accessibility, code review, performance, UX, moderation-console, product, growth,
user-journey, QA). Everything here is **fixable by us in code** — the items that
need YOU (keys, vendors, legal, business decisions) live in `CLIENT_ACTIONS.md`._

**Headline:** QA verdict is **no product-breaking bugs, smoke 11/11**. The site is
shippable. This backlog is the ordered cleanup list to make it _solid_.

Legend: 🔴 High · 🟡 Medium · ⚪ Low/Polish · 🔒 has a security/T&S dimension

---

## 1. Bugs — High (do before real users)

| # | Area | Bug | Fix | Source |
|---|---|---|---|---|
| B1 🔴🔒 | Backend | `GET /profile/:userId` (profile.js:796) is gated only on live-match-or-self — **a block does not end a match, so a blocked user can still fetch the full profile** (photos, audio, city). Same gap at messaging.js:831 (report-audio canSee). | Add a `NOT EXISTS (blocks pair)` check to both. | code-reviewer, code-reviewer |
| B2 🔴 | Frontend | `<ConversationScreen>` (MessagingApp.jsx:572) has **no `key`** → in the desktop 2-pane layout React reuses one instance across conversations; draft / attachment / ended-state **bleed to the wrong person** (you can send A's draft to B). | `key={currentConvo.id}`. | code-reviewer |
| B3 🔴 | Admin | `getAdminStats` + `getQueueCounts` mappers (api.js:664-700) **drop `pendingProfileAudio` + `oldestPendingProfileAudioAt`** → the Media-review card never counts pending audio and shows a **false all-clear**. | Add both fields to both mappers. | moderation-console-designer |
| B4 🔴 | Frontend | Onboarding Step 5 "Prefer not to say" gender pill is **selectable and the default** (`active={!gender}`), but `validateMeetStep` requires a non-empty value → the user selects it, taps Continue, and gets "Choose your gender" while it visibly shows selected. **Dead-end trap; can't proceed without disclosing.** | Give the pill a real sentinel value, or drop it in required mode. | user-journey-tester |
| B5 🔴 | Frontend | not-now vs skip in SuggestionScreen send an **identical** `swipe(id,'skip')` payload, but the confirmation copy differs ("may come up again" vs "won't see again") → **one message is always a lie.** | Distinct `defer` action, or make the copy match the single real behavior. | code-reviewer |
| B6 🔴 | Perf | Logged-out visitors download the **whole app** — SuggestionScreen/MessagingApp/LikesScreen are eagerly imported (App.jsx:4-6); entry bundle 368 kB / 104 kB gz. | `lazy()` + `<Suspense>` (Skeleton fallback). ~40-50 kB gz saved on first paint. | performance-optimizer |
| B7 🔴🔒 | A11y | Stacked dialogs (MatchProfileModal.jsx:62 + ReportModal.jsx:51) **both bind Escape to `document`** → one Esc closes **both**, and the two focus traps fight. Safety-relevant (report modal). | Gate the parent's Escape handler while a child dialog is open. | accessibility-auditor |
| B8 🔴🔒 | A11y | `LogoRevertShell` (App.jsx:465) — the identity-theme **panic-revert button has no focus ring** (no `useFocusable`). This is a safety-critical control (someone reverting a pride/trans theme in an unsafe room). | Add `useFocusable` + spread `f.style`. | accessibility-auditor |

## 2. Bugs — Medium

| # | Area | Bug | Fix | Source |
|---|---|---|---|---|
| B9 🟡 | Frontend | UnmatchSheet / BlockReportScreen (MessagingApp.jsx:587,597) read `currentConvo.otherUser.displayName` **unguarded** → crash when the partner is deleted/suspended. | `?.` + fallback name. | code-reviewer |
| B10 🟡 | Frontend | ConversationScreen socket reconnect (2084) rejoins the room but **never re-fetches** → messages sent while disconnected are lost, though the banner promises they'll appear. | Bump `reloadKey` on disconnect→connect. | code-reviewer |
| B11 🟡 | Frontend | ConversationScreen `retrySend` (2390) has **no in-flight guard** → double-tap = duplicate server message. | In-flight ref. | code-reviewer |
| B12 🟡🔒 | Backend | Conversation-cap enforcement (messaging.js:331, messageRequests.js:342, matching.js:227) is a **non-atomic SELECT-count-then-INSERT** → race can create a 6th conversation past the cap. | Transaction / conditional insert. | code-reviewer |
| B13 🟡🔒 | Backend | `reactions.js:43-83` POST reaction **bypasses `isConversationEnded` + `isBlocked`** (unlike the send path) → a post-unmatch/blocked "poke" via `emitReactionUpdate`. The reactions UI was removed, but **the route is still live.** | Add ended/block guards, or retire the endpoint (UI is gone — see B22). | backend-security-auditor |
| B14 🟡 | Admin | `applyQueueCounts` (AdminScreen.jsx:3832) never updates `lastUpdatedAt` → live counts move under a **frozen "Updated HH:MM"** timestamp. | Stamp freshness in `applyQueueCounts`. | moderation-console-designer |
| B15 🟡 | A11y | `MatchMoment.jsx:79` never stores `activeElement` → on close, focus **drops to `<body>`**. | Capture + restore focus. | accessibility-auditor |
| B16 🟡 | A11y | `clayText` eyebrow labels fail 4.5:1 on bg in **7 themes** (trans 3.98 … light 4.45). | Darken each `--c-clayText` 5-10%. | accessibility-auditor |
| B17 🟡 | A11y | dim `--c-formBorder` `#647A70` = 2.92:1 on surface (below 3:1). | Lighten to ~`#6E857B`. | accessibility-auditor |
| B18 🟡 | Frontend | SuggestionScreen skip handlers **advance the deck before `await swipe`** → next card flashes then corrects. | Mirror `handleInterested` (advance + stage after await). | code-reviewer |
| B19 🟡 | Growth | Admin self demo-tier toggle doesn't propagate to app tier state (stale until reload/Membership visit). | `onTierChange` up, or refetch on tab change. | growth-monetization-strategist |
| B20 🟡 | UX | Messages tab "Liked you" section **contradicts its own banner** ("People who liked you are in the Likes tab") and duplicates the Likes card. | Drop the block from Messages, or fix the banner copy. | design-ux-reviewer |

## 3. Bugs — Low / correctness nits

- **B21 ⚪** `Avatar.jsx:60` has no `onError` → a broken image shows the alt text "Photo of X" inside the circle instead of the monogram. Fix: `onError` → failed state → initials. _(also affects seeded fake-key avatars)_ — design-ux-reviewer
- **B22 ⚪🔒** `reactions.js:62` toggle is a SELECT-then-INSERT → 500 on concurrent taps. Route is live but UI is gone; simplest fix is to **retire the route** (also closes B13). Otherwise `ON CONFLICT DO NOTHING`. — code-reviewer
- **B23 ⚪** `matching.js:512-539` `/matching/activity` (who-liked-you) doesn't filter paused/suspended/banned likers. Fix: `AND p.paused=0 AND suspended=0 AND banned=0`. — backend-security-auditor
- **B24 ⚪** `profile.js:415` prefAgeMin>Max cross-check only runs when both are sent → an inverted range can persist → empty Discover. — code-reviewer
- **B25 ⚪** SuggestionScreen action buttons have no `disabled={submitting}` → double-submit window. — code-reviewer
- **B26 ⚪** SettingsScreen.jsx:510 — turning **Low-Stim off never restores** the user's prior `reduceMotion` (stuck on). Fix: remember/undo. — accessibility-auditor
- **B27 ⚪** ReportModal.jsx:179 — on submit the labelled heading unmounts → focus to body. Fix: focus the status `<p>` (`tabIndex -1`). — accessibility-auditor
- **B28 ⚪** OnboardingScreen.jsx:406 + RequireCityScreen.jsx:138 — `autoFocus` races the heading-focus effect. Fix: drop `autoFocus`. — accessibility-auditor
- **B29 ⚪** "Done for now" persists on the empty Discover state. Hide when the deck is empty. — design-ux-reviewer

## 4. Trust & safety gaps (code-fixable — vendor items are in CLIENT_ACTIONS §E)

| # | Gap | Fix | Source |
|---|---|---|---|
| T1 🔴🔒 | See **B1** — blocked user can still fetch profile/audio. | Block-pair check. | code-reviewer |
| T2 🟡🔒 | **No block/report of the _person_** inside the matched full-profile modal (MatchProfileModal.jsx:270 — only "report this voice note"). | Add "Block or report {name}" in the modal. | trust-safety |
| T3 🟡🔒 | **Ban-evasion:** a reported-not-yet-actioned user can self-delete + re-register with the same email as a clean account (evidence keyed to the defunct id; no ledger). _(Already blocked for banned/suspended users.)_ | Persist a salted email-hash ledger checked at register. _(SMS friction is the vendor half — CLIENT_ACTIONS §E.)_ | trust-safety, backend-security |
| T4 🟡🔒 | **GDPR erasure gap:** the `subscriptions` row is never deleted on account delete (no FK cascade). Matters once billing is live (`provider_ref` = Stripe id). | `DELETE FROM subscriptions` in `deleteUserRows` + cascade migration. | backend-security, trust-safety |
| T5 ⚪🔒 | `DELETE /account/me` requires only `requireAuth` — **no password re-entry** (unlike change-password/email) → a hijacked session can nuke the account. | Add a confirm/password step. | trust-safety |
| T6 ⚪🔒 | `deleteUser.js:20` collects R2 keys only for `uploader=self` → **the other party's message-attachment objects orphan** in the bucket. | Collect keys across the user's conversations, or periodic GC. | trust-safety |
| T7 ⚪🔒 | Reject paths **destroy the R2 object immediately** (admin.js:1170, audio.js:411) — that's evidence for a CSAM/NCMEC report. | Quarantine (move to a locked prefix) instead of delete on reject. | trust-safety |
| T8 ⚪🔒 | `export.js:33-54` accepts a legacy full-session JWT in `?token=` query (log/referer exposure). | Drop the session-JWT query fallback; keep purpose-token/header only. | backend-security |
| T9 ⚪🔒 | **Name/pronoun screening** misses troll input — `containsSlur` passes "Dipshit"; **pronouns are unscreened** ("Shit/shat/shart" shipped as a real card). | Extend the screen list + screen pronouns + review-before-Discover. _(Related purge decision is CLIENT_ACTIONS §F.)_ | user-journey-tester |
| T10 ⚪🔒 | No dedicated `off_platform_harm` reporter reason (falls to "other"); `minor_safety` has no direct reporter path (messaging.js:709). | Add the reasons to `REPORT_REASONS` / safetyReasons. | backend-security, trust-safety |

## 5. Missing / half-built features (code-side; vendor/business calls are in CLIENT_ACTIONS)

- **M1 🟡** **Companion catalog advertises unbuilt features** — higher photo cap (everyone gets 6), short-video answers (audio only), AI draft/tone help (static tray only), relocation matching (no code). Only advanced filters + best-fits + audio actually ship. **We can trim the catalog copy to reality on your say-so** (entitlements.js:53-59) — the business half (build vs trim) is CLIENT_ACTIONS §D2. — growth
- **M2 🟡** **No annual-plan selection mechanism** — checkout only sends `tier`, no interval, yet "$54/yr" is advertised. Code side: add interval selection **if** you keep the annual claim (CLIENT_ACTIONS §D3). — growth
- **M3 🟡** Orientation is **required at signup with no "Prefer not to say"** (only "Questioning"), while gender has an opt-out — inconsistent forced disclosure. Add an opt-out or make it optional. — user-journey-tester
- **M4 ⚪** `IntroComposeSheet` has no report affordance (minor — the Discover card has one). — trust-safety
- **M5 ⚪** Admin: `GET /admin/reports` has **no LIMIT/pagination** (heavy at scale); audit log hard-capped at 200 with no pagination. — moderation-console-designer
- **M6 ⚪** Export omits moderation-data-about-user (own `enforcement_notices`) — GDPR Art.15 judgment call, optional. — trust-safety

## 6. Polish (calm-by-design finish)

- **P1 ⚪** Hub's 3 icon-only controls (sliders / gear / bell) are ambiguous — Preferences vs Settings unclear. Add visible labels. — user-journey-tester, accessibility
- **P2 ⚪** Theme picker: light/navy/lightblue/pink cards have `note:""` → a ragged empty gap under the label in the equal-height grid. Give every theme a one-line note. — design-ux-reviewer
- **P3 ⚪** Empty Discover for a fresh account tells the user to adjust filters they never set. Add a "still finding people near you" state distinct from filter-narrow copy. — user-journey-tester
- **P4 ⚪** Onboarding Continue looks enabled before a photo is added (surprise reject). Add proactive "add one photo to continue" near the button. — user-journey-tester
- **P5 ⚪** Completeness "3 of 7" reads as a grade (gamification-adjacent — flagged by two agents). Reframe as an optional checklist, or confirm it stays. — user-journey-tester, accessibility
- **P6 ⚪** Photo-review note uses a 🔒 padlock (reads as locked/blocked). Drop it or use a soft shield. — user-journey-tester
- **P7 ⚪** Admin: every open report **pre-opens its decision panel** → a wall of alarm-styled forms. Pre-select the action; open the panel on tap. — moderation-console-designer
- **P8 ⚪** Admin: "Skip for now" is client-only; Refresh resurfaces skipped cards. Ban button still shows on an already-banned member. — moderation-console-designer
- **P9 ⚪** MembershipScreen.jsx:251 "Top Picks" copy reintroduces rejected Tinder framing (backend calls it "considered selection"). Rename to "Your best fits". — growth
- **P10 ⚪** `MatchProfileModal.jsx:113` dialog `aria-label="Profile"` is generic; label it by the name `<h1>` (`aria-labelledby`). — accessibility
- **P11 ⚪** Decorative illustrations in MatchesListScreen / EmptyConversationState / MatchProfileModal don't consume `reducedSensory` (product law). Thread it through. — accessibility
- **P12 ⚪** AuthScreen appeal `mailto:` fails silently without a mail client, and the address domain (`spectrum-dating.app`) mismatches the app domain — render a selectable address. — trust-safety

## 7. Tech-debt / our-own-pipeline

- **D1 🔴 (affects our ship gate NOW)** `eslint.config.js:13` ignores `dist/**` but **not `.claude/**`** → a worktree's `dist` makes `npx eslint .` return ~3726 errors locally. Fix: add `.claude/**` (or `**/dist/**`) to ignores. — code-reviewer
- **D2 🟡** **candidates.js:152 N+1** — one interest query per candidate (+ matching.js:97 recomputes the full deck per page). On 500 synthetic members: 60ms→2ms (28×) when batched into one grouped SELECT. Zero-tradeoff. — performance-optimizer
- **D3 ⚪** `db.js` migration runner **re-executes every migration on every boot** (no `schema_migrations` ledger). Works today (idempotent-ish) but fragile. — code-reviewer
- **D4 ⚪** AdminScreen index-based React keys (230/1082/1504/2734) on filterable tables → key by id. — performance-optimizer
- **D5 ⚪** Dead code: `api.js` `toggleReaction`, `socketClient` `reaction_update`, `sendStatusRef`/`setRateLimitStatus`/`onActivityCount` (unreferenced after reaction removal). — code-reviewer, qa
- **D6 ⚪** Stale QA drivers to port from the QA agent's worktree + refresh assertions: `openProfileEdit` rescope, `flows_mobile` rewrite (6-step + photo), `deep_messaging` (reactions removed), `deep_profile_settings:110` (Terms now in-app), `advanced_filters_locked:43` copy, `profile-completeness-jump` (seed-photo). — qa
- **D7 ⚪** `STATUS.md` is stale (references the retired `npm run deploy` path). Refresh or delete. — product-strategist
- **D8 ⚪** Font: Newsreader serif is 218 kB (132 base + 86 ext), `font-display:swap` so non-blocking — subset the display face (index.html:79). — performance-optimizer

---

### Suggested first sprint (highest value / lowest risk)
The **FIXABLE-NOW** cluster that's pure win: **B1/T1** (block→profile leak, security),
**B2** (draft bleed), **B3** (audio queue blind), **B4** (gender dead-end), **D1**
(unbreak our own eslint gate), **D2** (28× candidate query), **B6** (lazy-load entry
bundle), **B13/B22** (retire the dead reactions route), and the **M1 catalog-copy trim**
(pending your build-vs-trim call). None change product behavior the user relies on;
all are covered by `smoke.mjs` + the QA drivers.
