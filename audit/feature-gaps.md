# Feature-Gap / Product Audit — Spectrum Dating

Dimension: missing features, functionality gaps, half-built/orphaned capabilities.
Method: cross-referenced backend routes (`Spectrum-Dating-Server/src/routes`) + migrations 001–029 against the frontend (`Spectrum-Dating/src`), and read the full STATUS.md backlog so already-shipped items are excluded. Calm-by-design respected: no typing indicators, online-now, read receipts, streaks, or urgency/gamification mechanics are proposed.

Priority key: 🔴 launch-blocking / trust / safety · 🟠 high value · 🟡 nice-to-have · ⚪ future.

NOTE on what's already DONE (so it isn't re-proposed): password reset (forgot/reset end-to-end), change-email, change-password, data export ("Download my data" wired), blocked-users list + unblock, self-serve verification request flow, activity inbox ("Liked you"), conversation search, message pagination, archived view + unarchive, profile-completeness nudge, profile preview, push subscribe toggle, plain-language + low-stimulation a11y modes, session-timeout warning, per-photo alt text, MatchMoment deep-link, proactive cap indicator, moderation audit-log table + endpoint (backend), feedback table + endpoints (backend). The gaps below are what remains.

---

## 1. HALF-BUILT / ORPHANED (backend/DB exists, no UI — or vice versa)

