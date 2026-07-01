# Spectrum Dating — Round 2 Trust, Safety & Moderation Audit

**Date:** 2026-06-30 · **Lens:** user-harm & moderation operations (vulnerable autistic audience). Read-only.
**Scope:** reporting/blocking, moderation tooling, identity verification, photo/content safety, anti-grooming/scam/catfish, account recovery & session revocation, deletion-vs-evidence, stranger-vs-match privacy, expectation-setting/consent.
**Coordination:** exploit-class items (authz/IDOR/SQL/rate-limit) are the backend-security agent's; this report only touches those where they create *user-safety* harm. Cross-refs to the existing `ERROR_ISSUE_LOG.md` (E#) / `FEATURE_BACKLOG.md` (F#) are noted to avoid duplication and add the safety angle.

Severity: 🔴 active harm / safety hole · 🟠 serious · 🟡 improvement · ⚪ polish

---

## What's already strong (safety baseline)

- **Report and block are genuinely separable on the backend** — distinct `/messaging/report` and `/messaging/block` endpoints, distinct tables, report has self-target guard + existence check, block has UNIQUE-collision handling. (`messaging.js:402,470`)
- **Reporter can see their reports' status** — `GET /messaging/my-reports` + the Safety Center "Your reports" list with calm status pills, and `moderator_note` is correctly *never* exposed to the reporter. (`messaging.js:512`, `SafetyScreen.jsx:662`)
- **Blocking is reversible and reviewable, not a one-way trapdoor** — `GET /messaging/blocked` + unblock, surfaced in the Safety Center. (`messaging.js:436`, `SafetyScreen.jsx:715`)
- **Append-only moderation audit log exists** and every suspend/unsuspend/verify/resolve writes to it. (`admin.js:11`, `027_moderation_log.sql`) — though it has no UI (F2; see SAFETY-6).
- **Suspension force-logs-out immediately** by bumping `token_version`; suspended users can't obtain or keep a token. (`admin.js:124`, `auth.js:111`)
- **Account recovery is well-built** — non-enumerable `forgot-password` (always 200), 1-hour single-use reset tokens invalidated by `token_version`, password/reset both bump the version to kill all other sessions, explicit `sign-out-all`. (`auth.js:142-185,135`)
- **Privacy by design** — `GET /profile/:userId` is hard match-gated and registered last; `contextCard` withheld pre-match; coarse-location stripped; no online/last-active/read-receipt presence (advertised honestly in the Safety Center). (`profile.js:472`, `SafetyScreen.jsx:654`)
- **Consent gate on messaging** — a block returns `CONSENT_GATE` and stops further messages. (`messaging.js:271`)
- **Safety Center tone is exemplary calm-by-design** — plain-language scripts, "you don't owe anyone an explanation," device-local date plan + check-in timer, never prompts for notification permission. This is the model the rest of the safety surface should match. (`SafetyScreen.jsx`)

---

## Findings (lead with highest harm potential)

### [SAFETY] 🔴 Report-reason taxonomy mismatch silently drops the block — abuser is NOT blocked but user is told they are
**Where:** `SuggestionScreen.jsx:237,332` (default reason `"inappropriate"`) + `MessagingApp.jsx:138-145` / `BlockReportScreen.jsx:29-34` (offers `inappropriate`) → `blockUser` → backend `messaging.js:400` `VALID_REASONS = ['harassment','spam','fake_profile','other']`.
**User-harm:** The frontend block/report flows offer/ default to reason `"inappropriate"`, which the **block** endpoint rejects with `400` (the **report** endpoint accepts any ≤100-char string, so the report goes through). Both call sites wrap `blockUser` in an empty `catch {}` and then unconditionally show *"You blocked and reported {name}. You will not see them again."* From Discover, `"inappropriate"` is the **pre-selected default** — so a user who reports the most common kind of bad actor (someone sending inappropriate content) gets a false confirmation, is **never actually blocked**, and that candidate can resurface in their stack. For this audience a literal "you will not see them again" promise that silently fails is a direct safety betrayal.
**Recommendation:** (1) Unify ONE reason taxonomy shared by client + both endpoints (add `inappropriate` to backend `VALID_REASONS`, or map it before the block call). (2) Stop swallowing the block failure — if `blockUser` rejects, do NOT show the "you will not see them again" confirmation; surface "We couldn't block them — please try again" and keep them out of the stack client-side as a fallback. (3) Add a server-side contract test that every client reason is accepted by `/block`.

