// Shared design tokens for Spectrum Dating
//
// COLOR tokens reference CSS custom properties (defined for light + dim themes
// in index.html) with the current light hex as the fallback. This lets the app
// switch themes by setting `document.documentElement.dataset.theme = 'dim'`
// without touching any component — inline styles read these values live.
// Font strings (serif/sans) are NOT themed.
export const t = {
  bg: "var(--c-bg, #F4F5F2)",
  bgGradient: "var(--c-bg-gradient, linear-gradient(150deg, #F4F5F2 0%, #ECF0EB 100%))",
  surface: "var(--c-surface, #FFFFFF)",
  surfaceAlt: "var(--c-surfaceAlt, #EEF1ED)",
  text: "var(--c-text, #24332D)",
  textSoft: "var(--c-textSoft, #4E5F58)",
  textMuted: "var(--c-textMuted, #7A8C85)",
  accent: "var(--c-accent, #5B8A82)",
  accentStrong: "var(--c-accentStrong, #3E6660)",
  positive: "var(--c-positive, #5E9459)",
  border: "var(--c-border, #D3DBD5)",
  borderLight: "var(--c-borderLight, #E8EDE7)",
  focus: "var(--c-focus, #24332D)",
  danger: "var(--c-danger, #B94040)",
  warning: "var(--c-warning, #B8860B)",
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  sans: "'Atkinson Hyperlegible', -apple-system, Segoe UI, Roboto, sans-serif",
  // ── Layout ──
  // One width system for the whole app. `maxContent` is the single content
  // column width used by every primary screen (no per-screen jitter). `maxForm`
  // is the intentionally tighter width for narrow forms (auth). `gutter` is the
  // standard horizontal padding.
  layout: { gutter: 20, maxContent: 640, maxForm: 400 },
  // ── Warm accents (spectrum sand/clay end) ──
  sand: "var(--c-sand, #E7D9C4)",
  clay: "var(--c-clay, #C9A875)",
  // ── Teal (spectrum mid) ──
  teal: "var(--c-teal, #4F8A8B)",
  // ── Green ramp 50→900 (brand core) ──
  green50: "var(--c-green50, #EEF3F1)",
  green100: "var(--c-green100, #DCE8E4)",
  green200: "var(--c-green200, #BCD4CC)",
  green300: "var(--c-green300, #9BBFB4)",
  green400: "var(--c-green400, #6FA39A)",
  green500: "var(--c-green500, #5B8A82)",
  green600: "var(--c-green600, #4A7570)",
  green700: "var(--c-green700, #3E6660)",
  green800: "var(--c-green800, #314E49)",
  green900: "var(--c-green900, #24332D)",
  formBorder: "var(--c-formBorder, #8A9E96)",
  bubbleOwn: "var(--c-bubbleOwn, #EEF1ED)",
  bubbleOther: "var(--c-bubbleOther, #FFFFFF)",
  tombstone: "var(--c-tombstone, #7A8C85)",
  // ── Motion language ──
  // Durations + easings for the calm, fade-forward motion system. Adopt as
  // `${t.motion.base} ${t.motion.standard}`. Rule: fade + ≤8px travel, never
  // scale-bounce. All of these are killed by the global reduce-motion sheet
  // (App.jsx) via `transition-duration: 0.001ms !important`, so no per-use gate
  // is required for transitions to be neutralised.
  motion: {
    fast: "120ms",
    base: "220ms",
    slow: "420ms",
    standard: "cubic-bezier(0.2,0,0,1)",
    exit: "cubic-bezier(0.4,0,1,1)",
    gentle: "cubic-bezier(0.33,1,0.68,1)",
  },
};