### `[FEATURE] 🔴 — Admin can't approve/reject verification requests from the dashboard`
- rationale: Trust/safety. The self-serve verification *request* flow shipped (users can request a badge; `verification_requests` table, `POST /profile/verification-request`), and the admin endpoint to act on it exists — but the moderation UI never surfaces it, so requests pile up with no way to action them. A verified badge nobody can actually be granted is a broken trust signal on a safety-sensitive app.
- state: half-built. Backend `POST /admin/users/:id/verify` (`routes/admin.js:142`) flips `profiles.identity_verified` AND syncs `verification_requests.status` — fully built. Frontend `AdminScreen.jsx` imports only `getAdminStats, getAdminReports, resolveReport, suspendUser` (line 2) — zero `verify` references; no per-user verify button, no pending-requests queue. `api.js` has no `verifyUser` helper.
- scope: M — `api.js` helper + a "Verification requests" section/list in `AdminScreen` (or a verify/unverify control on the user context in a report) + ideally a backend `GET /admin/verification-requests` list endpoint (only the single-user verify exists today, so admins have no list of who's pending).

### `[FEATURE] 🟠 — Moderation audit log has no admin UI`
- rationale: Accountability + abuse-of-admin trail (Trust & Safety / legal posture). Every suspend/unsuspend/verify/resolve already writes an append-only `moderation_log` row, and the read endpoint is built — but a moderator can never see it.
- state: half-built. `GET /admin/audit-log` (`routes/admin.js:173`, returns last 200 actions w/ actor email) is fully implemented; migration `027_moderation_log.sql` exists. No `getAuditLog` in `api.js`; no view in `AdminScreen.jsx`. The User Journey Tester confirmed live the admin screen is "only Reports + suspend/unsuspend + stats."
- scope: S — `api.js` helper + a read-only "Activity log" tab/section in `AdminScreen` (list of action / actor / target / time / detail).

### `[FEATURE] 🟠 — User feedback channel ("tell us what felt wrong") is entirely unreachable`
- rationale: Product value + calm-by-design fit. `POST /feedback` is described in-code as an "always-on 'tell us what felt wrong' channel" — exactly the low-pressure, non-confrontational way an autistic user reports friction without it being a formal report. It's built on both ends of the DB but has no entry point and no moderator inbox.
- state: half-built (orphaned both directions). Backend `POST /feedback` (`routes/feedback.js:12`, rate-limited, ≤2000 chars) + `GET /admin/feedback` (`routes/admin.js:222`) + migration `020_feedback.sql` all exist. `api.js` has NO `submitFeedback`; no UI anywhere lets a user submit; `AdminScreen` has no feedback view.
- scope: M — `api.js` `submitFeedback` + a small "Send feedback" surface (Settings or Safety) + a "Feedback" read-only list in `AdminScreen`.

### `[FEATURE] 🟡 — Read cursors drive only the sender's unread dot; recipient gets no "delivered/landed" reassurance`
- rationale: Autism-friendly clarity. Literal-communication users often feel anxiety not knowing whether a message *arrived* (distinct from "was read" — read receipts are correctly excluded by principle). The `last_read_at_a/b` columns exist and power the list-level unread dot, but there's no calm, non-pressuring "delivered" affordance. Must be designed to NOT become a read-receipt/pressure mechanic (e.g. a quiet one-time "Sent" state on your own bubble only, never surfaced to the other person as "seen").
- state: partial. `008_read_cursors.sql` columns + `markConversationRead` exist; only the viewer's own unread badge consumes them. No per-message delivery state on bubbles.
- scope: S — frontend-only "Sent" micro-state on own optimistic bubbles; deliberately no "seen by them" surface.

---

## 2. MISSING TABLE-STAKES (a dating product needs these; absent)

### `[FEATURE] 🔴 — No gender / orientation / "who you want to meet" — everyone is shown everyone`
- rationale: The single biggest table-stakes gap. Migration `024_gender_seeking.sql` added `gender`, `pronouns`, `seeking` columns and `026_age_pref.sql` added `pref_age_min/max`, but candidate filtering and the UI don't let a user *set who they're seeking* as a structured identity. `pronouns` is surfaced; `gender`/`seeking` are collected nowhere in onboarding and the matching engine matches on interests + lifestyle deal-breakers, not gender/seeking. A dating app cannot meaningfully ship without people saying who they are and who they want to see. For an autistic audience, explicit structured identity/seeking beats inferred.
- state: partial/half-built. DB columns exist (migrations 024/026); `pref_age_min/max` + `search_radius` appear wired in the profile editor per STATUS, but `gender`/`seeking` capture + the candidate-side filter need confirming/completing. Verify `candidates.js` actually filters on `seeking`×`gender`; if not, the columns are orphaned.
- scope: M–L — onboarding + profile fields for gender/seeking, candidate-query filter, and "show me" preference UI; touches matching core.

### `[FEATURE] 🟠 — Report is always fused to block; reason taxonomies differ by surface`
- rationale: Safety + control. `BlockReportScreen.jsx` always "Block and report" (`:66`, `:271`); the pre-match `ReportModal` also blocks on report. Sometimes a user wants to flag behavior to moderators while still deciding — or block without the weight of a formal report. The backend already separates them (`POST /block` and `POST /report` are independent per messaging.js comment ":467 SEPARATE from /block"), so this is purely a frontend coupling. Reasons also diverge by surface (pre-match: inappropriate/spam; chat: harassment/spam/inappropriate/other), complicating triage and the user's mental model.
- state: partial. Backend supports report-without-block; frontend forces the fusion. Reason lists not unified.
- scope: S–M — split the actions in the UI; unify the reason taxonomy across both surfaces.

### `[FEATURE] 🟠 — No email notification preferences / low-frequency digest`
- rationale: Re-engagement without urgency. The product (rightly) strips urgency cues and push is opt-in only; there is no email/in-app digest fallback to quietly bring people back ("you have a new match — no rush"). For a calm async product this is the *one* sanctioned re-engagement path, and there are no notification-preference controls (frequency, channel, types) beyond the binary push toggle. Email infra (`resend.js`) already exists for verification/reset.
- state: missing. No notification-preferences table/columns, no email-digest job, no UI.
- scope: M — preferences schema + a calm "How we let you know" Settings section + a low-frequency digest job (gated on email being configured).

### `[FEATURE] 🟡 — Photo moderation / attachment "scan" is a no-op; chat attachments still dark`
- rationale: Safety (CSAM/abuse on a dating platform) + a half-built capability carrying real surface area. `POST /photos/confirm` flips status to `'scanned'` with zero actual scanning; the whole chat-attachment compose path is built but gated behind `ATTACHMENTS_ENABLED=false` and `sendMessage` can't even link an attachmentId, so photos wouldn't persist if enabled. (R2 itself is a known founder-blocked dependency.)
- state: half-built / partial. Upload + presign + scan-status plumbing exists; real scanning and the message↔attachment link do not.
- scope: M — a real moderation/human-review queue (or honest status naming) before serving, plus the message↔attachment persistence link before flipping the flag.

### `[FEATURE] 🟡 — Reporting feedback loop is one-directional past status`
- rationale: Trust. "Your reports" shows status (Open/Reviewed/Actioned/Dismissed) — good — but a reporter never learns the *outcome* in plain terms, and there's no acknowledgement when a moderator resolves. Closing this loop reassures a vulnerable cohort that reporting *does something*.
- state: partial. Status pills exist (`getMyReports`); no outcome message / resolution acknowledgement surfaced to the reporter.
- scope: S — surface the moderator's resolution disposition (sanitized) on the reporter's "Your reports" entry.

---

## 3. AUTISM-FRIENDLY DIFFERENTIATORS (calm-aligned, advance the mission)

### `[FEATURE] 🟠 — Onboarding never collects the autism-specific "moat" fields, so early decks look generic`
- rationale: Mission-critical. Discover cards render "How I communicate" chips, sensory prefs, and Hinge-style prompts; the profile editor lets you set them — but onboarding (`OnboardingScreen.jsx`) gathers only name / DOB / tagline / bio / interests. New users start with every autism-*differentiator* field empty (`comm_directness`, `comm_literal`, `comm_cadence`, `sensory_environment`, `sensory_lighting`, `social_duration`, `context_card`, prompts), so the feature that *is* the product is invisible until someone digs into Profile. The completeness nudge helps after the fact, but the first-run moment is the highest-leverage place to set 1–2 of these.
- state: partial. Fields fully built in the editor + backend (migration `018_richer_profile.sql`); absent from the onboarding flow.
- scope: M — one optional, clearly-skippable onboarding step for a couple of comms/sensory prefs or a single prompt.

### `[FEATURE] 🟠 — Communication/sensory preferences aren't used as matching signals or as a "fit" why-reason`
- rationale: This is the differentiator's payoff. Users disclose comms directness/literalness/cadence and sensory needs, and they appear on cards — but matching scores on interests + lifestyle only; there's no "you both prefer quiet settings" or "you both reply once a day" compatibility surfacing, and no soft preference to weight comms/sensory fit. Turning disclosure into *matching* is what makes the moat real and reduces mismatch anxiety.
- state: missing (as a matching signal). Data is collected and displayed but not scored or surfaced as a fit reason.
- scope: M — extend the candidate scorer to add a comms/sensory-alignment bonus + a `whyReason` ("You both prefer …"); no new schema.

### `[FEATURE] 🟡 — No structured "what to expect" / pre-conversation expectation-setting`
- rationale: Predictability reduces anxiety. The Safety Center scripts and conversation starters are excellent, but there's no per-profile/per-chat "what to expect from me" framing surfaced *before* opening a chat (e.g. the match's `context_card` and cadence shown as a calm expectations card on entry to the thread). The `context_card` is correctly post-match-gated and already returned on `match.otherUser` — it just isn't surfaced as an expectation cue at the conversation entry point.
- state: partial. `context_card` + cadence exist on the match payload; not surfaced as a pre-chat expectations card.
- scope: S — render an "How they like to talk" expectations card on conversation open from already-available data.

