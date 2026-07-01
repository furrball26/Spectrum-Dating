# Spectrum Dating — Design & UX Audit, Round 2

Scope: deeper pass focused on screens/states R1 under-covered — the 3-step **Onboarding** flow, the **Admin / Moderation** dashboard, **Identity-verification** and **Pause-profile** UI, **Reset-password** screen, and shared **loading / skeleton / error / empty** states. Plus dim-theme parity edge cases and information hierarchy.

Method: source review of `src/` against R1 findings (`audit/design-ux.md`, `audit/DESIGN_UPDATE_LOG.md`). Account: mira.k.1 sample.

**Coverage caveat (carried from R1, still true):** live browser driving was unavailable this round (Chrome MCP permission denied), so all findings below are **source-verified, not visually confirmed**, and the owed narrow-width (≤430px) visual pass is still outstanding. Contrast ratios are computed from the hex values in `tokens.js` / `index.html`.

Severity: 🔴 blocker · 🟠 real UX problem · 🟡 minor / polish · ⚪ nit

Calm-by-design absences (typing indicators, online-now, read receipts, streaks, urgency) remain confirmed intentional and are **not** flagged.

---

## NEW this round — Design system / consistency

### [DESIGN] 🟠 — Admin status pills: white text on `warning`/`accent` fills fails AA (both themes)
- where: Admin → Moderation, report status pill + segmented-control colors, **light + dim**, desktop
- detail: `statusColor()` (`AdminScreen.jsx:72-80`) maps **open → `t.warning`**, **reviewed → `t.accent`**, actioned → `t.accentStrong`. The pill renders 12px white text on those fills (`AdminScreen.jsx:255-268`). White on light `warning` #B8860B ≈ **3.0:1**; white on light `accent` #5B8A82 ≈ **3.0:1** — both fail the 4.5:1 AA threshold for this small bold text. Dim is worse: white on dim `warning` #D9B45A ≈ **1.8:1** and on dim `accent` #7FB0A7 ≈ **2.1:1** — effectively illegible. This is the same `accent`-as-fill class of bug the token system already solved elsewhere (`accentFill`, `dangerFill`, `positiveText` exist precisely for white-on-fill AA). The "open" and "reviewed" states are the most common, so this hits the default view.
- suggestion: Use the AA-safe fills for pill backgrounds (`t.accentFill` for reviewed; introduce a `warningFill`/dark-amber for open), or invert to a tinted-bg + dark-text treatment. `AdminScreen.jsx:72-80,255-268`. The `accent` segmented-control / `PlainButton kind="accent"` (line 163) carries the same white-on-`accent` risk and should move to `accentFill`.

### [DESIGN] 🟠 — Hardcoded warning callout colors break the dim theme (Safety check-in banner)
- where: Safety Center → "Time to check in" banner, **dim theme**, all viewports
- detail: The check-in alert hardcodes `background: "#FBF6E9"` and `color: "#6E5206"` (`SafetyScreen.jsx:512,522`). These are not tokens, so in the dim theme the banner stays a **pale cream box with dark brown text** floating on the dark surface — a jarring, un-themed light slab on the one screen built around calm. The border (`t.warning`) does theme, compounding the mismatch (warm amber border around a light box). In light theme it's fine.
- suggestion: Add themed warning-surface tokens (e.g. `--c-warningSurface` / `--c-warningText`) with a dim variant (dark amber-tinted surface + light amber text), and reference them here. `SafetyScreen.jsx:512,522`; tokens in `index.html`.

### [DESIGN] 🟠 — Hardcoded danger-tint confirm box breaks the dim theme (Admin suspend)
- where: Admin → Moderation → "Suspend {name}?" inline confirm, **dim theme**, desktop
- detail: The suspend-confirmation block hardcodes `background: "#FBF1F1"` (`AdminScreen.jsx:370`) — a pale pink. In dim it renders as a **light pink slab** with a `t.danger` border around it, the same un-themed-slab problem as the Safety banner. The destructive-confirm pattern in `ProfileScreen`/messaging uses themed surfaces; admin diverges.
- suggestion: Replace with a themed danger surface token (`--c-dangerSurface`, dim = desaturated dark-red tint) or reuse `t.surfaceAlt` with the `t.danger` border. `AdminScreen.jsx:370`.

### [DESIGN] 🟡 — Profile photo-tile placeholder is a hardcoded light gray in dim
- where: Profile → photo grid, empty/loading tile fill, **dim theme**
- detail: The photo tile background is hardcoded `background: "#EEF1ED"` (`ProfileScreen.jsx:324`) — the light-theme `surfaceAlt`. Behind a transparent PNG or during image load it shows as a light gray square on the dark profile surface. Minor (covered once the photo paints) but it's a flash + a parity gap.
- suggestion: Use `t.surfaceAlt` (themed). `ProfileScreen.jsx:324`.

