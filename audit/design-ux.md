# Spectrum Dating — Design & UX Audit

Scope: visual design, UX quality, consistency, responsiveness, calm-by-design adherence.
Method: live site (light + dim themes, desktop ~1440px) + source review of `src/`.
Account used: mira.k.1 sample. No sample data mutated (no messages/reactions/likes/edits sent).

Calm-by-design absences (no typing indicators, online-now, read receipts, streaks) were confirmed intentional and are **not** flagged.

Environment caveat: the browser viewport could not be narrowed below ~1920px with the available tooling (`resize_window` did not affect `window.innerWidth`). **Mobile layout findings are therefore source-verified, not visually confirmed.** A follow-up pass on a real mobile width is recommended for the items tagged "(code-verified)".

Severity key: 🔴 blocker · 🟠 real UX problem · 🟡 minor/polish · ⚪ nit/observation

---

## Design system / consistency

### [DESIGN] 🟠 — Own-message bubbles are nearly invisible in the LIGHT theme
- where: Messages → conversation thread (`?tab=messages`), **light theme**, desktop
- detail: Own (right-aligned) bubbles use `t.bubbleOwn` = `#EEF1ED` and render directly on the thread background `t.bgGradient` (`#F4F5F2`→`#ECF0EB`). The bubble fill is within ~1.05:1 luminance of the background, so own messages read as unstyled floating text with no visible container — while the other person's bubbles have a white fill + border and read as proper bubbles. The result is an asymmetric, "half-styled" conversation. (In the DIM theme this is fine: `#2B3733` own vs `#232D2A` other both separate clearly from the dark bg — so this is a light-theme-only problem.)
- suggestion: Darken/saturate `--c-bubbleOwn` for light (e.g. a clearer green tint like `#E2EAE4` or add a `1px solid var(--c-border)` to own bubbles to match the other-bubble treatment). `ConversationScreen.jsx:558-559` (`background: isOwn ? t.bubbleOwn ...`, `border: isOwn ? "none" : ...`). Consider giving own bubbles a border in both themes for symmetry.

### [DESIGN] 🟡 — Panel gradient ends in a visible horizontal seam on short content
- where: Matches (`?tab=matches`), Messages list panel, Settings — **light theme**, desktop. Less visible in dim.
- detail: Several centered "panel" surfaces apply `t.bgGradient` to a region that is taller than its content, so the gradient stops partway down and plain background shows below it — producing a faint horizontal seam mid-panel (clearest on the Matches "Your matches" panel and the Messages conversation-list column, ~⅔ down). It reads as an unintentional banding artifact rather than a deliberate edge.
- suggestion: Either let the panel background fill its full height, or replace the per-panel gradient with a flat `t.surface`/`t.bg` for these short-content panels so there's no truncated-gradient seam. Audit where `t.bgGradient` is applied to fixed/min-height containers.

### [DESIGN] ⚪ — Large dead horizontal space on desktop; app is a narrow centered strip
- where: every authed screen, desktop (≥1100px)
- detail: Content caps at `t.layout.maxContent` (640px, +48px panel) and the primary nav is a fixed **bottom** bar also capped at 640px centered. On a wide desktop the app is a ~640px column floating in a large empty gradient field, with navigation pinned to the bottom-center rather than a top/side bar. It's internally consistent and calm, but feels under-utilized and slightly unusual for desktop (bottom tab bar is a mobile idiom). Not a bug — a product/layout choice worth a deliberate decision.
- suggestion: If desktop polish is a goal, consider a top or left nav for ≥1024px and a wider/optically-centered content frame. Otherwise document this as intentional. `App.jsx:1040-1075` (main panel sizing) and `App.jsx:1149-1198` (fixed bottom nav on all viewports).

### [DESIGN] ⚪ — Token system is clean and well-disciplined (positive)
- where: `src/tokens.js` + `index.html` `:root` / `:root[data-theme="dim"]`
- detail: Colors are CSS-var-backed with matching light fallbacks; every light var has a dim counterpart; dedicated `accentFill`/`dangerFill`/`positiveText` tokens exist specifically to hold AA contrast for white-on-fill in both themes. No hardcoded brand colors observed in the components reviewed (only `#fff`/`#000` shadows and white text on dark fills, which is correct). Theme parity is strong across Discover, Matches, Messages, Profile, Safety, Settings.

---

## Per-screen

### [DESIGN] 🟡 — Sign-in form validation error from one submit can feel abrupt
- where: Auth screen (`Sign in`)
- detail: Submitting with an empty/invalid email shows a red "Email is required." / "Invalid email address." banner at the **top of the card, above the fields** (`AuthScreen`). The banner is well-styled and themed, but its position above the inputs (rather than inline under the offending field) makes the association less obvious, and the red banner is the most "alarming" element on an otherwise calm screen. (Confirmed it appears only after a submit attempt, not pre-emptively on load — good.)
- suggestion: Render the validation message inline beneath the relevant field, or soften to the warmer error treatment used elsewhere. Keep the calm tone consistent with the rest of the app.