### `[FEATURE] 🟡 — No content/sensitivity warning or "ease-in" pacing affordance on profiles or first message`
- rationale: Calm/sensory fit. Beyond reduce-motion/low-stimulation, there's no way for a member to flag a profile section as sensitive, nor any structured low-pressure "slow start" (e.g. an opt-in "I prefer to exchange a couple of prompts before open chat"). A sanctioned slow-mode that's *mutual and opt-in* (never a lock-out) fits the audience well.
- state: missing.
- scope: M — opt-in slow-start preference + a structured first-exchange flow building on the existing starters.

### `[FEATURE] ⚪ — Note-to-self / memory aid on a match`
- rationale: An autistic audience juggling several conversations may want a private, lightweight memory aid ("met at the book club thing", "sensory: dislikes loud bars") — calm, private, no social signal. Low urgency but high quality-of-life and on-mission.
- state: missing.
- scope: M — private per-match note column + small UI; owner-only.

---

## Notes / verification owed
- `gender`/`seeking` filter: columns exist (migration 024) but confirm whether `candidates.js` actually filters on them — if not, those columns are orphaned and the 🔴 above is fully "missing", not "partial".
- All findings are source + migration cross-referenced against the STATUS.md backlog; live admin-UI absence of audit-log/feedback/verify views is independently corroborated by the User Journey Tester's 2026-06-30 live sweep (STATUS.md:1080).
