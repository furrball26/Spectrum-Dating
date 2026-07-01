# Spectrum Dating — Feature Backlog

Consolidated from the 2026-06-30 audit (Feature-Gap & Product, plus engineering gaps from Code Quality). Already-shipped backlog items (password reset, change email/password, data export, blocked-list + unblock, verification *request* flow, activity inbox, conversation search, message pagination, archived view, completeness nudge, profile preview, push toggle, plain-language + low-stimulation modes, session-timeout warning, per-photo alt text, MatchMoment deep-link, proactive cap indicator) are excluded.

Priority: 🔴 launch-blocking / trust / safety · 🟠 high value · 🟡 nice-to-have · ⚪ future

> **Correction applied:** the audit's draft "🔴 no gender/seeking — everyone shown everyone" was **wrong**. `candidates.js:102-118` already filters mutually on gender + seeking + age, and the Profile editor captures Gender + Seeking. The real, narrower gap is that **onboarding** doesn't collect them (F7). Downgraded accordingly.

---

## A. Orphaned / half-built (backend exists, no UI)

| # | Feature | Why | State | Size |
|---|---|---|---|---|
| F1 🔴 | **Admin verify approve/reject UI** | Self-serve verification *requests* ship, but moderators have no way to action them → requests pile up, verified badge is ungrantable (broken trust signal). | `POST /admin/users/:id/verify` fully built (`admin.js:142`); `AdminScreen.jsx` has zero verify UI; no `verifyUser` in `api.js`; no pending-requests list endpoint. | M |
| F2 🟠 | **Moderation audit-log admin view** | Accountability / abuse-of-admin trail (T&S + legal). Every suspend/verify/resolve already logs. | `GET /admin/audit-log` built (`admin.js:173`); no `api.js` helper, no UI. | S |
| F3 🟠 | **User feedback channel** (submit + moderator inbox) | The sanctioned low-pressure "tell us what felt wrong" path for autistic users; built both DB ends, no entry point. | `POST /feedback` + `GET /admin/feedback` built; no `submitFeedback` in `api.js`, no submit UI, no admin view. | M |
| F4 🟡 | **Calm "Sent" micro-state on own bubbles** | Literal-communication users feel anxiety not knowing a message *arrived* (distinct from read receipts, which stay excluded). Must never surface "seen by them." | `read_cursors` columns exist; only the viewer's unread dot consumes them. | S |

## B. Table-stakes (a dating product needs these)

| # | Feature | Why | State | Size |
|---|---|---|---|---|
| F5 🟠 | **Decouple Report from Block in the UI** | Backend already separates `/report` and `/block`; the UI forces "Block and report," so a user can't flag behavior while still deciding, or block without a formal report. Unify the divergent reason taxonomies too. | Frontend coupling only (`BlockReportScreen.jsx:66,271`). | S–M |
| F6 🟠 | **Email notification preferences + low-frequency digest** | The one sanctioned, non-urgent re-engagement path for a calm async product (push is opt-in only; no fallback). Email infra (`resend.js`) already exists. | No prefs schema, no digest job, no UI. | M |
| F7 🟠 | **Onboarding collects the autism "moat" fields** (1–2 comms/sensory prefs or a prompt, + gender/seeking) | New users currently start with every differentiator field empty until they dig into Profile; first-run is the highest-leverage place to set them. (Editor + matching already support them — see correction above.) | Fields built in editor + backend; absent from `OnboardingScreen.jsx`. | M |
| F8 🟡 | **Real photo / attachment moderation** | Safety (CSAM/abuse). Ties to E2 — the chat-attachment "scan" is a no-op and the message↔attachment link is missing. | Half-built; needs real review queue + honest status before serving. | M |
| F9 🟡 | **Close the reporting feedback loop** | A reporter sees status (Open/Reviewed/…) but never the plain-language *outcome*; closing it reassures a vulnerable cohort that reporting does something. | Status pills exist; no resolution acknowledgement. | S |

## C. Autism-friendly differentiators (advance the mission)

