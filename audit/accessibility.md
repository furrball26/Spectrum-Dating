# Accessibility audit — Spectrum Dating

Dimension: WCAG 2.2 AA conformance + autism "calm-by-design" principles.
Method: source review of `C:\Users\Pen\Desktop\Spectrum-Dating\src` + `index.html`; contrast
ratios computed from the light/dim CSS variable values in `index.html` (sRGB relative-luminance,
WCAG formula). Live-site / Chrome browser tooling was unavailable (permission denied), so dynamic
focus-engagement was verified by reading the focus CSS + handlers rather than by screenshot — which
is the more reliable method here anyway (the brief notes programmatic `.focus()` does not engage
`:focus` in automation).

Severity key: 🔴 critical · 🟠 serious · 🟡 moderate · ⚪ minor/advisory.

---

## Findings

### [DESIGN] 🟠 — Accent text color fails AA 4.5:1 in light theme (multiple controls)
- WCAG 1.4.3 Contrast (Minimum)
- where: light theme — Conversation header "← Matches" back button; active Safety / Settings header
  links; MatchesList "Restore"; EmptyConversationState link; BlockReportScreen link; Safety status
  "Reviewed" label.
- detail: `t.accent` = `#5B8A82` on white surface = **3.89:1** (on `surfaceAlt` `#EEF1ED` = **3.41:1**).
  All these are normal-size text (14–15px), which requires ≥4.5:1. Fails. The codebase already knows
  this pattern is bad — `AuthScreen.jsx:416` carries the comment *"was t.accent — #5B8A82 fails 4.5:1
  AA"* and switched to `accentStrong` — but the fix was not applied consistently.
  Dim theme passes (`#7FB0A7` on `#232D2A` = 5.86:1).
- fix: use `t.accentStrong` (light `#3E6660` = 6.41:1) for any `t.accent` used as text. Files/lines:
  `App.jsx:213`, `App.jsx:244`; `messaging/ConversationScreen.jsx:1295`, `:1445`;
  `messaging/MatchesListScreen.jsx:176`, `:295`; `messaging/EmptyConversationState.jsx:122`;
  `messaging/BlockReportScreen.jsx:91`; `SafetyScreen.jsx:206`. (Keep `t.accent` where it's used as a
  fill/border/dot — those uses are fine.)

### [DESIGN] 🟠 — "Copy" script throws uncaught NotAllowedError; graceful fallback never runs
- WCAG 3.3.1 / robustness (known issue — confirmed, root cause located)
- where: Safety Center → conversation-starter / boundary scripts → "Copy" button.
- detail: `SafetyScreen.jsx:169 copyText()` — when `navigator.clipboard.writeText` *exists* but the
  promise **rejects** (NotAllowedError: clipboard-write permission denied, no transient user
  activation, or insecure context), the `await` at line 171 is **not wrapped in try/catch**. Only the
  legacy `execCommand` branch (176–188) is guarded. The rejection propagates out of `copyText`, and
  the caller `handleCopyScript` (`:361`) also has no try/catch — so it surfaces as an uncaught promise
  rejection and the intended `announce("Couldn't copy…")` (`:367`) never fires. The user gets no
  feedback and SR users hear nothing.
- fix: wrap the async-clipboard attempt: `try { await navigator.clipboard.writeText(text); return
  true; } catch { /* fall through to execCommand */ }` so a rejection falls back to the manual path
  and ultimately returns `false`, letting the existing graceful announcement run. `SafetyScreen.jsx:170-173`.

### [DESIGN] 🟠 — MatchProfileModal is not a focus trap and does not restore focus
- WCAG 2.4.3 Focus Order · 2.1.2 No Keyboard Trap (inverse — focus escapes the dialog)
- where: any screen — tapping a matched person's avatar/name (e.g. conversation header → "View …'s
  profile", Matches). `MatchProfileModal.jsx`.
- detail: The component is `role="dialog" aria-modal="true"` and focuses the close button on open
  (`:43`) and supports Escape (`:44-48`) — but there is **no Tab focus trap**. Tabbing past the last
  focusable element (e.g. links inside the bio, or the close button) moves focus into the page behind
  the modal, which is still in the tab order (the backdrop is `aria-hidden` but the underlying app is
  not `inert`/`aria-hidden`). Also, on close, focus is **not returned** to the avatar button that
  opened it — it's lost to `<body>`, so keyboard/SR users are dropped at the top of the document.
  Contrast this with `UnmatchSheet`, `MatchMoment`, and the message Delete/MessageMenu dialogs, which
  all implement a proper Tab trap.
- fix: add the same Tab-cycle handler used in `UnmatchSheet.jsx:46-60` (cycle among the dialog's
  focusable elements), and capture `document.activeElement` on open to restore on unmount/close.
  `MatchProfileModal.jsx:43-48`.

