# Spectrum Dating — Moderation & Trust-Safety Gap Analysis

**Compiled 2026-07-04** from a 4-lens review: internal code audit of our moderation system +
web research on (a) Bumble/Hinge/Tinder user-safety features, (b) identity/anti-fraud &
verification, (c) AI moderation + T&S ops/regulatory. Shareable report artifact published
separately. Prioritization is tuned for calm-by-design + a vulnerable audience — not every
industry practice is an automatic adopt.

## ✅ SHIPPED since this analysis (2026-07-04, all live on prod)
Every in-code Critical + Needed gap is now closed:
- **CRITICAL #1 Block-severance** — block fully severs the conversation both ways + socket room (master `df5bb66`).
- **CRITICAL #2 Activity leak** — Activity feed filters blocked users (master `df5bb66`).
- **Needed #4 Scam/grooming signal → moderators** — off-platform/money detection now logs a
  `chat_safety_signals` row (observe-only, never blocks) surfaced as a repeat-offender indicator
  (master `d79ac21`).
- **Needed #7 Enforcement ladder + #11 due-process** — warn→suspend→**ban** with severity, the
  reason shown to the actioned user, and an appeal affordance (master `6ed697f`).
- **Needed #10 Evidence-on-report** — reporter can pin the specific offending message (validated to
  the reported user + conversation); snapshot widened 3→10 (master `6da160c`).
- **Needed #6 Gentle message nudges** — calm sender "are you sure?" + recipient "does this feel
  off?" (one-tap report, pins the message), reusing the detector (master `0984a1b`).

**Remaining Needed = VENDOR-DEPENDENT (need an external service/key, not in-code):**
CRITICAL #3 CSAM hash-match + NCMEC (Thorn/PhotoDNA) · #5 unsolicited-image blur (ML vision) ·
#8 ban-evasion / phone verify (SMS vendor) · #9 real photo/selfie verification (FaceTec/Veriff-class).

**Nice-to-haves — every in-code item is now SHIPPED (2026-07-04, all live on prod):**
- **Admin-endpoint rate-limiting** — `adminApiLimiter` (300/15min, per-admin, `/admin/me` exempt).
- **Transparency reporting** — `GET /admin/transparency?period=` PII-free aggregate enforcement stats
  + a Transparency tab in the console (master `ad8b969`).
- **Moderator QA / calibration** — random-sample re-review of *resolved* decisions (excludes your own
  + already-reviewed), Agree/Disagree + note, agreement-rate in the Transparency tab; calibration-only,
  no punitive action (migration 051, master `9fd3642`).
- **Panic button / live date-share** — "Share my location" in the Safety Center: on-device geolocation →
  a maps link shared through the user's own share sheet, nothing stored server-side (master `5ead2f5`).
  Complements the existing Safety Center + check-in timer + date-plan share.
- **Crisis-line auto-routing** — conservative self-harm detector surfaces a private 988 / Crisis Text Line
  note in-conversation (once per session).
- **At-risk / traveler alerts** — hostile-region geo lookup (offline geoip) offers to hide the profile.
- **Validation hardening** — report-reason enum enforced server-side; set-once DOB age gate.

**Nice-to-haves DEFERRED for product direction (not built blind — see rationale):** contact-list block
(privacy tension: requires uploading a contact graph), incognito/visibility mode, in-app voice/video (infra),
dispatcher/Noonlight-class panic button (vendor). Admin roles/tiers remain a flat allowlist by design for now.

## Strengths to preserve (HAVE)
Consent-gated messaging (match required; block/report never notify; unmatch soft-ends without
revealing who); rebuilt moderator console (real queues + oldest-age SLA, reported-conversation
context + durable snapshot, repeat-offender signal = report+distinct-blocker counts + account
age, terminal/idempotent actions + required notes + resolved_by receipts, human-readable audit
log); real test-excluded counts; k=5 privacy-masked demographics; app-layer uptime/health;
manual photo-review-before-serve; coarse location; post-match-gated private fields; Safety
Center + check-in timer + crisis resources; report evidence survives account deletion.