| # | Feature | Why | Size |
|---|---|---|---|
| F10 🟠 | **Use comms/sensory prefs as a matching signal + "why" reason** | The differentiator's payoff: turn disclosed prefs into a "you both prefer quiet settings / reply once a day" fit bonus. Data is collected + displayed but never scored. | M (scorer + `whyReason`, no schema) |
| F11 🟡 | **Pre-conversation "what to expect" card** | Predictability reduces anxiety; surface the match's `context_card` + cadence as a calm expectations card on chat entry (data already on the match payload). | S |
| F12 🟡 | **Opt-in mutual "slow start" pacing** | A sanctioned, mutual, never-locking slow-mode (exchange a couple of prompts before open chat) fits the audience. | M |
| F13 ⚪ | **Private note-to-self on a match** | Owner-only memory aid ("met at book club", "dislikes loud bars") for users juggling several conversations. | M |

## E. From live customer testing (User Tester, 2026-06-30 — 7/7 use cases PASS)

| # | Feature | Why | State | Size |
|---|---|---|---|---|
| F16 🟠 | **Add "undo" for "I'm interested" (un-like)** | Tapping the like is permanent; only Skip is reversible (`undo-skip` deliberately excludes likes, `matching.js:164-183`). An irreversible mis-tap clashes head-on with the "your own pace / no dark patterns" promise — the single most on-mission gap from live testing. | Backend undo exists for skips only; no un-like path or UI. | S–M |
| F17 🟡 | **Make "Pause my profile" instantly accessible** | A "take a break" action is buried deep in the long profile-edit form and only applies after the global "Save changes." For an audience explicitly told "leave whenever you like," it should be one tap and immediate (mirror how Archive works). | Works, but heavy + easy to miss. | S |

## D. Engineering / platform

| # | Item | Why | Size |
|---|---|---|---|
| F14 🟠 | **Add tests + lint + CI baseline** | Zero automated tests, no ESLint (the `eslint-disable` comments are no-ops), no CI in either repo — for an app handling auth/JWT/blocking/migrations. | M |
|  |  | Suggested: ESLint + `eslint-plugin-react-hooks` (auto-enforces the hooks-before-early-return + exhaustive-deps house rules); Vitest for matching/scoring + coarse-location helpers; a **boot-DB-twice migration-idempotency test** (would catch E1); a minimal GitHub Actions lint+test-on-PR. | |
| F15 🟡 | **Extract shared helpers** | `useFocusable`/`focusRing` duplicated ~12×; comms-sensory chip mapping 3×; coarse-location regex 5× (privacy-critical — see E17). DRY these into shared modules. | S |

---

# Round 2 — 2026-06-30 (8-agent re-audit)

> **Corrections:** (1) R1's **F10** ("comms/sensory never scored") is now **partly shipped** — `score.js:25-37` scores `sensory_environment` + `comm_cadence` with why-reasons; re-scoped to **F10b** below. (2) gender/seeking capture + mutual filtering **confirmed working** — the real gaps are onboarding + a Discover filter surface (F16). All other R1 features (F1–F15) **re-confirmed still open** (builder paused). Full detail in `audit/round2-feature-gaps.md` + `round2-trust-safety.md` + `round2-user-testing.md`.

## New — table-stakes & discovery