### [DESIGN] 🟡 — "Larger text" toggle uses CSS `zoom` (no-op in Firefox)
- WCAG 1.4.4 Resize Text (confirm-only; pre-known)
- where: Settings → "Larger text". `App.jsx:304` (`a11yWrapperStyle`: `style.zoom = 1.15`).
- detail: Confirmed. `zoom` is non-standard; Firefox historically ignored it for layout, so the toggle
  silently does nothing there. It also doesn't compose with browser zoom predictably. The in-app copy
  ("Enlarge everything by about 15%") promises a result the toggle can't deliver cross-browser.
- fix: drive a root font-size / `rem`-based scale, or apply `transform: scale()` on a sized wrapper, or
  use the CSS `zoom` *plus* a `@supports`-gated fallback. Because the design uses px inline styles
  throughout, a true rem refactor is large — at minimum switch to a `transform: scale` wrapper that
  works in all engines. `App.jsx:301-307`.

### [DESIGN] 🟡 — Deleted-message ("tombstone") text fails AA in light theme
- WCAG 1.4.3 Contrast (Minimum)
- where: light theme — a deleted message renders italic 14px "Message deleted." in `t.tombstone`.
  `messaging/ConversationScreen.jsx:438` area.
- detail: `t.tombstone` light `#7A8C85` on page bg `#F4F5F2` = **3.24:1** (on white = 3.55:1). This is
  informational text < 18px, so it needs ≥4.5:1. Fails in light. (Dim passes: `#8A988F` on `#232D2A`
  = 4.71:1.) The bubble also exposes `aria-label="Message deleted."` so SR users are fine; this is a
  low-vision sighted-reader gap.
- fix: darken the light `--c-tombstone` to ≈`#5F6F67` (≈5.3:1) or pair it with non-italic weight.
  `index.html:79`.

### [DESIGN] 🟡 — Form-field borders fall below the 3:1 non-text-contrast threshold
- WCAG 1.4.11 Non-text Contrast
- where: both themes — text inputs / textareas (`AuthScreen` inputs use `t.formBorder`;
  message composer `ConversationScreen.jsx:1690` uses `t.formBorder`).
- detail: `t.formBorder` light `#8A9E96` on white = **2.83:1**; dim `#4A5C55` on `#232D2A` = **2.00:1**.
  The 1px border is the primary visual boundary of the control, so it should meet 3:1. Mitigated by
  always-present `<label>`/`aria-label` and a strong focus ring (focus passes easily: 13.2:1 light /
  11.6:1 dim), so this is moderate, not serious — but the *resting* state of an unfocused field is
  hard to perceive, especially in dim.
- fix: darken `--c-formBorder` to ≥3:1 against `--c-surface` in each theme (e.g. light ≈`#6F8278`,
  dim ≈`#5E726B`). `index.html:76,115`.

### [DESIGN] 🟡 — Skip link reveals at `top:12px` but the app header/banner is not given a `<header>` role; landmark set is adequate but skip-link doesn't account for the verify/offline banners
- WCAG 2.4.1 Bypass Blocks (advisory refinement)
- where: authed app shell. `App.jsx` — `SkipLink` jumps focus to `<main id="main-content">`.
- detail: This mostly works (main is `tabIndex={-1}`, focused on activation, `scrollIntoView`). Minor:
  when the offline banner or email-verify banner is shown they sit above the header as fixed/flow
  elements; the skip target is correct (main), so no functional break — noting only that there is no
  skip mechanism *to* those transient banners, which is acceptable. Landmarks present: `<header>`
  (implicit banner), `<nav aria-label="Primary">`, `<main aria-label=…>`. No explicit `role="banner"`
  needed since `<header>` is a top-level child. No action required beyond awareness.
- fix: none required; documented for completeness.

### [DESIGN] ⚪ — Decorative "×" close/dismiss glyphs rely on `aria-label` but are visually 20px in a 44px target (OK) — verify hit area in VerifyResultBanner dismiss
- WCAG 2.5.8 Target Size (Minimum, 2.2)
- where: `App.jsx` VerifyResultBanner / VerifyEmailBanner dismiss "×".
- detail: The dismiss buttons use `padding: "4px 8px"` with `fontSize:20` and no explicit min-height.
  Rendered box ≈ 28×20px — **below the 24×24 CSS-px minimum** of WCAG 2.2 SC 2.5.8 unless line-height
  padding pushes it over. Most other touch targets in the app are correctly ≥44px (nav, send, modal
  buttons, reaction pills all set `minHeight`/`minWidth`). These two banner dismiss buttons are the
  exception.
