# Round 2 — Accessibility & Calm-by-Design audit

Dimension: WCAG 2.2 AA + autism "calm-by-design".
Method: deep source review of `C:\Users\Pen\Desktop\Spectrum-Dating\src` + `index.html`, building on R1
(`audit/accessibility.md`, `audit/DESIGN_UPDATE_LOG.md`). All contrast ratios computed from the
light/dim CSS-variable values in `index.html` (sRGB relative-luminance, WCAG formula). Live Chrome
control was not used this round; focus behaviour verified by reading focus CSS + key handlers (the
more reliable method given the automation `:focus` caveat). Round-2 priority was NEW surfaces R1 never
reached: **AdminScreen (Moderation), SafetyScreen report pills, OnboardingScreen, SuggestionScreen
ReportModal, ProfilePreviewModal, the Profile Save button, Account & security forms, and the dim
theme on selected-chip fills** — plus confirming whether the R1 open items were fixed (they were not).

Severity: 🔴 critical · 🟠 serious · 🟡 moderate · ⚪ minor/advisory.

State of R1 fixes: **none of the R1 token edits shipped.** `--c-tombstone`, `--c-formBorder`,
`--c-bubbleOwn` are unchanged in `index.html`; `t.accent`-as-text, the `zoom` larger-text, the banner
"×" sizes, and the MatchProfileModal trap are all still in the code as R1 described.

---

## NEW this round

### [DESIGN] 🔴 — `t.positive` used as a button FILL with white text fails AA in BOTH themes (primary "Save changes")
- WCAG 1.4.3 Contrast (Minimum)
- where: light **and** dim — Profile "Save changes" button (`ProfileScreen.jsx:3868`, `SaveButton`);
  the Unsaved-changes dialog "Save and leave" button (`ProfileScreen.jsx:238-239`).
- detail: white `#fff` on `t.positive` = **3.59:1 in light** (`#5E9459`) and **2.32:1 in dim**
  (`#7FB87A`). Both below the 4.5:1 needed for the 17px button label. This is the single most-used
  primary action on the Profile screen, and it fails in *both* themes — the dim case badly. The
  codebase already documents the correct pattern: `tokens.js:22-25` notes `positive` is "tuned as a
  fill/border color" while `positiveText` is for text — but here `positive` is a fill carrying white
  *text*, which neither token guarantees.
- fix: give the Save / Save-and-leave buttons a dedicated AA-safe fill. Reuse `t.accentFill`
  (white-on-fill = 6.41 light / 6.27 dim) or add a `positiveFill` token (e.g. light `#4C7A47`,
  dim `#356E33`) that passes ≥4.5:1 white-on-fill in both themes. `ProfileScreen.jsx:3868`, `:238`.

### [DESIGN] 🔴 — `t.accentStrong` used as a white-text FILL collapses to 2.10:1 in DIM (selected chips, badges, buttons)
- WCAG 1.4.3 Contrast (Minimum)
- where: **dim theme** — every "selected" pill/badge/button that fills with `t.accentStrong` and puts
  white on it. Confirmed instances:
  - Onboarding selected-interest chips: `OnboardingScreen.jsx:154`, `:393`
  - Profile selected-interest chips: `ProfileScreen.jsx:2589`; `SuggestionChip` `:3777`
  - Photo "Main" badge: `ProfileScreen.jsx:338`
  - PromptChooser "Add prompt" (enabled state): `ProfileScreen.jsx:938`
  - Admin "Actioned" status pill: `AdminScreen.jsx:77` (`statusColor`) → white pill text
  - Safety "Actioned" report pill: `SafetyScreen.jsx:207` (`REPORT_STATUS`)
- detail: in dim, `accentStrong` = `#8FBCB2` (a *light* tint intended for text-on-dark, per
  `index.html:90`). White on it = **2.10:1**. In light it's `#3E6660` and passes (6.41:1), so this is a
  dim-only regression that R1 (which judged "fills are fine") missed because R1 only checked `accent`
  as text, not `accentStrong` as a white-on-fill in dim.
- fix: for any pill/badge/button that fills + carries white, use `t.accentFill` (the token built for
  exactly this — AA-safe white-on-fill in both themes). Keep `accentStrong` only for *text/icon/border*
  on light backgrounds.

