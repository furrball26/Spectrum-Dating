# Spectrum Dating — Design Update Log

Consolidated from the 2026-06-30 audit (Accessibility + Design & UX). Both themes (light + dim) reviewed. Strong baseline overall — disciplined CSS-var token system, full light/dim parity, exemplary reduced-motion, calm empty/error/rate-limit states, dialog focus traps, 44px targets, good live regions and form semantics. The items below are the deltas.

Severity: 🔴 blocker · 🟠 real problem · 🟡 minor / polish · ⚪ nit

> **Coverage caveat (both live-walkers):** the browser viewport could not be narrowed below ~1920px, so **mobile findings are source-verified, not visually confirmed**. A real narrow-width pass is still owed.

---

## Accessibility (WCAG 2.2 AA)

| # | Issue | WCAG | Location | Sev |
|---|---|---|---|---|
| D1 | **`t.accent` (#5B8A82) as text fails AA in light theme** — 3.89:1 on white (3.41:1 on surfaceAlt) across ~8 controls (conversation back link, active Safety/Settings links, "Restore", empty-state links, block-report link, "Reviewed" label). The codebase already has the fix (`accentStrong` #3E6660 = 6.41:1) but applied it inconsistently. Dim passes. **Highest-value, lowest-effort a11y fix.** | 1.4.3 | `App.jsx:213,244`; `ConversationScreen.jsx:1295,1445`; `MatchesListScreen.jsx:176,295`; `EmptyConversationState.jsx:122`; `BlockReportScreen.jsx:91`; `SafetyScreen.jsx:206` | 🟠 |
| D2 | **Safety "Copy" throws uncaught NotAllowedError; graceful fallback never runs** (also logged as E4). | 3.3.1 / robustness | `SafetyScreen.jsx:169-173` | 🟠 |
| D3 | **MatchProfileModal has no Tab focus trap and doesn't restore focus on close** — focus escapes behind the open dialog and is lost to `<body>`. Every other dialog (UnmatchSheet, MatchMoment, Delete, MessageMenu) traps correctly. | 2.4.3 / 2.1.2 | `MatchProfileModal.jsx:43-48` | 🟠 |
| D4 | "Larger text" uses CSS `zoom` → no-op in Firefox (also E-adjacent). Switch to a `transform: scale` wrapper or rem-based scale. | 1.4.4 | `App.jsx:301-307` | 🟡 |
| D5 | Deleted-message tombstone text fails AA in light (3.24:1). Darken `--c-tombstone` (light) to ≈#5F6F67. | 1.4.3 | `index.html:79` | 🟡 |
| D6 | Form-field borders below 3:1 (light 2.83:1 / dim 2.00:1) — the resting unfocused field is hard to perceive (focus ring is strong, so moderate). Darken `--c-formBorder` per theme. | 1.4.11 | `index.html:76,115` | 🟡 |
| D7 | Banner "×" dismiss buttons ≈28×20px — below the 24×24 minimum (everything else is ≥44px). | 2.5.8 | `App.jsx:357-371,443-460` | ⚪ |
| D8 | Long passages set in italic serif (Newsreader) are harder for some dyslexic/low-vision readers; keep italics to ≤1 line, prefer upright for multi-line bio/context card. | calm-by-design | `MatchProfileModal.jsx:128`, taglines, Safety scripts | ⚪ |
| D9 | Skip-link/landmark set is adequate; no action — documented for completeness. | 2.4.1 | `App.jsx` | ⚪ |

## Design system / consistency

| # | Issue | Location | Sev |
|---|---|---|---|
| D10 | **Own-message bubbles nearly invisible in light theme** — `#EEF1ED` on `#F4F5F2` bg (~1.05:1); own messages read as unstyled floating text while the other person's render as proper white bubbles. Dim is fine. Give own bubbles a clearer tint or a `1px solid border` for symmetry. | `ConversationScreen.jsx:558-559` | 🟠 |
| D11 | Panel gradient ends in a visible horizontal seam on short content (Matches, Messages list, Settings) — `t.bgGradient` applied to taller-than-content regions. Fill full height or use flat `t.surface` for short panels. | (panels using `t.bgGradient`) | 🟡 |
| D12 | Token system is clean and well-disciplined — no hardcoded brand colors, full theme parity, dedicated `*Fill` tokens for AA-safe white-on-fill. *(positive)* | `tokens.js` + `index.html` | ✅ |

## Per-screen / UX

| # | Issue | Location | Sev |
|---|---|---|---|
| D13 | Sign-in validation error renders as a red banner *above* the fields rather than inline under the offending field — less obvious association and the most "alarming" element on a calm screen. Move inline / soften. | `AuthScreen` | 🟡 |
| D14 | **Dim theme unreachable for logged-out visitors** — Landing/Auth ignore OS `prefers-color-scheme`, so dim-preferring users get a bright first impression with no override. Seed initial theme from the media query when no saved pref. | `SettingsScreen.jsx:16`, `readA11y()` | 🟡 |
| D15 | Landing footer says "Your safety & privacy come first" with **no privacy/terms/safety links** — real trust-signal gap for a PII-handling dating app (also a Feature item; corroborated by Functional QA). Add Privacy / Terms / Safety / Contact links. | `LandingScreen.jsx:584-589` | 🟡 |
| D16 | "Reduce motion" and "Calm mode" overlap (both kill motion; Calm also hides decorative bg) — can read as redundant. Low impact; copy explains it. | Settings → Accessibility | 🟡 |
| D17 | Desktop is a ~640px centered strip with a mobile-style bottom nav and large empty side margins — internally consistent/calm but an under-considered desktop layout. Decide deliberately (top/left nav ≥1024px) or document as intentional. | `App.jsx:1040-1075,1149-1198` | ⚪ |
| D18 | Active reaction pill reads as slightly detached from its message bubble. | `ConversationScreen.jsx` | ⚪ |
| D19 | **"Pause my profile" lacks discoverable/instant access** — buried in the long profile form, applies only after global Save (also F17). A "take a break" affordance should be findable and immediate for this audience. | Profile form | 🟡 |
| D20 | Profile-completeness chip ("Set who you're looking for") doesn't scroll/focus to its target field on click — the user must hunt for the "Who do you want to meet?" checkboxes. | Profile editor | ⚪ |

## Strong points (keep)
Exemplary motion/reduced-motion (OS + in-app toggle, dynamic `matchMedia`, end-state-immediate, no confetti/sound); uniform focus ring (13.2:1 light / 11.6:1 dim); bulletproof skip link; correct dialog semantics + traps everywhere except D3; thorough form a11y (labels, `aria-describedby`, `role=alert`, gated `aria-invalid`, per-photo alt text); good live regions; status-not-by-color-alone for unread; 20-min inactivity warning with grace countdown; calm, plain-language empty/error/rate-limit/offline states; warm on-brand microcopy; the landing "what you won't find here" manifesto. Dim-theme contrast is clean throughout — light-theme accent/tombstone are the only color regressions.