### [DESIGN] ⚪ — Discover: profile card hierarchy and "why you're seeing them" are excellent (positive)
- where: Discover (`?tab=suggestions`), both themes
- detail: Strong, calm hierarchy — large photo, serif name + inline Verified pill, pronouns, tagline, location, bio, "About talking", interests with a clear shared-marker legend (`✦ = shared`, filled vs outlined chips), and a plain-language "Why you're seeing X" reason list with checkmarks. Primary "I'm interested" + tertiary "Not right now" are unambiguous and low-pressure. Theme parity is clean in dim.

### [DESIGN] ⚪ — Messages: empty, deleted, error, rate-limit, offline states are all calm and present (positive)
- where: Messaging (`ConversationScreen.jsx`, `EmptyConversationState.jsx`, `ErrorState.jsx`)
- detail: Empty thread = "You matched with X. Send a message whenever you're ready. There's no rush." + optional personalized starter ideas. Deleted messages → muted italic "Message deleted" tombstone (calm, not destructive-looking). Failed send → "Didn't send. Retry". Rate-limit, consent-gate, and "Reconnecting…" socket states all have gentle, plain-language copy. Loading and error states use a shared illustrated `ErrorState`. This is a genuinely well-considered, calm messaging surface.

### [DESIGN] ⚪ — Safety Center and Profile are on-brand and reassuring (positive)
- where: Safety (`?tab=safety`), Profile (`?tab=profile`), both themes
- detail: Safety opens with "A calm place to prepare… Everything here stays on your device," a "Meeting safely" checklist, and ready-made "What to say" phrases with Copy buttons (warm sand/clay-tinted cards) — excellent calm-by-design. Profile has a completeness meter (7/8), photo grid with "Main" badge + dashed Add-photo tile, and a "Describe this photo / Helps screen-reader users" alt-text field — a thoughtful inclusion. Both theme cleanly in dim.

---

## Calm-by-design

### [DESIGN] ⚪ — Landing page strongly reinforces the calm proposition (positive)
- where: Landing (`/`, unauthenticated)
- detail: Hero "Meet people at your own pace.", "No typing dots. No 'online now.' No rush.", an explicit "What you won't find here" manifesto (no typing indicators / no online-now / no read receipts / no streaks / no red-dot anxiety / no swiping games), gentle one-shot fade honoring `prefers-reduced-motion`, and a "we celebrate quietly — no confetti, no noise" match tease. Microcopy is warm and plain throughout. Tone is on-point.

### [DESIGN] 🟡 — Dim theme is unreachable for unauthenticated visitors
- where: Landing + Auth screens, theme
- detail: The Landing and Auth screens use themed `t.*` tokens (so they *would* render in dim), but theme selection lives only in authed Settings and is persisted per-device in `localStorage`. A first-time visitor in a dark environment gets the bright light landing/auth with no way to dim it, and the app does not appear to respect the OS `prefers-color-scheme: dark` for the initial/unauthenticated state. For a low-sensory-load audience this is a missed calm opportunity at the very first impression.
- suggestion: Default the initial theme from `prefers-color-scheme` (fall back to light) so dim-preferring users get a calm first screen; keep the explicit Settings override. `SettingsScreen.jsx:16` default theme is `"light"`; `readA11y()` could seed from the media query when no saved pref exists.

### [DESIGN] ⚪ — "Reduce motion" and "Calm mode" overlap (minor)
- where: Settings → Accessibility
- detail: "Reduce motion" and "Calm mode" both turn off motion; Calm mode additionally hides decorative backgrounds. Toggling Calm mode also flips Reduce motion on (handled correctly in code), but two switches that partially do the same thing can read as redundant. Low impact; copy already explains the difference.

---

## Polish nits

### [DESIGN] 🟡 — Landing footer references "safety & privacy" with no privacy/terms links (CONFIRMED known issue)
- where: Landing footer (`/`)
- detail: Footer reads "Your safety & privacy come first." but there are no links to a privacy policy, terms, or the Safety Center. For a trust-sensitive dating product this is a real trust-signal gap. (`LandingScreen.jsx:584-589`.)
- suggestion: Add real footer links (Privacy, Terms, Safety, Contact). Even the existing in-app Safety Center content would be a good public link target.

### [DESIGN] ⚪ — Floating reaction pill reads as slightly detached from its message
- where: Messages thread, a message with a reaction (e.g. "♥1")
- detail: The active reaction pill (`accentFill` filled circle) sits at the bottom-right and visually floats below/beside the bubble rather than reading as clearly anchored to it. Minor; functional and themed correctly in both themes.

### [DESIGN] ⚪ — Browser autofill collides with the email field on Sign in
- where: Auth screen, observed during testing
- detail: Chrome autofill repeatedly pre-filled the email field with unrelated saved values, which appended to typed input. This is browser behavior, not an app defect, but the app could reduce friction. Mentioned for completeness, not as a product bug.

---

## Coverage notes
- Audited in BOTH themes: Discover, Matches, Messages (list + thread), Profile, Safety, Settings, Landing, Auth.
- Theme persistence was tested and **works** correctly across reload (an early apparent reset traced to a re-login, not a persistence bug — not flagged).
- Mobile (≤430px) could not be visually rendered with available tooling; `App.jsx` has clear `isMobile` branches (full-bleed main, mobile nav glyphs) and components use ≥44px touch targets and ≥48px send button throughout — but a real-device/narrow-viewport pass is recommended to confirm.
