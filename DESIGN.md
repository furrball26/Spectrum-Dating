# Spectrum Dating — Design System

The visual language. Calm, predictable, warm, low-stimulation — the opposite of
loud, gamified dating apps. Built for autistic adults; "nothing about us without
us." Everything here lives in `src/tokens.js` (import `{ t }`) and is applied via
inline styles. Colors are CSS-variable-backed, so they theme automatically.

---

## Principle
**Calm is a design decision** — made of whitespace, soft deceleration, restraint,
and the *absence* of dark patterns. No streaks, no red dot anxiety, no "X people
liked you!", no "they're typing…", no read receipts. Predictability over delight;
the one allowed flourish (the match moment) is still quiet.

---

## Color (`t.*`, CSS-variable-backed → auto-themes)
Sage/forest-green spine + warm sand/clay + cool teal.

| Token | Light | Role |
|---|---|---|
| `bg` | `#F4F5F2` | App background (`bgGradient` for the subtle gradient) |
| `surface` | `#FFFFFF` | Cards |
| `surfaceAlt` | `#EEF1ED` | Quiet fills, chips |
| `text` / `textSoft` / `textMuted` | `#24332D` / `#4E5F58` / `#7A8C85` | Text hierarchy |
| `accent` / `accentStrong` | `#5B8A82` / `#3E6660` | Links / primary buttons |
| `positive` | `#5E9459` | Success, verified |
| `danger` | `#B94040` | Destructive only (reserve it) |
| `warning` | `#B8860B` | "Not yet" — use *before* red |
| `border` / `borderLight` | `#D3DBD5` / `#E8EDE7` | Green-tinted dividers |
| `sand` / `clay` / `teal` | `#E7D9C4` / `#C9A875` / `#4F8A8B` | Warm + cool secondaries |
| `green50…green900` | ramp | Surfaces, hovers, secondary-button fills |

**Warm dim theme** (`:root[data-theme="dim"]` in `index.html`): warm dark green
(`bg #1C2422`, `surface #232D2A`, `text #E4EAE6`), lifted accents for AA contrast.
*Not* OLED black. Light values are the source of truth; dim mirrors every key.
Toggle lives in ⚙ Settings alongside reduce-motion / high-contrast / larger-text.

## Typography
- **Headings / wordmark:** `t.serif` = **Newsreader** (warm humanist serif; `opsz` axis loaded — use display optical sizing at large sizes).
- **Body / UI:** `t.sans` = **Atkinson Hyperlegible** (designed by the Braille Institute for legibility — on-brand for this audience).
- Loaded via Google Fonts in `index.html`; `body` defaults to `t.sans`.
- **Scale (target, ~1.2 ratio):** display 32 · h1 26 · h2 21 · body 16 · small 14 · caption 12. Line-height: headings 1.2, body 1.6. *(Some legacy sizes 15/17 remain — collapse toward this scale over time.)*

## Motion (`t.motion`)
- Durations: `fast 120ms` (hover/focus/color) · `base 220ms` (enter/expand) · `slow 420ms` (sheets, the match moment).
- Easings: `standard` (decelerate — calm arrivals) · `exit` · `gentle` (the one signature soft-spring).
- **Rule:** fade + travel ≤8px. Never scale-bounce. Opacity-led.
- **Reduced motion** is globally enforced (an injected `*{…duration:0.001ms!important}` sheet in `App.jsx` + per-component `usePrefersReduced` for keyframe choreography). Always honor it — render the end state, no movement.

## The spectrum-tile motif (`src/SpectrumMark.jsx`, `src/Spectrum.jsx`)
Six discrete rounded tiles stepping green→teal→sand. **Discreteness = predictable/
categorizable = warm for this audience.** It's the brand's connective tissue — one
primitive, many jobs:
- **Logo mark** — header + app icon (+ maskable variant).
- **`<Spectrum variant="progress">`** — onboarding step indicator ("builds the spectrum").
- **`variant="loader"`** — calm 3-tile cross-fade (replaces spinners).
- **`variant="meter"`** — compatibility shown as N-of-6 lit tiles, *never a number* (we don't reduce people to scores).
- **`variant="divider"`** — section rule.

## Avatars (`src/Avatar.jsx`)
Photo when present; otherwise a **deterministic two-tone diagonal gradient** keyed
off `userId` (stable identity) with a serif initial. The monogram is a *first-class*
default, never an error state — dignity for users who don't post photos.

## Components & a11y
- **Buttons** (`src/Button.jsx`): `primary` (solid `accentStrong`) · `secondary` (`green100` fill) · `tertiary` (text). 44px min, focus ring, `motion` transitions.
- **Skeletons** (`src/Skeleton.jsx`): calm shimmer (reduced-motion → static tint). Prefer over spinners.
- **Illustrations** (`src/illustrations.jsx`): soft 1.5px line work, brand palette, no faces, generous negative space. *(Complete the empty-state set against this guide before commissioning.)*
- **WCAG 2.2 AA** throughout: visible focus rings (`2px solid t.focus`, 2px offset), 44px targets, `prefers-reduced-motion`, color never the sole signal, persistent labels (never placeholder-only).

## Conventions / debt to formalize
- Standardize a spacing scale (4px base: 4/8/12/16/24/32/40) and radii (cards 16, sheets 20, pill 999) — currently hand-rolled per component.
- Define a 3-tier elevation system (dim mode expresses elevation via lighter surfaces, not shadow).
- Centralize the duplicated `useFocusable` hook.

---

*Round one gave Spectrum an identity. Round two made the identity do work — the
same six tiles carrying progress, compatibility, and connection, all moving the
same calm way. That repetition-with-meaning is the brand.*
