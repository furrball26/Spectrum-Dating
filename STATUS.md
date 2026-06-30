# Status

## Frontend Dev

### 2026-06-29 — Safety Center (meeting tips, copy-able scripts, date-plan share, check-in timer)
- New `src/SafetyScreen.jsx` — entirely client-side, no backend calls. Same shell styling as `MatchesScreen.jsx` (`t.bgGradient`, max-width 600, serif H1 "Safety Center"). Five sections: (1) **Meeting safely** calm plain-bullet checklist; (2) **What to say** — five autism-friendly literal scripts (break / clarity / ending early / declining / sensory) each in a quoted card with a "Copy" button (`navigator.clipboard.writeText` + execCommand fallback, "Copied" confirmation via shared `aria-live` polite region); (3) **Share a date plan** — form (who / where / datetime-local / "check by" time) that builds a plain-text summary and calls `navigator.share({ text })` if available, else copies it ("Copied — paste it to a trusted person"); (4) **Check-in timer** — 1h/2h/3h presets plus a "by HH:MM" preset when the plan's check-by time is set; persists `{ endsAt }` in localStorage (`spectrum_safety_checkin`) so it survives reload; live `setInterval` countdown (cleared on unmount), "Cancel timer", and on-elapse a calm in-app `role="alert"` banner + a `new Notification(...)` only if permission is *already* granted (never prompts); (5) **If you need help** — generic non-region-specific note, no fabricated numbers. Copied the small `useFocusable` hook locally. CRITICAL: every hook (including the lazy-init localStorage state and all effects) is declared before any early return — no hook-after-return.
- `src/App.jsx`: discreet "🛡 Safety" header link (new `SafetyLink`, focusable, 44px, `aria-label`/`aria-current`) added in a flex row beside the "Spectrum" wordmark — visible on all main tabs, NOT a 5th nav tab. New `activeTab === "safety"` branch renders `<SafetyScreen onBack={() => setActiveTab(prevTab || "suggestions")} />`; link sets `prevTab` on navigate-in so Back returns sensibly. `<main>` aria-label ternary now includes "Safety Center". `ProfileScreen.jsx` untouched.
- `npm run build` clean.

### 2026-06-29 — Lifestyle attributes + deal-breaker toggles
- `src/ProfileScreen.jsx`: added six new fields end-to-end. State (declared with the other `useState`s, before the loading/error early returns — no hook-after-return): `wantsChildren` / `smoking` / `drinking` (strings, default `''`) and `dbWantsChildren` / `dbNonSmoker` / `dbMustBeLocal` (booleans, default `false`). Extended `DEFAULT_PROFILE`, the API load effect (maps `data.wantsChildren` etc., default `''`/`false`), the `isDirty` comparison + `savedProfile` snapshot, and the `updateProfile({...})` save payload to include all six.
- New "Lifestyle" card (after "About your search", before "Notifications"): three calm labelled `<select>`s — Do you want children? (Prefer not to say / Yes / No / Open to it), Smoking and Drinking (Prefer not to say / No / Sometimes / Yes) — each with optional/“shown on your profile” helper text. New reusable `LifestyleSelect` sub-component.
- "Deal-breakers" subsection within the same card: three `role="switch"` toggles (new `DealBreakerToggle`, reusing the existing `NotificationToggle` switch pattern) for `dbWantsChildren` / `dbNonSmoker` / `dbMustBeLocal`, with literal copy and the calm explainer "Deal-breakers hide people who clearly don't match. People who haven't said yet still show up."
- WCAG 2.2 AA: focus rings via `useFocusable`, 44px targets, `aria-checked` / `aria-labelledby` on switches, `aria-describedby` on selects.
- `npm run build` clean.

### 2026-06-29 — DOB onboarding gate, age on cards, contact-gating copy
- `src/OnboardingScreen.jsx`: added required **Date of birth** field to step 1 — native `<input type="date">`, labelled, helper "You must be 18 or older to use Spectrum Dating.", `max` attr = today minus 18 years. Client-side step-1 validation: required, parses/validates the date, computes age, blocks advancing with inline error "You must be 18 or older to use Spectrum Dating." when < 18. `dateOfBirth` ('YYYY-MM-DD') added to the final `updateProfile(...)` payload; server's 400 message already surfaces via existing `handleSave` (`e.message`). New pure helpers `maxDobToday()` / `ageFromDob()` (browser-side, not in a workflow). All hooks remain before the single return — no hook-after-return.
- `src/SuggestionScreen.jsx`: candidate name now renders age when present ("Name, 29"), guarded by `typeof person.age === "number"`.
- Contact-gating clarity (audit #6): reassurance line on onboarding final step ("You're in control of who can reach you…"); calm one-liner added to empty states in `src/MatchesScreen.jsx` and `src/messaging/MatchesListScreen.jsx` ("Only people you've both matched with can message you.").
- `npm run build` clean.

### 2026-06-29 — Profile photo gallery (up to 6, choose main)
- Added photo API helpers to `src/api.js` (`addProfilePhoto`, `setPrimaryPhoto`, `deleteProfilePhoto`), each returning the server's ordered `photos` array.
- Replaced the single-avatar `PhotoUpload` in `src/ProfileScreen.jsx` with a responsive `PhotoGallery` (3-col grid, up to 6 cells). Each photo: square cover image, "Main" badge on the primary, "Set as main" on non-primary, inline-confirmed "Remove" (danger outline). One "+ Add photo" tile when under 6; helper text + empty state. Friendly 503 handling ("Photo uploads aren't available right now").
- `photos` state populated from `GET /profile/me` (`data.photos`); old `photoUrl` state and `PhotoUpload` component removed. All hooks declared before the loading/error early returns.
- `npm run build` clean.

### 2026-06-29 — Admin moderation dashboard + report wiring
- Added moderation/admin API helpers to `src/api.js` (`getAdminMe`, `getAdminReports`, `resolveReport`, `suspendUser`, `getAdminStats`, `reportUser`).
- New `src/AdminScreen.jsx`: self-contained moderation dashboard — stats row, status-filter segmented control (Open / Reviewed / Actioned / Dismissed / All), report cards with resolve (Reviewed/Actioned/Dismissed + optional note) and inline-confirmed suspend/unsuspend. Loading + empty states, WCAG 2.2 AA focus rings, 44px targets, live regions.
- `src/App.jsx`: captures `isAdmin` from login response and `getProfile()` (persists across reload), resets it on sign-out / expiry / account deletion. Discreet "⚙ Moderation" nav tab rendered only for admins; non-admins never see it.
- Report wiring: messaging `BlockReportScreen` submit now also calls `reportUser(..., conversationId)` alongside the existing block; pre-match `ReportModal` in `SuggestionScreen.jsx` now calls `reportUser` (plus block so the candidate is hidden).
- `npm run build` clean.

~Frontend Dev