### [SAFETY] 🔴 Photo/attachment "scan" is a no-op that marks content `scanned` — no NSFW/CSAM screening anywhere
**Where:** `photos.js:226-242` (`POST /confirm/:attachmentId` flips `upload_status` straight to `'scanned'` with zero scanning); also profile photos (`addGalleryPhoto`, `photos.js:22`) get no review at all. (Overlaps E2/F8 — flagged here for the *abuse-exposure* angle.)
**User-harm:** There is no automated or human moderation of any uploaded image. Naming the status `scanned` actively misleads operators into believing screening happened. On a platform whose users can be targeted for grooming/extortion, this means: (a) no CSAM detection or reporting obligation pathway, (b) sexual/abusive imagery can be sent to a match (if attachments are enabled) or stand as a profile photo with the only recourse being a *user* report after exposure, (c) message-attachment public URLs are served from object storage. The vulnerable audience is exactly who is least likely to pre-empt or recover from this.
**Recommendation:** (1) Do not call any status `scanned` until something scans — rename to `unreviewed`/`pending_review`. (2) Wire a real check before serving: at minimum an automated NSFW/CSAM classifier (hash-match for known CSAM, e.g. a PhotoDNA-class vendor) on both profile photos and attachments, plus a human review queue for flags. (3) Until real scanning exists, keep attachments gated (currently `ATTACHMENTS_ENABLED=false` — good) AND add an explicit photo-report reason + a moderator photo queue so reported images can be pulled fast. (4) Document a CSAM escalation/reporting runbook (legal obligation).

### [SAFETY] 🔴 Account deletion destroys moderation evidence — including reports filed *against* the deleted abuser and all blocks against them
**Where:** `account.js:64-90` (explicit `DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?`) + `010_moderation.sql:4-5` (`reports.reporter_id`/`reported_id` `ON DELETE CASCADE`). (Overlaps E6 — extended here with the *abuser-evades-moderation* angle.)
**User-harm:** A bad actor can **erase the case against themselves** by deleting their account: every report filed against them cascades away, and the `account.js` transaction also explicitly deletes blocks on both sides. A serial harasser who gets reported can self-delete, re-register with a new email, and start over with a clean slate and no retained pattern for moderators. The append-only `moderation_log` only captures *admin actions taken*, not the open reports — so reports never reviewed before the deletion vanish entirely. This converts "right to be forgotten" into "right to evade accountability."
**Recommendation:** Retain moderation evidence past account deletion: change `reports` FKs to `ON DELETE SET NULL` (keep the row, null the user link) or snapshot the reported user's id/email/displayName onto the report at file-time; preserve `blocks` rows against a deleted user (or snapshot a "blocked-N-times" counter); keep a tombstone hash of the deleted email to detect re-registration of a previously-actioned account. Balance with privacy by retaining only what moderation/legal needs, time-boxed.

### [SAFETY] 🟠 Identity verification is a badge with no identity check — "Verified" means only "an admin clicked a button"
**Where:** `profile.js:127` (`verification-request` collects **no** ID/selfie/evidence — just sets status `pending`); `admin.js:142` (`verify` flips `identity_verified` on a boolean, no artifact to review). Badge shown to matches via `verified` flag.
**User-harm:** The verified badge is a **trust signal with nothing behind it**. Users on the spectrum may over-rely on a literal "Verified" label as proof the person is real / not a catfish, when it conveys no such assurance. Worse: there's currently no admin UI to grant it at all (SAFETY-5), so legitimate users can't get verified while the *concept* of verification raises false confidence in whoever does carry the badge (e.g. seeded demo accounts via `016_backfill_demo_verified.sql`).
**Recommendation:** Either (a) make verification real — collect a selfie/liveness or ID artifact, store it for review, and only then grant the badge; or (b) until then, relabel the badge to exactly what it asserts (e.g. "Email confirmed" or "Reviewed by our team") and add microcopy on the badge explaining what it does and does not mean ("This does not guarantee identity — always meet safely"). Never let an empty-request → admin-toggle masquerade as identity verification.

### [FEATURE] 🟠 Moderators cannot action verification requests, view feedback, or read the audit log — the moderation loop is half-open
**Where:** `AdminScreen.jsx:2` imports only `getAdminStats, getAdminReports, resolveReport, suspendUser`. No `verifyUser`, `getAdminFeedback`, `getAuditLog`, or pending-verification helpers exist in `api.js`. Backends are fully built (`admin.js:142` verify, `:222` feedback, `:173` audit-log). (Overlaps F1/F2/F3 — the safety angle is that these are *moderation operations*, not features.)
**User-harm:** (1) **Verification requests pile up unactioned** — users submit and wait forever; the badge is ungrantable through the UI (only via raw API). (2) **The "tell us what felt wrong" feedback channel is a black hole** — `POST /feedback` accepts submissions but no moderator can ever read them; for an audience explicitly invited to flag discomfort low-pressure, silently discarding it is a trust harm. (3) **No audit-log view** means no in-product accountability for admin actions (suspend/verify), weakening the abuse-of-admin guardrail that the log was built to provide.
**Recommendation:** Ship the three thin admin views (each is one `api.js` helper + one panel): pending-verification queue with approve/reject, feedback inbox, and audit-log viewer. Until then, these backends should be considered non-operational, not "done."