### [DESIGN] 🔴 — Moderation status pills are white-on-light-fill: fail AA in light, fail badly in dim (AdminScreen + Safety "my reports")
- WCAG 1.4.3 Contrast (Minimum)
- where: AdminScreen report-status pills (`AdminScreen.jsx:255-268`, colors from `statusColor` `:72-80`)
  and the member-facing Safety report-status pills (`SafetyScreen.jsx:204-209`). Pill text is a fixed
  `#fff` (`AdminScreen.jsx:260`).
- detail: white text on each status color —
  - **Open** = white on `t.warning`: **3.25:1 light** (`#B8860B`), **1.98:1 dim** (`#D9B45A`).
  - **Reviewed** = white on `t.accent`: **3.89:1 light** (`#5B8A82`), **2.42:1 dim** (`#7FB0A7`).
  - **Actioned** = white on `t.accentStrong`: 6.41 light (ok) but **2.10:1 dim**.
  - **Dismissed** = white on `t.textMuted`: 5.31 light (ok) but **2.65:1 dim** (`#95A29A`).
  Three of four states fail in light; all four fail in dim. The Apply button below also fills with
  `t.accent` + white (`AdminScreen.jsx:163`, `PlainButton kind="accent"`) = 3.89:1 light / 2.42:1 dim.
- fix: pills should use darker fills with white text (or dark text on the light tints). For warning,
  use a dark amber fill (e.g. `#7A5A00`) or set pill text to `t.text`; for accent/accentStrong/muted
  pills, switch to `t.accentFill` / `t.dangerFill`-style dark fills. Make the Apply button
  `kind="accent"` use `t.accentFill` not `t.accent`. `AdminScreen.jsx:72-80,163`; `SafetyScreen.jsx:204-209`.

### [DESIGN] 🟠 — AdminScreen "confirm suspend" panel hardcodes `#FBF1F1`; text is invisible in dim
- WCAG 1.4.3 Contrast (Minimum) · theming
- where: AdminScreen suspend-confirmation panel (`AdminScreen.jsx:368-374`) — `background: "#FBF1F1"`
  (a literal light pink) with body text in `t.text`.
- detail: the bg is a hardcoded hex, so it does **not** switch with the dim theme. In dim, `t.text` =
  `#E4EAE6` on `#FBF1F1` = **1.10:1** — the "Suspend {name}? They'll be logged out…" warning is
  effectively unreadable exactly when an admin is about to take a destructive action. (Same anti-pattern
  as `ProfileScreen.jsx:324` `background:"#EEF1ED"` photo placeholder, lower stakes.)
- fix: use a themed token, e.g. `background: t.surfaceAlt` with `border: 1px solid ${t.danger}`, or a
  `dangerSurface` token defined per theme. `AdminScreen.jsx:370`.

### [DESIGN] 🟠 — Three modals lack a Tab focus trap + focus restoration (same class as R1's MatchProfileModal)
- WCAG 2.4.3 Focus Order · 2.1.2 No Keyboard Trap (inverse — focus escapes the dialog)
- where (all `role="dialog"`/`alertdialog`, focus a heading/close on open, support Escape, but have NO
  Tab cycle and do NOT restore focus to the opener on close):
  1. **SuggestionScreen ReportModal** — `SuggestionScreen.jsx:272-415` (Esc at `:246-252`, heading
     focus `:242-244`; no Tab trap, no restore).
  2. **ProfilePreviewModal** ("Preview my card") — `ProfileScreen.jsx:1299-1631` (Esc `:1261-1265`,
     heading focus `:1258`; no Tab trap, no restore).
  3. **MatchProfileModal** — `MatchProfileModal.jsx:43-48` — **confirmed still open from R1 (D3)**.
- detail: tabbing past the last control drops focus into the page behind the open dialog (the backdrop
  is only `aria-hidden`; the app under it is not `inert`). On close none of the three return focus to
  the element that opened them, so keyboard/SR users are dropped to `<body>`. Note: the *other* dialogs
  in the app (`UnsavedDialog`, `DeleteAccountDialog`, `MatchMoment`, `UnmatchSheet`) all implement a
  correct Tab cycle + restore — these three are the outliers.
