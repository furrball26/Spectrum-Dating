# Spectrum Dating — Feature Backlog

**Rewritten 2026-07-03** from a code-verified triage (3 read-only verifier agents
cross-checked every F-item + audit finding against `master`). The prior version
(2026-06-30) was **wholesale stale** — a builder shipped nearly the entire backlog
and never updated this doc. Statuses below are verified against code, not logs.

Production **bugs** live in `docs/REVIEW_BACKLOG.md`; this file is **features**.

---

## ✅ SHIPPED (verified in code — do NOT rebuild)

F1 admin verify approve/reject UI · F2 moderation audit-log view · F3 user feedback
channel · F4 calm "Sent" micro-state · F5 decouple report/block · F6 email digest +
notif prefs (`digest-scheduler.js`, migration 033) · F7 onboarding collects
gender/seeking/age-range + moat fields · F8 real photo/attachment moderation
(migration 031, admin review route) · F9 report outcome · F10b scores all 4 remaining
moat fields (`score.js`) · F11 pre-chat "what to expect" card · F12 opt-in slow-start
(presentation-only `NewThreadStart`; gating/locking deliberately NOT built —
calm-by-design) · F13 private note-to-self (migration 032) · F14 tests+lint+CI
(`eslint.config.js`, `.github/workflows/*`, `server/test/*`) · F15 shared helpers
(`useFocusable`/`focusRing`, `coarseCity`) · F16 un-like undo · F17 instant pause ·
F18 Discover filter surface (`DiscoverFilters.jsx`) · F19 withdraw report · F20
replace-photo + last-photo guard · F21 unmatch acknowledgement ("ended" state) · F22
no-candidates vs seen-everyone · F24 paused-Discover reminder · F25 badge relabeled
"Reviewed" + honest microcopy · F26 in-chat anti-grooming/scam friction
(`safetySignals.js` + `SafetyInlineNote`) · F27 conversation-helpers tray.

## Deliberate NON-GOALS (do not build — violate calm-by-design)
- **F23 / G7 — conversation-list message snippets / last-message wayfinding.**
  Intentionally omitted (`MatchesListScreen.jsx`): edges toward read-receipt anxiety.
- **F12 gating/locking slow-mode** — never gate/time/drip messaging.

---

## ✅ SAFETY BATCH — SHIPPED TO PROD (backend Railway `/health 4445cdd` + frontend Vercel)
Backend tests 49/49 · frontend smoke 11/11 · live markers confirmed.
- [x] **SAFETY-2 — Profile-photo human review (review-BEFORE serving, user-chosen).**
  Migration 036 adds `review_status` (existing photos backfilled `approved`); new
  photos `pending_review` and not served to viewers until an admin approves; `photo_url`
  kept approved-only; admin "Profile photos" review queue (`AdminScreen`) + owner
  "Pending review" badge. Vendor NSFW/CSAM (option b) is the client's later setup.
  *Operational note: new users aren't discoverable until their first photo is approved
  — the admin queue must be worked.*
- [x] **JRN-1 — Display-name screening** (`nameScreen.js`): slur/profanity rejected at
  save + excluded from candidates.
- [x] **G4 — Honest radius feedback:** `/profile/me` returns `locationGeocodable`;
  ProfileScreen shows a calm "distance doesn't apply for your area yet" note. (Real
  geocoding for arbitrary cities left as a vendor/data TODO.)
- [x] **Hardening:** strict server-side size check + Content-Type pinning (signed
  Content-Length deliberately dropped — fragile 403s); socket drops room on block.
- [x] **F29 — orphaned `notification_preferences` table dropped** (migration 037).

## GENUINELY OPEN

### 🟡 Features / richness
- [x] **F28 — Structured "about me" facets — SHIPPED TO PROD (master `7424946`,
  backend + frontend, live-verified).** Migration 038 adds occupation/languages/
  helps_me/hard_for_me (lists as JSON-array text, `''`=unset); server-side caps
  (80/120 chars, ≤5 items × ≤60); editor + list editors in ProfileScreen; calm rows
  on MatchProfileModal/preview; occupation+languages on the Discover card (pre-match),
  the two lists post-match/own only. Backend tests 60/60, smoke 11/11, F28 driver 10/10.
- **PROD-6 — Viewer-side photo gallery.** Members curate ≤6 photos; every viewing
  surface renders ONE. `candidates` returns only `photoUrl`. **Backend must expose
  `photos[]` first**, then S–M frontend.
- **Onboarding arrival moment** — no "you're all set" confirmation beat before landing
  in Discover (data collection itself is complete). Tiny **frontend** polish.

### LOW — tech-debt (parked)
- **E12** — two socket.io connections/user + per-thread-switch churn (consolidation).
- **E20** — `getCandidates` loads all eligible profiles + N+1 interest queries, scores
  in JS (accepted tradeoff until scale; needs SQL-side score/join).
- No frontend unit tests (harness `scripts/qa/*` + ESLint cover it today).
- Real geocoding for arbitrary cities (G4 residual — currently ~7 metros; vendor/data).

### ⚪ Minor a11y (advisory, not AA failures)
- SuggestionScreen "why" ✓ checkmark uses `t.accent` ~3.4:1 (aria-hidden/decorative).
- Age-range slider handles Arrow only (no Home/End/PageUp-Down).
- Some banner ×/Dismiss targets may fall below 24×24; offline banner lacks wrapper
  padding so it can briefly overlay the header.

---

## Suggested execution order
1. ~~Backend safety batch~~ — ✅ SHIPPED (SAFETY-2/JRN-1/G4/hardening/F29, master 4445cdd).
2. **F28 facets** (backend migration + read/write + frontend editor + card) — NEXT.
3. **PROD-6 photo gallery** — naturally follows F28 (photo pipeline fresh from SAFETY-2).
4. **Frontend polish batch (Vercel):** the 3 minor a11y items + onboarding arrival moment.