- fix: add `minWidth:24, minHeight:24` (ideally 44) to the dismiss buttons. `App.jsx:357-371` and
  `:443-460`.

### [DESIGN] ⚪ — "In their words" / italic serif quote blocks set long passages in italic
- Calm-by-design (clarity / dysl-friendly legibility)
- where: MatchProfileModal context card (`:128`), profile taglines, Safety scripts (blockquote).
- detail: The app commendably ships Atkinson Hyperlegible as the body face, but several
  user-content blocks render in *italic serif* (`fontStyle:italic`, Newsreader). Extended italic is
  harder for some dyslexic/low-vision readers. These are short (taglines, one-line quotes) so impact
  is low, and it's a deliberate brand "voice" choice.
- fix: keep italics to ≤1 line; for the multi-line bio/context card, prefer upright. Advisory only.

---

## What passed (strong points)

- **Motion / reduced-motion (1.4.2 / 2.3.3): exemplary.** Global injected reduce-motion stylesheet
  (`App.jsx:263`), honored by both the OS `prefers-reduced-motion` *and* an in-app toggle, with
  dynamic `matchMedia` listeners (not a stale snapshot). `MatchMoment`, `UnmatchSheet`,
  `AnimatedSpectrumMark`, and the landing hero all render the END state immediately under reduced
  motion — no flash of unsettled frames. All motion is opacity-led, ≤8px travel, no scale-bounce, no
  loops, no confetti, no sound. Calm-by-design done right.
- **Focus visibility (2.4.7):** consistent `useFocusable()` ring (`2px solid t.focus`, 2px offset);
  focus ring contrast 13.2:1 light / 11.6:1 dim. Applied uniformly via inline style (robust to the
  automation `:focus` caveat).
- **Skip link (2.4.1):** bulletproof CSS `:focus` reveal, JS-independent; jumps to `<main tabIndex=-1>`.
- **Dialog semantics + traps:** `UnmatchSheet`, `MatchMoment`, message Delete (`alertdialog`),
  MessageMenu/ReactionPicker (`menu`/`toolbar`, arrow-key nav, Escape returns focus to anchor),
  InactivityWarning (`alertdialog`, focuses CTA) — all correct. (MatchProfileModal is the one gap, above.)
- **Forms (3.3.x, 1.3.1, 4.1.2):** ProfileScreen is thorough — `htmlFor` labels, `aria-describedby`
  hints, `role="alert"` errors, `aria-invalid` gated until a save is attempted (P-2), per-photo alt
  description field, native radio/checkbox groups. AuthScreen has proper `autocomplete`
  (`email` / `new-password` / `current-password`), `aria-required`, error focused on appearance.
- **Live regions (4.1.3):** SPA tab changes announced (`aria-live` screen-name region + `document.title`
  sync); send status, char-counter, rate-limit, offline, and verify banners all use `role="status"`/
  `alert` appropriately. Conversation log is `role="log" aria-live="polite"`.
- **Images / alt (1.1.1):** real photos get meaningful alt ("Photo of {name}" or user-supplied
  description); decorative monogram avatars + brand marks + glyph SVGs are correctly `aria-hidden`/
  `focusable="false"`.
- **Target size (2.5.8):** nav tabs, bottom bar, send, reaction pills, modal buttons, overflow menus
  all ≥44px (only the two banner "×" dismisses fall short).
- **Inactivity (2.2.1):** a 20-min idle warning with a 2-min countdown and "I'm still here" CTA
  precedes the abrupt 401 logout — a genuinely good autism-friendly touch (predictable, no surprise).
- **Status not by color alone (1.4.1):** unread conversations convey state via accessible name
  ("Unread: New messages."), bold weight, AND left border — not just the accent dot.
- **Dim theme contrast:** every text pair I measured in dim passes AA (≥5:1 typical). The light-theme
  `accent`-as-text and `tombstone` cases are the only color regressions; dim is clean.
- **Calm-by-design overall:** low-stimulation toggle, plain-language toggle, calm mode, no urgency
  patterns, no infinite loops, predictable fixed bottom-nav on every viewport, no autoplay.

## Top items (fix order)

1. 🟠 Replace `t.accent` with `t.accentStrong` for the ~8 text usages failing 4.5:1 in light theme.
2. 🟠 Wrap the async-clipboard call in try/catch so Safety "Copy" degrades gracefully (SafetyScreen.jsx:170).
3. 🟠 Add a Tab focus trap + focus restoration to `MatchProfileModal` (only modal missing both).
4. 🟡 Replace CSS `zoom` for "Larger text" with a cross-engine scale (Firefox no-op, App.jsx:304).
5. 🟡 Raise `--c-tombstone` (light) and `--c-formBorder` (both themes) to meet 1.4.3 / 1.4.11.