- fix: reuse the existing Tab-cycle pattern from `DeleteAccountDialog` (`ProfileScreen.jsx:3574-3582`)
  and capture `document.activeElement` on open to restore on close. (R1 already noted this for
  MatchProfileModal; same fix applies to the two new ones.)

### [DESIGN] 🟠 — Account & security: new-password and email-password inputs have no programmatic label
- WCAG 1.3.1 Info & Relationships · 4.1.2 Name, Role, Value · 3.3.2 Labels or Instructions
- where: ProfileScreen → "Account & security" (`AccountSecuritySection`). The "New password" input
  (`ProfileScreen.jsx:3447`) and the "Current password" input in the change-email form
  (`ProfileScreen.jsx:3459`) have **only a `placeholder`** — no `id`+`<label htmlFor>` and no
  `aria-label`. The first input of each form is labelled (`FieldLabel htmlFor="cur-pw"` / `"new-email"`)
  but those labels point at the *first* field only.
- detail: placeholder text is not an accessible name; once the user types, the placeholder disappears
  and a screen reader announces an unlabelled "password" / "edit text". For a security-critical form
  (password / email change) this is a real gating issue.
- fix: give each input its own `id` + visible or visually-hidden `<label>` (or at minimum
  `aria-label="New password"` / `aria-label="Current password"`). `ProfileScreen.jsx:3447,3459`.

### [DESIGN] 🟡 — Account & security: error feedback is announced politely and rendered as soft (not error) text
- WCAG 3.3.1 Error Identification · 4.1.3 Status Messages
- where: `AccountSecuritySection` — both the password and email forms render their result via
  `<p role="status" style={{ color: t.textSoft }}>` (`ProfileScreen.jsx:3452,3464`). The same element
  carries success ("✓ Password updated.") and failure ("Couldn't change password.").
- detail: an *error* string is therefore (a) announced with `role="status"` (polite) rather than
  `role="alert"`/assertive, and (b) shown in muted gray, not danger color — so it neither reads nor
  sounds like an error. Contrast this with the rest of the app, which consistently uses `role="alert"`
  + `t.danger` for errors.
- fix: branch the styling/role on success vs failure — render failures with `role="alert"` and
  `color: t.danger`. `ProfileScreen.jsx:3452,3464`.

### [DESIGN] 🟡 — Offline banner overlaps the header (and the inactivity banner) — fixed-top with no reserved space
- WCAG 1.4.10 Reflow / robustness (calm-by-design: predictable layout)
- where: App shell. The offline banner is `position:fixed; top:0; z-index:300`
  (`App.jsx:898-910`); the inactivity warning is `position:fixed; top:0; z-index:200`
  (`App.jsx:488-490`); the email-verify banner is in normal flow. The app wrapper reserves
  `paddingBottom` for the bottom nav (`App.jsx:964`) but **no `padding-top`** for a top banner.
- detail: when offline, the banner is painted *over* the app header (wordmark + Safety/Settings links),
  obscuring them until reconnect. If the inactivity warning fires while offline, the higher-z offline
  banner covers the "I'm still here" countdown dialog entirely — the user can't see or reach the action
  that prevents logout. Low frequency, but the inactivity overlap is a genuine trap.
- fix: render top banners in flow (like the verify banner) or add matching `padding-top` to the
  wrapper while a top banner is shown; ensure the inactivity `alertdialog` always sits above transient
  status banners. `App.jsx:898-910, 488-490, 955-967`.

### [DESIGN] 🟡 — SuggestionScreen ReportModal "Submit report" hardcodes `#B94040`; ReportModal radios use `t.accent`
- WCAG 1.4.3 / theming · 1.4.11 Non-text Contrast
- where: `SuggestionScreen.jsx:402` (`background: "#B94040"`, the submit button) and the report-reason
  radios' `accentColor` (BlockReportScreen `:311` uses `t.accent`; this modal relies on native radios).
- detail: `#B94040` is the *light* danger hex hardcoded; in dim the danger fill token is `#9E3B3B`
  (`--c-dangerFill`), so the submit button stays the lighter red in dim instead of the theme's darker
  fill — white text on `#B94040` is 5.43:1 (passes) but it's an un-themed literal that diverges from
  the rest of the app's `t.dangerFill` usage and will drift. Minor, but it's a hardcoded brand color in
  a token-disciplined codebase.