### [DESIGN] ⚪ — `accentStrong` used as a chip *fill* with white text — verify dim (Onboarding/Profile interests)
- where: Onboarding Step 2 selected-interest chips + custom "Add" pills; Profile interest chips — **dim theme**
- detail: Selected chips set `background: t.accentStrong` + `color:#fff` (`OnboardingScreen.jsx:153-155,393-394`). In **light** `accentStrong` #3E6660 vs white = 6.4:1 (good). In **dim** `accentStrong` is #8FBCB2 (a light mint) — white text on it ≈ **1.9:1**, illegible. This is the documented reason `accentFill` (dim #356962) exists. The codebase chose `accentStrong` here, which is a fill-with-white-text usage and should be `accentFill` in dim. (Onboarding only ever renders pre-auth in light today, but a dim-preferring onboard — see D14 fix — would expose it; Profile chips render in dim now.)
- suggestion: Switch white-on-fill chips to `t.accentFill`. `OnboardingScreen.jsx:153,393`; Profile interest chips.

---

## NEW this round — Per-screen

### [DESIGN] 🟡 — Onboarding completion has no confirmation / arrival moment
- where: Onboarding Step 3 → "Save & start exploring", all themes
- detail: On the final step the primary button saves the profile and immediately calls `onComplete()` (`OnboardingScreen.jsx:683-701`) which drops the user straight into the app. For a first-time, possibly anxious user who just invested in 3 steps, there's no "You're all set" beat, no recap of what happens next, and no soft landing toward Discover. Calm-by-design favors predictability — an unannounced jump into a populated Discover feed can feel abrupt. (The button label does set the expectation, which helps.)
- suggestion: Consider a brief, optional welcome/confirmation state ("Your profile's ready — here's what to expect in Discover. There's no rush.") before handing off, consistent with the landing's tone. Low effort, high reassurance.

### [DESIGN] 🟡 — Onboarding Step 3 collects "What are you looking for?" but Step 2 never surfaces "Who you want to meet"
- where: Onboarding flow, information hierarchy
- detail: Onboarding gathers displayName/DOB (1), bio/interests (2), comm-note/relationship-goal (3). It never collects **seeking / preferred age range / who you want to meet** — those live only in the full Profile editor later. R1 (D19/D20) flagged that "who you want to meet" is hard to find in the profile form; onboarding is the natural place to seed it, and its absence means new users land in Discover with default/empty match preferences. This is a hierarchy gap more than a visual bug.
- suggestion: Either add a light "who you'd like to meet" step (kept optional/skippable to stay low-pressure) or, on first Discover entry, nudge once toward setting preferences. Coordinate with the product backlog; flagging from the design side because it affects first-run quality.

### [DESIGN] ⚪ — Onboarding step indicator hides the heading from the live region's perspective (minor redundancy)
- where: Onboarding, all steps
- detail: Nicely done overall — `Spectrum variant="progress"` tiles + "Step N of 3" + an aria-live announcement of the step heading (`OnboardingScreen.jsx:744-769`). The visible "Step N of 3" text sits next to an `aria-hidden` progress mark, and a separate offscreen live region re-announces "Step N of 3: {heading}". Slight duplication but harmless. Calling out as a *strong* pattern, not a defect.

### [DESIGN] 🟡 — Verification "Pending review" / "rejected" states are calm but the rejected reason is generic
- where: Profile → Identity verification card, both themes
- detail: The card handles verified / pending / rejected / unrequested cleanly with themed tokens and a low-key outline button (`ProfileScreen.jsx:3242-3316`) — good. The **rejected** copy ("Your previous request wasn't approved… make sure your profile photo clearly shows your face." `:3275`) assumes the reason is always the photo. If a request is rejected for another reason the guidance misleads. For a vulnerable audience, a wrong-but-confident instruction is worse than a neutral one.
- suggestion: Either surface the actual rejection reason (if the backend stores one) or soften to "We couldn't confirm it this time. A clear, well-lit photo of your face helps." `ProfileScreen.jsx:3274-3276`.

### [DESIGN] ⚪ — Reset-password screen is on-brand and complete (positive)
- where: `?reset=TOKEN`, both themes
- detail: `ResetPasswordScreen.jsx` themes correctly (`t.*` throughout, `accentFill` button = AA white-on-fill), focuses the heading on mount, moves focus to the error on failure (`:16-17`), uses `noValidate` + inline `role="alert"` error, and has a calm "Password updated → Go to sign in" success state. No hardcoded colors. Good.

