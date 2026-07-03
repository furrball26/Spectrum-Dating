# Round-2 Feature-Gap / Product Audit — Spectrum Dating

Dimension: missing features, functionality gaps, half-built/orphaned capabilities — pushing into the areas R1 under-explored: **onboarding completeness, matching-algorithm sophistication, discovery controls the user can actually set, conversation tooling, profile richness, re-engagement, and best-in-class autism-friendly differentiators.**

Method: re-read STATUS.md + `audit/FEATURE_BACKLOG.md` + `audit/feature-gaps.md` (R1) so nothing shipped is re-proposed, then verified every claim against current source — the matching engine (`matching/candidates.js`, `matching/score.js`), all routes/migrations, onboarding, the profile editor, and the messaging/conversation layer.

Calm-by-design respected throughout: **no** typing indicators, online-now, read receipts, streaks, or urgency/gamification are proposed.

Priority: 🔴 launch-blocking / trust / safety · 🟠 high value · 🟡 nice-to-have · ⚪ future.
Tags: **NEW** (not in R1) · **CONFIRMS-R1** (re-verified, still open) · **CORRECTS-R1** (R1 was wrong or now stale).

---

## Corrections to R1 (verify-before-asserting)

1. **R1 F10 ("comms/sensory prefs never used as a matching signal") is now PARTLY SHIPPED — CORRECTS-R1.** `matching/score.js:25-37` *does* score `sensory_environment` (+2) and `comm_cadence` (+2) as exact-match bonuses, and `buildWhyReasons` (`score.js:52-65`) emits "You both prefer quiet settings" / cadence reasons. So the *concept* landed. What remains (re-scoped below as **F10b**) is that **four of the seven moat fields are still inert**: `comm_directness`, `comm_literal`, `sensory_lighting`, `social_duration` are collected + displayed but never scored or surfaced as a why-reason.

2. **R1's "gender/seeking captured nowhere" worry is resolved — CORRECTS-R1.** `candidates.js:102-120` filters mutually on gender×seeking AND age-range AND radius, and the Profile editor captures all of them (`ProfileScreen.jsx:1657-1662`). The real, narrower gap (F7, F-NEW-1) is **onboarding** omitting them and the **absence of a Discover-side filter surface**.

---

## A. Orphaned / half-built (backend or DB exists, no UI — or vice versa)