- fix: use `t.dangerFill` for the submit button. `SuggestionScreen.jsx:402`.

### [DESIGN] 🟡 — VerifyEmail "Resend" and offline-banner borders fall below 3:1 non-text contrast
- WCAG 1.4.11 Non-text Contrast
- where: `VerifyEmailBanner` "Resend" button border = `t.warning` on `t.sand` bg
  (`App.jsx:428` on `:396`) = **2.34:1 light**; offline banner border = `t.warning` on `t.surfaceAlt`
  (`App.jsx:903`) = **2.86:1 light**. (The banner *text* passes easily — 9.5:1 / 11.6:1 — this is only
  the 1px boundary.)
- detail: the warning-on-warm-tint border is the visual boundary of the control/banner and should meet
  3:1. The button is still discoverable via its label, so moderate.
- fix: darken the border for these warm-tint contexts (a dedicated `warningBorder` ≥3:1) or thicken to
  a clearly perceivable weight. `App.jsx:428, 903`.

### [DESIGN] ⚪ — SuggestionScreen "why" checkmark uses `t.accent` (3.41:1 on surfaceAlt)
- WCAG 1.4.11 Non-text Contrast (decorative; advisory)
- where: `SuggestionScreen.jsx:827` — the `✓` bullet before each "Why you're seeing X" reason,
  `color: t.accent` on the `t.surfaceAlt` card.
- detail: the glyph is `aria-hidden` and paired with adjacent text, so it carries no standalone
  meaning — not a hard failure. But at 3.41:1 (light) it's a faint tick; if it's meant to read as a
  "match" affirmation, bump to `t.accentStrong` (6.41:1) for legibility. Advisory.

### [DESIGN] ⚪ — Dual age-range slider supports arrows only (no Home/End/PageUp-Down)
- WCAG 2.1.1 (enhancement, not a failure)
- where: `ProfileScreen.jsx:1010-1021` (`AgeRangeSlider` `handleKeyDown`).
- detail: the slider is otherwise exemplary — `role="slider"`, correct `aria-valuemin/max/now/text`,
  visible focus ring, pointer + keyboard. It only handles Arrow keys (±1). Home/End (jump to min/max)
  and PageUp/PageDown (larger steps) are conventional for sliders and would speed a 18→99 traverse for
  keyboard users. Not required for AA; nice-to-have. `ProfileScreen.jsx:1010`.

---

## Confirms R1 (re-verified still open this round)

| R1 ref | Issue | WCAG | Location | Sev | Verified |
|---|---|---|---|---|---|
| D1 | `t.accent` as TEXT fails 4.5:1 in light (3.89:1 / 3.41:1). ~8 controls. **Plus new instance** `ConversationScreen.jsx:1649` (attach button, behind `ATTACHMENTS_ENABLED`). | 1.4.3 | App.jsx:213,244; ConversationScreen:1295,1445,1649; MatchesListScreen:176,295; EmptyConversationState:122; BlockReportScreen:91; SafetyScreen:206 | 🟠 | Unchanged in source |
| D2 | Safety "Copy" — `await navigator.clipboard.writeText` still **not** wrapped in try/catch; only the execCommand fallback is guarded, so a rejection is uncaught and the graceful announce never runs. | 3.3.1 | SafetyScreen.jsx:170-172 | 🟠 | Confirmed unchanged |
| D3 | MatchProfileModal has no Tab trap and doesn't restore focus. | 2.4.3 / 2.1.2 | MatchProfileModal.jsx:43-48 | 🟠 | Confirmed (now grouped with 2 more modals above) |
| D4 | "Larger text" still uses CSS `zoom = 1.15` (no-op in Firefox). | 1.4.4 | App.jsx:304 | 🟡 | Confirmed unchanged |
| D5 | Deleted-message tombstone `#7A8C85` on `#F4F5F2` = **3.24:1** (light). | 1.4.3 | index.html:79; ConversationScreen:438,1497 | 🟡 | Recomputed, unchanged |
| D6 | Form-field border below 3:1 — **2.83:1 light / 2.00:1 dim**. | 1.4.11 | index.html:76,115 (e.g. ConversationScreen:1690) | 🟡 | Recomputed, unchanged |
| D7 | Banner "×" dismiss ≈28×20px, below 24×24 min. | 2.5.8 | App.jsx:353-371,442-460 | ⚪ | Confirmed `padding:"4px 8px"`, no min size |
| D10 | Own-message bubble `#EEF1ED` on `#F4F5F2` = **1.04:1** (light) — bubble invisible. | (design) 1.4.11-adjacent | index.html:77; ConversationScreen:558 | 🟠 | Recomputed, unchanged |

