# Functional QA Audit — Spectrum Dating

Dimension: behavioral/functional defects and broken flows on the LIVE site.
Live site: https://spectrum-dating-eta.vercel.app · API: https://spectrum-dating-server-production.up.railway.app
Tested as: logged-out visitor, sample user (mira.k.1), and admin (read-only walk). Desktop only — true mobile (<600px) could not be exercised (see Coverage).

---

[ERROR] 🟡 — Auth subview title stays "Sign in · Spectrum" / "Create account · Spectrum" on Forgot-password, Check-email, and in-card mode toggles
  - where: /?(auth) — Reset-your-password screen, Create-account-via-in-card-toggle; desktop
  - repro:
    1. Landing → Sign in → Welcome back. document.title = "Sign in · Spectrum" (correct).
    2. Click "Forgot password?" → heading changes to "Reset your password" but document.title stays "Sign in · Spectrum".
    3. Also: from the Sign-in card click the bottom "Create an account" toggle → heading becomes "Create your account" but title stays "Sign in · Spectrum" (because the in-card toggle changes AuthScreen's internal `mode` without notifying App's `authMode`).
  - expected vs actual: Title should reflect the visible screen (e.g. "Reset password · Spectrum" / "Create account · Spectrum"). Actual: title is stale on these subviews.
  - location: src/App.jsx:573-587 (title effect only knows `showAuth`/`authMode`, not AuthScreen's internal mode: forgot|check-email, nor in-card login↔register toggles in src/AuthScreen.jsx:105-109, :409-427)

[ERROR] 🟡 — Footer "Your safety & privacy come first" has no privacy/terms links (CONFIRMS known issue)
  - where: landing page footer (logged out); desktop
  - repro: Scroll to landing footer. Text reads "Built with autistic adults… Your safety & privacy come first." Inspected: `<footer>` contains ZERO `<a>` or `<button>` links.
  - expected vs actual: For a dating app collecting personal data, footer should link to a Privacy Policy and Terms. Actual: no links anywhere on the landing page footer.
  - location: src/LandingScreen.jsx (footer block) — unknown exact line

[DESIGN] ⚪ — Safety "Copy" NotAllowedError did NOT reproduce in this Chrome session (known issue not confirmed here)
  - where: /?tab=safety → "What to say" → Copy buttons; desktop
  - repro: Clicked "Copy" on the "Needing a break" phrase. Button changed to "Copied" and NO console error appeared. Clipboard write succeeded in the Chrome extension context (secure + user-activated).
  - expected vs actual: The known NotAllowedError (SafetyScreen.jsx:169-173) is environment-dependent (fires when the clipboard API is blocked, e.g. no user activation / insecure context). It did not surface here. Noting as not-reproduced rather than fixed — the unguarded `navigator.clipboard.writeText` can still throw uncaught in browsers/contexts that reject it.
  - location: src/SafetyScreen.jsx:169-173

[ERROR] 🟡 — Message delete is irreversible and leaves a permanent "Message deleted" tombstone (by design, but worth flagging for data integrity)
  - where: /?tab=messages → own message → ⋯ → Delete message; desktop
  - repro: Sent a test message to Eli Brenner (POST /messages → 201), opened ⋯ menu → "Delete message" → confirm dialog "Delete message? This can't be undone." → Delete (DELETE → 200). Message body removed but a "Message deleted" tombstone remains permanently in the thread for both parties.
  - expected vs actual: This is intended behavior (the dialog warns it can't be undone). Flagging only because the tombstone is unrecoverable, so any test/accidental delete permanently alters a conversation. The Eli Brenner sample thread now has 4 tombstones vs. the original 3 (see Sample data note).
  - location: src/messaging/ConversationScreen.jsx:1161-1181 (handleConfirmDelete)

---

## Flows verified working (no defects found)

- LANDING (logged out): correct title "Spectrum — Dating at your own pace", CTAs ("Create your profile", "Sign in") both reach AuthScreen, content sections render. SkipLink present.
- AUTH:
  - Empty submit → inline "Email is required." (no network call).
  - Invalid login → POST /auth/login 401 → "Invalid email or password." (does not reveal account existence).
  - Forgot password → POST /auth/forgot-password 200 → neutral "If an account exists…" confirmation + "Back to sign in" link.
  - Register reachability OK (did NOT complete signup). Password-length validation fires client-side: 3-char password (React-synced input) → "Password must be at least 8 characters." with NO /auth/register call. Duplicate email → 409 → "An account with this email already exists."
  - NOTE (not a product bug): Chrome autofill of saved sample credentials into the register form once desynced React state from the DOM, causing a 3-char-looking field to actually submit a long autofilled password. A real new user without saved creds for this site won't hit this; clean re-test confirmed validation works.
- DISCOVER: profile card renders fully (hero photo, name/age/pronouns/tagline/distance, verified badge, bio, "About talking", Interests with ✦ shared markers, "Why you're seeing X" reasons, 3 fixed-order actions + Report). "Not right now" → confirmation "Saved. X may come up again later." → Next person / Undo. Undo → POST /matching/undo-skip 200 restores candidate to front of deck. "Done for now" escape present.
- SETTINGS / A11Y: Theme Light/Warm dim applies instantly (dim = dark bg). Toggles present and functional: Low stimulation, Plain language, Reduce motion, High contrast, Larger text, Calm mode. "Larger text" DID scale content ~15% in Chrome (the known Firefox CSS-zoom no-op is Firefox-specific).
- MATCHES: card renders (avatar, name, pronouns, verified, city, tagline, context-card quote, "Open chat"). Tappable header/match avatar → MatchProfileModal opens with full profile; Escape closes it.
- MESSAGES (desktop 2-pane): list + thread render. Send via Enter → POST /messages 201, optimistic + persisted. Delete via ⋯ → confirm dialog → DELETE 200. Reaction picker (5 emojis) → add 👍 (POST /reactions 200) → toggle pill off restores. Header-avatar → profile modal (Escape closes). Search filter ("zzzznomatch" → "No matches named…" + clear ✕). Header ⋯ menu shows Unmatch / Block and report / Archive conversation (NOT executed — destructive). Pre-existing reaction (♥1) and sample messages intact.
- PROFILE EDITOR (sample user): comprehensive — photos (Main badge, Add, alt-text "Describe this photo", Remove), Display name/Tagline/Bio/Comm style, Prompts (+Add a prompt), Interests (suggested + add-your-own + ✕ remove), About your search (relationship goal, deal-breakers, Gender select, Pronouns, Seeking checkboxes Women/Men/Nonbinary, location, Search radius select [0=Anywhere…250mi], children/smoking/drinking), How you communicate (Directness/Style/Reply pace/How to talk to me), Sensory & environment (setting/lighting/social energy), Notifications, Pause my profile, Identity verification, Account & security (change password/email), Danger zone (Delete account). Save→reload PERSISTENCE confirmed (edited Tagline, reloaded, value persisted; restored to original).
- ADMIN / MODERATION (read-only): dashboard loads, stats (59 Members / 0 Suspended / 9 Matches / 40 Messages / 0 Open reports), filter tabs Open/Reviewed/Actioned/Dismissed/All. "Open" → "No open reports — all clear." "All" → resolved reports render (reporter→reported, email, reason, timestamp, status badge, Resolve-report dropdown + Apply, optional note, Suspend button). NOT executed any Apply/Suspend.
- ROUTING / RESILIENCE: ?tab= deep-link cold-load works (Matches/Profile/Messages/Safety/Settings); browser Back restores prior tab + title via popstate (confirmed back from profile → matches, title synced). No console errors observed on any screen walked.

---

## Coverage

Reached & exercised (desktop): landing + CTAs + footer; full auth (login valid-fail/invalid/empty, forgot-password, register reachability + validation, duplicate-email); Discover (card, not-now, skip→undo, done-for-now); Settings (theme + all 6 a11y toggles); Matches (card, avatar→profile modal + Escape); Messages (list, open, send, delete + confirm, react + toggle, search, header ⋯ menu, header-avatar profile + Escape); Profile editor (all field groups + save→reload persistence); Safety (Copy); Admin/Moderation (stats, all 5 filters, report cards). Deep-links + browser back.

Could NOT fully reach:
- TRUE MOBILE (<600px): `resize_window` to 420px did not shrink the content viewport (window.innerWidth stayed 1920; environment appears to enforce a min/fixed viewport). The 2-pane↔single-pane Messages switch and mobile bottom-nav layout could not be visually verified at narrow width. Code (src/useViewport.js + App.jsx isMobile branches) keys off innerWidth, so the breakpoint logic is present but unexercised live.
- MATCH MOMENT (mutual match): not triggered — would require a real mutual "I'm interested" like, which permanently creates a match with a sample profile (avoided per restore-data rule).
- EMPTY-DECK "all caught up" / failed-send retry / rate-limit / consent-gate / load-earlier pagination / archived conversations / block-report submission / account delete / pause / verification request: not exercised — each requires either exhausting/mutating sample data, network fault injection, or a destructive/irreversible action. Source review confirms the handlers exist (ConversationScreen.jsx retry/429/403 paths, MatchesScreen CAP_REACHED, etc.).
- Tab-change navigation was occasionally erratic during JS-driven testing (stray late-resolving clicks flipped tabs); did not reproduce as a user-facing defect when driving via the UI directly.

## Sample data touched / restored

- Discover: "Not right now" on Lucia Moreno → UNDONE via Undo (POST /matching/undo-skip 200). Restored.
- Profile (mira.k.1): Tagline temporarily changed to "…QA" and saved, then RESTORED to original "Botanist by day, stargazer by night" and re-saved (verified via reload). Restored.
- Messages (mira.k.1 ↔ Eli Brenner): sent one QA test message then DELETED it. Content gone, but its "Message deleted" tombstone is permanent and unrecoverable → the thread now shows 4 tombstones instead of the original 3. NOT fully restorable (delete is irreversible by design).
- Messages: added 👍 reaction to Eli's "Tea, strong…" message, then TOGGLED OFF. Restored. Pre-existing ♥1 reaction left intact.
- a11y prefs (device-local localStorage): toggled theme/largerText during testing, then RESET to defaults. Restored.
- Sessions: logged in as sample user and admin via API for testing; ended on the admin account (same account that was logged in at session start). No accounts created.
