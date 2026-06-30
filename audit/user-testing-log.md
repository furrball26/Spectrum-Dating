# User Testing Log — Spectrum Dating

## Run: 2026-06-30 (live browser session, Claude-in-Chrome)

**🔴 CRITICAL: none.** All core customer goals were reachable and completable. No completely-failed core flow.

Tested live against https://spectrum-dating-eta.vercel.app as the sample user **mira.k.1@sample.spectrum-dating.app** (Mira K., verified, profile 7/8). Logged-out landing tested by signing out first. Backend confirmed via `/profile/me`, `/matching/*` and route source review. No console errors observed during the session.

> Note: the browser arrived logged in as a *different* account ("Taylor", user 71gPAVsxpv3gkulIdQFiE — appears to be the owner's own test profile). I signed out of it (no mutations made there) and logged in as the designated sample user mira.k.1 before testing, per instructions.

---

## Use cases this run

| # | Persona · Goal | Result | What happened |
|---|----------------|--------|---------------|
| 1 | Anxious first-timer evaluating the site before signing up | **PASS** | Logged-out landing is calm and reassuring: "Meet people at your own pace", "No typing dots. No 'online now.' No rush", a "What you won't find here" section, and footer "Built with autistic adults. Always opt-in. No dark patterns." Clear "Create your profile" + "Sign in". |
| 2 | Local match seeker with a shared special interest | **PASS** | Discover card shows shared interests highlighted (`+ botany / gardening / nature`), an "About talking" line, and a "Why you're seeing [name]" rationale (shared interests, comm style, long-term goal). "I'm interested" gives a calm, privacy-preserving confirmation: "Until then, [name] isn't told." |
| 3 | User setting communication / sensory preferences so matches know how to talk to them | **PASS** | Profile editor has structured selectors: "How you communicate" (Directness, Style, Reply pace, free-text "How to talk to me") and "Sensory & environment" (Preferred setting, Lighting, Social energy). These render on the public card as chips ("Direct / Literal / Replies once a day / Quiet settings / Dim lighting"). |
| 4 | User safely reporting / blocking someone who made them uncomfortable | **PASS** | Conversation "···" menu → Unmatch / Block and report / Archive. Report form has reason radios (Harassment / Spam / Inappropriate content / Other) + optional details; submit is correctly disabled until a reason is chosen. "Report [name]" also available directly on Discover cards. (Did not submit — would destroy the sample match.) |
| 5 | User pausing or deleting their account | **PASS** | "Pause my profile" toggle exists on Profile (with explanatory text that you won't appear in Discover). Delete account lives in a clearly-labelled "Danger zone" ("permanent and cannot be undone") behind a confirmation dialog (verified in source: `DeleteAccountSection` → `showDialog` before `deleteAccount()`), with "Download my data" (JSON export) offered right above. (Did not execute delete.) |
| 6 | Returning user catching up on messages | **PASS** | Messages → "Your matches" with name filter, Active conversations (1/5), Archived section. Eli Brenner thread opens and reads cleanly; composer present; a heart reaction renders. No urgency/unread-count pressure (calm-by-design, expected). |
| 7 | Privacy-conscious user checking exactly what strangers can see | **PASS** | Profile → "Preview my card" ("How others see you") modal shows the exact public card and explicitly labels match-only content: "IN THEIR WORDS (visible to your matches only)". Strong transparency. |

---

## Functionality gaps & errors

### 1. [FEATURE-GAP] No way to withdraw an "I'm interested" (like) — only "skip" is undoable 🟠
- **Where:** Discover flow ("I'm interested") + backend `POST /matching/swipe`, `POST /matching/undo-skip`.
- **Repro:** Tap "I'm interested" on a Discover card → calm confirmation screen with only "Next person". There is no undo on that screen, and nowhere else in the product to take an "interested" back (before a mutual match exists).
- **Expected:** A user who mis-taps "I'm interested" (very plausible for this audience, and consistent with the calm/in-control ethos) can take it back, the same way a skip can be undone.
- **Actual:** `undo-skip` *by design* only deletes the most recent `decision='skip'` and "Never touches 'like' swipes" (server comment). The like persists with no user-facing reversal.
- **file:line:** `Spectrum-Dating-Server/src/routes/matching.js:164-183` (undo-skip likes-excluded); `:99-114` (swipe insert, 409 on repeat so it can't even be re-set).
- **Severity:** 🟠 (asymmetric reversibility; mis-tap is unrecoverable, which clashes with the "no dark patterns / at your own pace" promise).

### 2. [FEATURE-GAP] "Pause my profile" is buried mid-form and gated behind the global "Save changes" 🟡
- **Where:** Profile screen, "Pause my profile" card (between Notifications and Identity verification).
- **Repro:** A user who just wants to step away must scroll deep into the long profile-edit form, flip the toggle, then scroll to the bottom and press "Save changes" for it to apply.
- **Expected:** For an audience explicitly served the option to "leave whenever you like", pausing should be quick to find and ideally apply instantly (like Archive conversation does), not require finding + committing the whole profile form.
- **Actual:** Pause is one field inside the big profile form; it doesn't take effect until the form-level Save. Easy to miss / feels heavy for a "take a break" action.
- **file:line:** `Spectrum-Dating/src/ProfileScreen.jsx:3219-3233` (PauseToggle in form), `:735-760` (PauseToggle component).
- **Severity:** 🟡 (works, but discoverability + friction for a calm-by-design audience).

### 3. [FEATURE-GAP / minor] "Set who you're looking for" completeness chip doesn't visibly jump to the section 🟡
- **Where:** Profile → "Profile completeness" (7/8) → "Set who you're looking for" pill.
- **Repro:** Clicking the pill produced no visible scroll/jump for me to the "Who do you want to meet?" checkboxes (which is the actual missing item — `seeking` is empty).
- **Expected:** The completeness chip should scroll to / focus the relevant field so the user knows where to go.
- **Actual:** No observable navigation on click; the user must manually hunt down the "About your search → Who do you want to meet?" checkboxes.
- **file:line:** `Spectrum-Dating/src/ProfileScreen.jsx:1149` (completeness item def). Suspected missing/failed scroll-to-anchor; not deeply confirmed.
- **Severity:** 🟡 (minor wayfinding nit; goal still achievable).

---

## Strengths worth preserving (not gaps)
- Match rationale ("Why you're seeing X") and shared-interest highlighting are excellent for the special-interest persona.
- Privacy framing throughout: "isn't told" on like; "visible to your matches only" labelling in the preview; data export before delete; report submit gated until reason chosen.
- Calm-by-design correctly observed: no typing indicators, no online/last-seen, no unread-count pressure, quiet match confirmation. These absences are intentional and were NOT logged as gaps.

## Coverage & caveats
- Live browser control available via Claude-in-Chrome `computer`/`javascript_tool`/`navigate`/`browser_batch`. Several read tools (`read_page`, `get_page_text`, `find`, `list_connected_browsers`) were permission-denied this run; worked around with screenshots + JS + source review.
- Did NOT execute irreversible/destructive actions on the sample account: no account delete, no block/unmatch (would destroy mira's only match), no message delete (leaves permanent tombstones — note: 4 tombstones already exist in the Eli thread from prior testers).
- Delete-account final modal behavior confirmed by source, not by clicking through.
- Onboarding/sign-up flow for a brand-new user not exercised (instructed never to create accounts); evaluated only the logged-out landing + sign-in form.

## Sample data touched / restored
- **mira.k.1 → Lucia Moreno: "I'm interested" (like) — NOT restorable.** This created a `swipes` row (decision=like). The product exposes no un-like, and `undo-skip` excludes likes by design, so I could not revert it via the UI/API available to me. No mutual match resulted (Lucia did not reciprocate), and per the app's own copy Lucia "isn't told", so the residual state is invisible to the other party and creates no match. Flagging for a maintainer to delete the swipe row directly if a clean sample state is required.
- Opened the "Block and report Eli Brenner" form and the profile editor but **submitted/saved nothing** — backed out without mutation. mira's match with Eli is intact.
- Signed out of the pre-existing "Taylor" session and signed into mira.k.1; no data changed on the Taylor account.

~User Tester