### `[FEATURE] 🟠 — Orphaned `notification_preferences` table; the live tier lives elsewhere` · **NEW**
- rationale: A whole table was built for notification preferences and then bypassed. `notification_preferences(user_id, tier DEFAULT 'in_app')` is created in `server/src/migrations/003_messaging.sql:31-34` but is referenced by **zero** server code (grep across `src` returns only the migration). The tier actually in use is `profiles.notification_tier` (`routes/profile.js:32,93,319`). Dead schema is a correctness/clarity trap for the next dev and signals the notification-prefs model was half-rebuilt. Also a foundation that *should* have become the email-digest prefs store (see F6) but didn't.
- state: orphaned (DB table with no reader/writer) — `server/src/migrations/003_messaging.sql:31-34`.
- scope: S — either delete the dead table in a new migration, or repurpose it as the multi-channel prefs store F6 needs (don't leave it dangling).

### `[FEATURE] 🔴 — Admin can't approve/reject verification requests` · **CONFIRMS-R1 (F1)**
- rationale: Re-verified still open. Self-serve verification *requests* ship (`requestVerification` in `api.js:147`; `verification_requests` table, migration 028), and the admin action endpoint `POST /admin/users/:id/verify` (`routes/admin.js:142`) is fully built — but `AdminScreen.jsx` has no verify UI and `api.js` has no `verifyUser`/`getVerificationRequests` helper (grep confirms neither exists). Requests pile up; the verified badge — a core trust signal for a vulnerable audience — is effectively ungrantable.
- state: half-built — backend `routes/admin.js:142`; no list endpoint, no `api.js` helper, no UI.
- scope: M — `GET /admin/verification-requests` list endpoint + `api.js` helpers + a "Verification requests" queue in `AdminScreen`.

### `[FEATURE] 🟠 — Moderation audit log has no admin UI` · **CONFIRMS-R1 (F2)**
- rationale: Still open. `GET /admin/audit-log` (`routes/admin.js:173`) returns the append-only `moderation_log` (migration 027); no `getAuditLog` in `api.js`, no view in `AdminScreen`. Accountability / abuse-of-admin trail with no way to read it.
- state: half-built — endpoint only.
- scope: S — `api.js` helper + read-only "Activity log" section in `AdminScreen`.

### `[FEATURE] 🟠 — User feedback channel is unreachable both directions` · **CONFIRMS-R1 (F3)**
- rationale: Still open. `POST /feedback` (`routes/feedback.js`) + `GET /admin/feedback` (`routes/admin.js:222`) + migration 020 all exist; `api.js` has no `submitFeedback` (grep confirms), no submit UI, no admin inbox. The sanctioned low-pressure "tell us what felt wrong" path for autistic users is dark on both ends.
- state: half-built (orphaned both directions).
- scope: M — `api.js` `submitFeedback` + a "Send feedback" surface (Settings/Safety) + admin list.

### `[FEATURE] 🟡 — Calm "Sent" micro-state on own bubbles` · **CONFIRMS-R1 (F4)**
- rationale: Still open. `read_cursors` columns (migration 008) drive only the sender's unread dot; literal-communication users get no reassurance a message *landed*. Must never become a read receipt.
- state: partial.
- scope: S — frontend-only "Sent" state on own optimistic bubbles; no "seen by them" surface.

---

## B. Table-stakes (a dating product needs these)

### `[FEATURE] 🔴 — No Discover-side filter surface; every discovery control is buried in the profile-edit form` · **NEW**
- rationale: The data model and candidate query are genuinely good — `candidates.js:96-120` honours search radius, age range, gender/seeking, and lifestyle deal-breakers. But the **only** place a user can change any of them is deep inside the long `ProfileScreen` edit form (gender/seeking/age/radius at `ProfileScreen.jsx:1657-1662`), gated behind the global "Save changes" button. Discover itself offers no filter control at all — when the deck empties, `SuggestionScreen.jsx:690` just *tells* the user to "widen your search radius, age range, or who you're seeking in your profile." Every mainstream dating app has at-hand discovery filters; here the engine supports them but the user can't reach them in context. For an autistic audience, a clear, explicit "who am I seeing and why" filter panel (with plain labels) is *more* important than average — it converts an opaque feed into a predictable, controllable one.
- state: missing (UI). Backend + editor fields exist; no Discover filter entry point.
- scope: M — a calm "Filters" sheet on the Discover screen reading/writing the same fields (age range, radius, seeking, deal-breakers), applied immediately (not behind the profile Save). Reuse existing `updateProfile` fields; no schema.

### `[FEATURE] 🟠 — Onboarding collects none of the discovery or moat fields` · **CONFIRMS-R1 (F7), EXPANDED**
- rationale: Re-verified: `OnboardingScreen.jsx` is still 3 steps and its save payload (`OnboardingScreen.jsx:687-695`) is exactly `{displayName, tagline, dateOfBirth, bio, interests, commNote, relationshipGoal}` — it omits **gender, seeking, age-range, radius** (so a brand-new user's first deck is filtered by *defaults*: 18-99, no radius, seeking-everyone — they can't even say who they want to meet until they find the buried profile form) **and** all seven autism moat fields (`comm_*`, `sensory_*`, `social_duration`, `context_card`, prompts). First-run is the highest-leverage moment and it captures the least differentiated profile possible.
- state: partial — fields exist in editor + backend; absent from onboarding.
- scope: M — add one optional, skippable "Who you'd like to meet" step (gender/seeking + age range) and one optional "How you communicate" step (1-2 comms/sensory prefs or a single prompt).

### `[FEATURE] 🟠 — Decouple Report from Block in the UI` · **CONFIRMS-R1 (F5)**
- rationale: Still open. Backend separates `/report` and `/block`; the UI forces "Block and report" (`BlockReportScreen.jsx`), so a user can't quietly flag behaviour while still deciding, or block without a formal report. Reason taxonomies also differ pre-match vs in-chat.
- state: partial (frontend coupling only).
- scope: S-M — split the actions; unify the reason taxonomy.

### `[FEATURE] 🟠 — No email re-engagement path / notification-preference depth` · **CONFIRMS-R1 (F6), SHARPENED**
- rationale: Still open, now with confirmed specifics: the email infra exists (`email/resend.js`, `emailConfigured()` imported at `routes/profile.js:5`) but is used **only** for verification/reset, never for re-engagement; and the notification tiers are push-only — `VALID_NOTIFICATION_TIERS = ['in_app','silent_push','name_only']` (`routes/profile.js:32`), with no `email` tier and no digest job. For a calm async product that strips urgency and where push is opt-in, a **low-frequency, no-rush email digest** ("you have a new match — there's no hurry") is the single sanctioned re-engagement lever, and it's entirely absent. (Pairs with the orphaned `notification_preferences` table above as the natural home for channel prefs.)
- state: missing (no email tier, no digest job, no UI).
- scope: M — add an `email`/`digest` channel pref + a low-frequency digest job (gated on `emailConfigured()`) + a calm "How we let you know" Settings section.

### `[FEATURE] 🟡 — Photo / attachment moderation is a no-op` · **CONFIRMS-R1 (F8)**
- rationale: Still open. `POST /photos/confirm` flips status to `'scanned'` with no scanning; chat attachments gated off and unlinkable. Safety surface (CSAM/abuse) on a dating platform.
- state: half-built.
- scope: M — real review queue / honest status + message↔attachment link before enabling.

### `[FEATURE] 🟡 — Reporting feedback loop stops at status` · **CONFIRMS-R1 (F9)**
- rationale: Still open. A reporter sees Open/Reviewed/Actioned/Dismissed but never the plain-language outcome.
- state: partial.
- scope: S — surface the sanitized resolution on "Your reports."

---

## C. Autism-friendly differentiators (advance the mission toward best-in-class)

### `[FEATURE] 🟠 — Score the remaining four moat fields + widen the why-reasons` · **CORRECTS-R1 / re-scoped F10 → F10b** · NEW scope
- rationale: `score.js` now scores sensory_environment + comm_cadence (good, R1's gap partly closed), but `comm_directness`, `comm_literal`, `sensory_lighting`, and `social_duration` are **collected, displayed on cards, and ignored by the scorer** (`candidates.js:50-58` selects them but `score.js:9-37` never reads them). These are exactly the dimensions where mismatch causes the most friction for this audience (a "direct/literal" communicator paired with a "playful/softened" one). Making them count — and saying so in a why-reason — is what turns "adequate" matching into best-in-class compatibility for autistic daters. The scorer is also a flat additive heuristic (interests×2, goal+3, city+2, sensory+2, cadence+2); there's no normalization, no "compatibility %" the user can see, and no soft *preference weighting* (everything is hard-filter or fixed bonus). State-of-the-art for *this* audience would let a user say which dimension matters most to them.
- state: partial — 4 of 7 moat fields unscored; no user-visible compatibility framing; no preference weighting.
- scope: M — extend the scorer with directness/literal/lighting/duration alignment bonuses + matching why-reasons (no schema); optional follow-up (⚪): a user-set "what matters most to me" weight and a plain-language fit summary on the card.

### `[FEATURE] 🟠 — Pre-conversation "what to expect" card on chat entry` · **CONFIRMS-R1 (F11), with new evidence**
- rationale: Re-verified open. `routes/matching.js:225-226` already returns the match's `contextCard` + comms/sensory fields on `match.otherUser`, and a `MatchProfileModal.jsx` now renders comm chips for a matched person — but **on opening a conversation, none of it is surfaced**: `ConversationScreen.jsx` shows only generated starters (`:1389`), no "How they like to talk" expectations card. Predictability at the anxious moment of starting a chat is a core mission lever and the data is already on the payload.
- state: partial — data present, not surfaced at conversation entry.
- scope: S — render a calm "How they like to talk / what to expect" card from `contextCard` + cadence on conversation open.

### `[FEATURE] 🟠 — Richer conversation tooling for literal/structured communicators` · **NEW**
- rationale: Current conversation tooling is starters + emoji reactions + delete (`ConversationScreen.jsx`, `routes/starters.js`). For an audience that often finds open-ended chat anxiety-inducing, best-in-class would add *structured*, calm assists that mainstream apps lack: (a) a small library of **reusable "clarity" phrases** ("I need a little time to reply — that's normal for me", "Could you say that more directly?") — the Safety Center already proved the copy-able-script pattern works; (b) a **"suggest a low-key plan"** structured helper (quiet café / short walk / video call) building on the sensory prefs both people disclosed. These reduce blank-page anxiety and the pressure to improvise social scripts — the product's whole reason for being.
- state: missing.
- scope: M — extend the starters surface into a small "conversation helpers" tray (reuse the copy-script pattern); optional structured "suggest a plan" composer.

### `[FEATURE] 🟡 — Opt-in mutual "slow start" pacing` · **CONFIRMS-R1 (F12)**
- rationale: Still open. A sanctioned, mutual, never-locking slow mode (exchange a couple of prompts before open chat) fits the audience and is unique. No `slow_start` column anywhere (grep confirms).
- state: missing.
- scope: M.

### `[FEATURE] 🟡 — Private note-to-self on a match` · **CONFIRMS-R1 (F13)**
- rationale: Still open. Owner-only memory aid ("met at book club", "dislikes loud bars") for users juggling several conversations. No `note`/`note_to_self` column exists (grep confirms).
- state: missing.
- scope: M — private per-match note column + small UI; owner-only.

### `[FEATURE] 🟡 — Profile richness: no structured "about me" facets (occupation, languages, love-/communication-needs)` · **NEW**
- rationale: Profiles capture name/tagline/bio/interests/lifestyle/comms/sensory/prompts — strong on the moat, but thin on the ordinary structured facets that give autistic users *predictable, scannable* context instead of forcing inference from free-text bio (the exact reading that's hardest for this audience). No occupation/study, languages, or a structured "things that help me / things that are hard for me" facet exists (grep of migrations: none). A couple of optional structured facets would increase clarity without adding pressure.
- state: missing.
- scope: M — 2-3 optional structured profile facets + card display; no matching change required.

---

## Notes / not re-proposed
- Already shipped + excluded (verified): MatchProfileModal (match-gated profile view), gender/seeking/age/radius capture + mutual filtering, sensory+cadence scoring with why-reasons, undo-skip, pause, verified badge, data export, blocked list, conversation search/pagination/archive, activity inbox, a11y modes, Safety Center, MatchMoment.
- Engineering items (tests/lint/CI — R1 F14, shared-helper extraction — R1 F15) intentionally out of this product-dimension pass; both still stand.
- All file:line references verified against current source on 2026-06-30.