| # | Feature | Why | State | Size |
|---|---|---|---|---|
| F18 🔴 | **Discover-side filter surface** | The engine honours age/radius/gender/seeking/deal-breakers (`candidates.js:96-120`) but the **only** way to change them is buried in the profile-edit form behind a global Save. Discover offers no in-context filter — when the deck empties it just *tells* you to edit your profile. A clear "who am I seeing & why" panel is more important than average for an autistic audience. | Missing UI (backend + editor fields exist). | M |
| F19 🟠 | **Withdraw a filed report** | No withdraw UI and no backend endpoint — a user who reports in error (plausible when overwhelmed) is stuck forever and the mod queue keeps un-retractable false reports. Agency/trust gap. | Missing (create + read only). `messaging.js`, `SafetyScreen.jsx:662` | S–M |
| F20 🟠 | **Replace-photo + last-photo guard** | No "Replace" (must Remove→Add); removing your only photo gives no warning and leaves you photoless-but-still-in-Discover. | Missing. `photos.js:153-183`, `ProfileScreen.jsx:284-488` | S |
| F21 🟠 | **Unmatch acknowledgement (no silent vanish)** | When the other person unmatches, the match + conversation hard-delete on both sides with no notice/tombstone — a returning user just finds the thread gone. Poor predictability for this audience. | Missing. `matching.js:235-249` | S |
| F22 🟡 | **Distinguish "no candidates" from "seen everyone"** | Discover shows the same exhausted-state whether you saw everyone or had zero candidates (`atEnd = 0 >= 0`), misleading a too-tight-filter user. Name the active filter that's excluding people. | Partial. `SuggestionScreen.jsx:491,690` | S |
| F23 🟡 | **Conversation-list wayfinding** | Rows show only name + "Today" — no last-message snippet or who-replied-last cue (NOT an unread count — that stays excluded), so multi-thread users can't tell where they left off. | Missing. `MessagingApp.jsx` list rows | S |
| F24 🟡 | **Paused-profile Discover reminder/gate** | A paused user can still browse + like in Discover with no "you're paused" indication. | Missing. `ProfileScreen` pause + `SuggestionScreen` | S |

## New — trust & safety capabilities

| # | Feature | Why | Size |
|---|---|---|---|
| F25 🟠 | **Make identity verification real (or relabel it)** | The "Verified" badge has **no identity check** behind it — `verification-request` collects no artifact; admin just toggles a boolean. A vulnerable audience over-trusts a literal "Verified." Either collect a selfie/liveness/ID artifact, or relabel to what it asserts ("Reviewed by our team") + microcopy. | M |
| F26 🟠 | **Calm in-chat anti-grooming / anti-scam friction** | Romance-scam/grooming playbooks (rapid intimacy, "move to WhatsApp", money requests) are disproportionately effective against this cohort, and there's zero in-chat friction. Add a one-time "staying safe in chat" card + gentle non-blocking notes on external-contact/money keywords (informational, shame-free, never auto-removing). | M |

## New — differentiators & richness

| # | Feature | Why | Size |
|---|---|---|---|
| F10b 🟠 | **Score the 4 still-inert moat fields + compatibility framing** | `comm_directness`, `comm_literal`, `sensory_lighting`, `social_duration` are collected + shown on cards but never scored (`score.js` only reads sensory+cadence). These are exactly where mismatch causes the most friction. Add alignment bonuses + why-reasons; optional user-set "what matters most to me" weight + a plain-language fit summary. | M |
| F27 🟠 | **Richer conversation tooling for literal/structured communicators** | Extend starters into a "conversation helpers" tray: reusable copy-able "clarity" phrases ("I need a little time to reply — that's normal for me") and an optional structured "suggest a low-key plan" composer built on both people's sensory prefs. Reduces blank-page anxiety — the product's reason for being. | M |
| F28 🟡 | **Structured "about me" facets** | Profiles are strong on the moat but thin on ordinary scannable facets (occupation/study, languages, "things that help me / things that are hard for me") that give predictable context instead of forcing inference from free-text bio. 2–3 optional structured facets. | M |

## New — platform / cleanup
- **F29 🟠 — Orphaned `notification_preferences` table** (`003_messaging.sql:31-34`) read by zero code; the live tier is `profiles.notification_tier`. Either delete it or repurpose it as the multi-channel prefs store F6 needs. (Pairs with F6 email digest.)

## Still open from R1 (re-confirmed, builder paused)
F1 (admin verify UI), F2 (audit-log UI), F3 (feedback channel), F4 (Sent micro-state), F5 (decouple report/block), F6 (email digest / notif prefs), F7 (onboarding captures discovery + moat fields — **expanded**: onboarding omits gender/seeking/age/radius AND all 7 moat fields), F8 (real photo moderation), F9 (report outcome), F11 (pre-chat "what to expect" card — data already on the payload), F12 (opt-in slow start), F13 (private note-to-self), F14 (tests/lint/CI), F15 (shared helpers), F16 (un-like undo), F17 (instant pause — reconfirmed: toggle applies only on global Save).