### [SAFETY] 🟠 No anti-grooming / anti-scam / anti-catfish friction appropriate to this audience
**Where:** product-wide. No new-account cooldown, no "this person matched seconds ago" / "account created today" signal, no off-platform-contact nudge, no link/phone/financial-keyword detection in messages (`messaging.js` stores body verbatim), no first-message expectation card.
**User-harm:** Romance-scam and grooming playbooks (rapid intimacy, "move to WhatsApp," requests for money/gift cards, love-bombing) are disproportionately effective against literal-communication, trust-defaulting users. The platform currently offers no in-context friction or plain-language warning at the moments these unfold. The excellent *offline* safety material (Safety Center) has no *online* counterpart inside the chat where manipulation actually happens.
**Recommendation:** Add lightweight, calm, non-alarming in-chat affordances: (1) a one-time, dismissible "what to expect / staying safe in chat" card on first message in a conversation (ties to F11) including "It's okay to take your time" and "We'll never ask you to move off the app or send money"; (2) a gentle, non-blocking inline note when a message contains an external contact handle / URL / money keyword ("Be careful sharing contact details or money early on" — informational, never accusatory, never auto-removing content); (3) surface account-age / freshly-matched context as neutral info ("matched today"), not a scary warning. Keep all of it shame-free and skippable.

### [SAFETY] 🟡 "Block and report" is a single coupled action — a user can't report-without-blocking or block-without-reporting from the UI
**Where:** `BlockReportScreen.jsx:62-68,124,271` and `SuggestionScreen.jsx:254-270` both always fire report+block together; the backend already supports them independently. (Overlaps F5 — safety angle.)
**User-harm:** Two distinct needs are forced into one button. A user who feels mild discomfort but isn't ready to sever contact must either do nothing or take the heavyweight "block AND report" — friction that suppresses early, low-confidence flags (exactly the signal you most want from this cohort). Conversely, someone who just wants to quietly block without filing a formal accusation can't. The coupling also means the reason taxonomy is shared, feeding SAFETY-1.
**Recommendation:** Split into two clearly-labeled, low-friction actions ("Block" and "Report") that can be used alone or together, with plain-language descriptions of what each does. Make "Report" feel low-stakes and shame-free ("Flag this for our team — you don't have to block them"). Reuse the unified taxonomy from SAFETY-1.

### [SAFETY] 🟡 No resolution outcome communicated to the reporter — status pills stop at "Actioned"/"Dismissed" with no plain-language meaning
**Where:** `SafetyScreen.jsx:204-209` (status → pill); `my-reports` returns status but never a user-safe outcome. (Overlaps F9.)
**User-harm:** A vulnerable reporter sees "Dismissed" or "Actioned" with no explanation. "Dismissed" with no context can read as "you were wrong to report / you weren't believed," which discourages future reporting and can feel invalidating. Closing the loop reassures the cohort that reporting *does something* and that dismissal isn't a judgment of them.
**Recommendation:** Add a short, pre-written, reassuring outcome line per terminal status (e.g. Actioned → "Thanks — we reviewed this and took action."; Dismissed → "We reviewed this and didn't find a policy violation this time. You did the right thing by telling us, and you can always block them."). Never expose the raw `moderator_note`. Keep it warm and non-confrontational.

### [SAFETY] 🟡 Block allows self-block and 500s on a nonexistent target; report's guards are not mirrored
**Where:** `messaging.js:402-430` lacks the self-target guard + existence check that `/report` has (`:477-482`). (Overlaps E5 — included for the user-facing angle.)
**User-harm:** Mostly robustness, but a generic 500 on a bad block target (a) gives the user no calm explanation and (b) consumes the abuse limiter, so a confused user retrying can lock themselves out of blocking/reporting — the worst moment to be rate-limited.
**Recommendation:** Mirror the report guards: reject self-block with a clear message, verify the target exists, return a calm 4xx instead of 500, and don't burn the limiter on validation failures.

### [SAFETY] ⚪ Unblock returns success even when nothing was unblocked; no confirmation that block actually severs an in-flight conversation visually
**Where:** `messaging.js:458-463` (`DELETE /blocked/:userId` always returns `{unblocked:true}`). (Matches an existing nit.)
**User-harm:** Minor — a user could believe they unblocked someone who was never blocked; low harm but erodes the predictability this audience depends on.
**Recommendation:** Return whether a row was actually removed and reflect it in the Safety Center copy.

---

## Notes on scope boundaries
- Migration idempotency (E1), unbounded `NOT IN` (E7), socket churn (E12), optimistic-swipe (E9) and other exploit/robustness items are the backend-security / code-quality agents' — not re-litigated here.
- The "irreversible 'I'm interested' mis-tap" (F16) is a dark-pattern/consent concern already logged by product testing; it borders on safety (no take-backs clashes with the "your own pace" promise) — worth treating as a consent affordance when prioritized.