### [DESIGN] ⚪ — Admin skeleton + empty + error states are all present and calm (positive)
- where: Admin → Moderation, loading/empty/error, both themes
- detail: `ReportsSkeleton` (aria-hidden shimmer cards), a friendly empty state ("No open reports — all clear."), and the shared `ErrorState` with retry are all wired (`AdminScreen.jsx:8-32,486-508`). Stats load non-blocking and fail silently (`:411-415`) so a stats hiccup never breaks the page. Genuinely thorough for an internal tool.

---

## NEW this round — Calm-by-design

### [DESIGN] 🟡 — Pause-profile is now discoverable in Profile, but still gated behind the global Save (confirms + extends R1 D19)
- where: Profile → "Pause my profile" card, both themes
- detail: Good news: a dedicated **Pause my profile** card with a proper `role="switch"` toggle now exists (`ProfileScreen.jsx:3221-3237, PauseToggle :736-780`) and reads calmly ("turn this back on anytime. Your matches and messages stay."). But toggling it only flips local state — it applies on the **global profile Save**, alongside every other edited field (`:2050,2082`). For a "take a break" affordance the expectation is *immediate* effect; a user who flips Pause and navigates away without hitting Save stays visible in Discover. R1 D19 predicted exactly this.
- suggestion: Make Pause apply immediately on toggle (optimistic PATCH with its own confirmation), decoupled from the form's dirty-state Save. Keep the toggle where it is — discoverability is solved; immediacy isn't. `ProfileScreen.jsx:3223,2050`.

### [DESIGN] ⚪ — Onboarding contact-gating reassurance is excellent (positive)
- where: Onboarding Step 3 footer, both themes
- detail: The closing reassurance — "You're in control of who can reach you. Only people you and they have both said yes to can message you — no one can message you out of the blue." (`OnboardingScreen.jsx:582-595`) — is precisely the right thing to tell an anxious new user at sign-up. Warm, plain, no pressure. Keep.

---

## Confirms R1 (re-verified in source this round)

- **D10 / own-message bubble invisible in light** — UNFIXED. `--c-bubbleOwn` (light) still `#EEF1ED` on `#F4F5F2` bg (`index.html:77`). 🟠
- **D5 / deleted-message tombstone fails AA in light** — UNFIXED. `--c-tombstone` (light) still `#7A8C85` ≈ 3.2:1 (`index.html:79`). 🟡
- **D6 / form-field borders below 3:1** — UNFIXED. `--c-formBorder` (light) still `#8A9E96` (`index.html:76`), dim `#4A5C55` (`index.html:115`). Onboarding + Reset + Profile inputs all inherit this. 🟡
- **D1 / `accent` as text fails AA in light** — still the same `accent` #5B8A82 token (`index.html:52`); per-call audit not re-done this round, but the new Admin pill finding above is the same root cause manifesting as fills. 🟠
- **D14 / dim unreachable when logged-out** — onboarding/auth/reset all theme via `t.*` but still no `prefers-color-scheme` seed; a dim-preferring user onboards in light. 🟡
- **D17 / desktop is a 640px centered strip** — Admin (`maxContent` shell, `AdminScreen.jsx:444`), Onboarding (`maxWidth:480` card) and every authed screen still center-narrow on desktop. Consistent, deliberate-looking; carry the "decide or document" note. ⚪

---

## Strong points (keep)

- **Onboarding** is a model calm flow: 3 short steps, spectrum-tile progress (not a test-like bar), heading-focus on step change, first-invalid-field focus on error, inline `role="alert"` errors, live char-counters, ≥44px chips/targets, reduced-motion respected, and a control-and-consent reassurance footer.
- **Admin / Moderation** is unusually disciplined for an internal tool: reds reserved strictly for destructive actions, two-step suspend confirm, optional resolution notes, skeleton/empty/error states, non-blocking stats, polite live region for action feedback.
- **Verification + Reset-password** screens theme cleanly and use the AA-safe `accentFill`/`positiveText` fills, focus management, and calm copy.
- **Shared `ErrorState` + `Skeleton`** are consistent, reduced-motion-aware (shimmer disabled under `prefers-reduced-motion`), and themed — failures and loads feel gentle everywhere they're used.
- **Token system** remains strong: dedicated `*Fill` / `*Text` tokens exist for AA white-on-fill; the *only* color regressions are spots that don't use them (Admin pills, the two hardcoded warning/danger callouts, the photo-tile placeholder).
