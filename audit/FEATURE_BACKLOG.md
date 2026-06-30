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