(R1 D13/D14/D15/D16/D19/D20 are design/UX items outside this pass; not re-verified here.)

---

## What passed (re-confirmed strong, incl. NEW surfaces audited this round)

- **Motion / reduced-motion** remains exemplary, including the newly-checked `MatchMoment` (renders end
  state immediately under reduced motion, opacity-led, RAMP intentionally un-themed on a dark overlay)
  and `Skeleton` (shimmer killed under `prefers-reduced-motion`, themed via CSS vars).
- **Dialog correctness on the well-built modals:** `UnsavedDialog`, `DeleteAccountDialog`, `MatchMoment`,
  `UnmatchSheet` all implement a real Tab cycle + Escape + focus restore. (Only the 3 read-only profile
  modals above are the gap.)
- **OnboardingScreen** is thorough: per-step heading focus, SR step live-region, gated `aria-invalid`,
  first-invalid-field focus on Continue, labelled DOB with `max` (18+), `aria-pressed` chips,
  `autoComplete="name"`, 44px targets, reduced-motion gating. Uses `accentStrong` correctly for *text*;
  its only exposure is the selected-chip *fill* in dim (covered in the 🔴 above).
- **ProfileScreen forms** (the bulk): exemplary labels/hints/`aria-describedby`, gated `aria-invalid`
  (P-2), per-photo alt-text field, `role="status"` counters, focus cascade on tag removal, dual-handle
  `role="slider"` with full ARIA, unsaved-changes guard with proper trap. (Exceptions: the Save-button
  fill contrast and the two unlabelled security inputs, above.)
- **AdminScreen structure**: `role="group"` segmented filter with `aria-pressed`, `role="status"` action
  live-region, labelled select + resolution textarea, 44px targets, confirm-before-suspend. Its issues
  are purely color (pills, Apply button, the hardcoded confirm panel).
- **Landmarks / skip link / titles / live regions / inactivity warning / status-not-by-color-alone**:
  all still solid as R1 documented. `VerifiedBadge` text passes AA in both themes (5.02 light / 6.11 dim).
- **`accentFill` / `dangerFill` discipline**: where the app uses the dedicated `*Fill` tokens for
  white-on-fill (Discover "I'm interested", unread badges, nav badges, Delete confirm), contrast is
  AA-safe in both themes (6.27–6.68:1). The failures above are precisely the spots that reached for
  `accent` / `accentStrong` / `positive` instead of the `*Fill` token.

---

## Top items (fix order)

1. 🔴 Stop filling white-text controls with `t.positive` — the Profile **"Save changes"** button is
   3.59:1 light / 2.32:1 dim. Use `accentFill` or a new AA-safe `positiveFill`. (`ProfileScreen.jsx:3868,238`)
2. 🔴 Replace `t.accentStrong`-as-white-fill with `t.accentFill` across selected chips / "Main" badge /
   "Add prompt" / Actioned pills — 2.10:1 in dim. (Onboarding, Profile, Admin, Safety — see list above.)
3. 🔴 Fix Moderation + Safety **status pills** (and the Admin "Apply" button): white-on-light-tint fails
   in light and badly in dim. Darker fills or dark pill text. (`AdminScreen.jsx:72-80,163`; `SafetyScreen.jsx:204-209`)
4. 🟠 Theme the Admin **confirm-suspend** panel — hardcoded `#FBF1F1` makes the destructive warning
   1.10:1 (invisible) in dim. (`AdminScreen.jsx:370`)
5. 🟠 Add Tab-trap + focus-restore to the 3 read-only modals (SuggestionScreen ReportModal,
   ProfilePreviewModal, MatchProfileModal); label the 2 unlabelled Account-security password inputs.
6. (carry-over) 🟠 R1 D1/D2/D3 and 🟡 D4/D5/D6/D10 are all still open in source — bundle with the above.