## CRITICAL — fix first (2 confirmed bugs + 1 compliance)
1. **Block doesn't sever an existing conversation.** Block gates Discover + sends but does NOT
   end the match or filter the conversation list (`messaging.js` conversations queries have no
   block filter; `MessagingApp.jsx:504` is client-session-only). Blocked person keeps the thread
   + your profile, learns of the block via a `CONSENT_GATE` send failure. **Fix:** on block,
   soft-end the match (`ended_at`) or filter blocks from both conversation queries + drop the
   socket room.
2. **Activity feed leaks blocked users.** `GET /matching/activity` (`matching.js:415-465`)
   filters neither incomingLikes nor recentMatches by `blocks` — harassment-around-block surface.
   **Fix:** exclude the block set in both subqueries (mirror `candidates.js:63-71`).
3. **No CSAM detection/NCMEC reporting.** Photos are 100% manual review; no hash-matching, no
   reporting path. Legal + child-safety exposure (US law, UK OSA). **Fix:** integrate hash-match
   + NCMEC vendor (Thorn "Safer" bundles both) before scaling image sharing.

## NEEDED — core-parity gaps (calm-fit)
4. **Server-side scam/grooming signal → moderators.** `hasSafetySignal` is client-only + unlogged.
   Log server-side + surface on user/report + risk flag. Cheap (detector exists).
5. **Auto-blur unsolicited explicit images** (Bumble Private Detector is Apache-open-source) —
   blur-by-default + view/delete/report.
6. **Gentle message nudges** — sender "Are you sure?" + recipient "Does this bother you?" →
   one-tap report. Start heuristic. Non-punitive, on-brand.
7. **Enforcement ladder warn→suspend→ban** + severity field (currently only binary reversible
   suspend). Was our deferred Phase 2.
8. **Ban-evasion friction** — suspended user re-registers with a new email freely. Add phone
   (SMS) verification + basic device signals.
9. **Privacy-light photo/selfie verification** — the verified badge is a manual toggle backed by
   nothing (catfish risk). Selfie-pose match; delete selfie, store nothing biometric. Keep
   optional.
10. **Attach evidence to a report** — today text-only + last-3-messages snapshot; let the reporter
    pin the specific offending message; widen snapshot window.
11. **Suspension notice + appeal path** — actioned user gets no reason, no contest (DSA due-process
    norm). Show a calm reason + route appeals via the feedback channel.

## NICE-TO-HAVE — status
**Shipped in-code (all live):** admin-endpoint rate-limiting · transparency reporting (EU DSA / UK OSA
posture) · moderator QA/calibration sampling · live date-share / "Share my location" panic-button piece ·
crisis-line auto-routing on self-harm detection · at-risk/traveler alerts for LGBTQ+ users · validation
hardening (report-reason enum server-side + set-once DOB age gate).
**Deferred for direction (not built blind):** admin roles/tiers (flat allowlist by design for now) ·
contact-list block (needs a contact-graph upload — privacy tension) · incognito/visibility mode ·
in-app voice/video (infra) · dispatcher-grade panic button (Noonlight-class vendor). ·
Moderator *wellness* tracking is intentionally out of scope (surveillance-of-staff concern).

## CAUTIONARY — don't adopt as-is
- **Background checks (Garbo-style):** flagship Match×Garbo shut down Aug 2023; accuracy/equity
  pitfalls. Skip.
- **Mandatory biometric face-liveness:** industry going there under regulatory pressure, but heavy
  face-scanning conflicts with our privacy-first/calm posture (~19% of daters willing). If we
  verify, keep optional + privacy-light.

## Suggested sequence (harm-reduced per effort)
1. Block gaps + activity leak (small backend). 2. Grooming/scam signal → moderators. 3. Enforcement
ladder + suspension notice/appeal + phone-verify (one T&S pass). 4. Image safety: auto-blur +
CSAM/NCMEC path. 5. Message nudges + evidence-on-report. 6. Privacy-light selfie verification.
7. Nice-to-haves by market (EU/UK → transparency + age assurance become needed).
