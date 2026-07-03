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

## GENUINELY OPEN

### 🟠 Safety / trust (highest value — backend/ops)
- **SAFETY-2 — Profile photos served with ZERO screening.** `ATTACHMENTS_ENABLED` is
  now `true`; message attachments are human-gated, but `photos.js addGalleryPhoto`
  applies no automated/human review and `candidates.js` serves `photo_url` straight
  onto Discover cards. No NSFW/CSAM hash-matching anywhere; no CSAM escalation runbook.
  Reactive user-reporting is the only protection. **Backend + ops.**
- **JRN-1 — No abusive display-name screening.** A junk profile ("Kinda Stupid") can
  be a newcomer's first Discover card (`profile.js` / `candidates.js:71-88` screen for
  presence of name/bio/photo but not content). Trust-critical first-session moment.
  **Backend / moderation.**

### 🟠 Product / UX
- **G4 — Search radius silently no-ops outside ~7 hard-coded metros.**
  `metros.js distanceMiles()` returns `null` for ungeocodable cities and
  `candidates.js` lets unknown-distance candidates through, with no UI feedback — a
  control that looks functional but silently fails for most real locations.
  **Backend (geocoding) + frontend (feedback).**

### 🟡 Features / richness
- **F28 — Structured "about me" facets** (occupation/study, languages, "things that
  help me / things that are hard for me"). The one genuinely-unbuilt profile feature;
  scannable structured context this audience reads more easily than free-text bio.
  Size M. **Backend (migration + read/write) + frontend (editor + card).**
- **PROD-6 — Viewer-side photo gallery.** Members curate ≤6 photos; every viewing
  surface renders ONE. `candidates` returns only `photoUrl`. **Backend must expose
  `photos[]` first**, then S–M frontend.
- **Onboarding arrival moment** — no "you're all set" confirmation beat before landing
  in Discover (data collection itself is complete). Tiny **frontend** polish.

### 🟡 Backend hardening (defense-in-depth)
- `/photos/upload-intent` doesn't enforce `file_size_bytes` / pin `Content-Length` +
  `Content-Type` on the presigned PUT (`photos.js:188+`) — 10 MB cap is advisory.
- Socket `join_conversation` doesn't drop the room on block (`socket/index.js`) —
  inert today (HTTP send is consent-gated), latent if a future emit path bypasses it.

### LOW — tech-debt (parked)
- **E12** — two socket.io connections/user + per-thread-switch churn (consolidation).
- **E20** — `getCandidates` loads all eligible profiles + N+1 interest queries, scores
  in JS (accepted tradeoff until scale; needs SQL-side score/join).
- **F29** — orphaned `notification_preferences` table (`003_messaging.sql`) still
  dangling; drop or repurpose (backend cleanup migration).
- No frontend unit tests (harness `scripts/qa/*` + ESLint cover it today).

### ⚪ Minor a11y (advisory, not AA failures)
- SuggestionScreen "why" ✓ checkmark uses `t.accent` ~3.4:1 (aria-hidden/decorative).
- Age-range slider handles Arrow only (no Home/End/PageUp-Down).
- Some banner ×/Dismiss targets may fall below 24×24; offline banner lacks wrapper
  padding so it can briefly overlay the header.

---

## Suggested execution order
1. **Backend safety batch (needs Railway deploy — now unblocked):** SAFETY-2 photo
   screening (biggest), JRN-1 name screening, G4 geocoding + radius feedback, the two
   backend-hardening items, F29 cleanup. One backend pass + one `npm run deploy`.
2. **Frontend polish batch (Vercel):** the 3 minor a11y items + onboarding arrival
   moment. One build + ship.
3. **F28 facets** (backend + frontend) as its own feature slice.
4. **PROD-6 photo gallery** after backend exposes `photos[]`.
