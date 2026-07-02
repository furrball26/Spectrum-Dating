// Accessibility preference helpers — extracted from SettingsScreen so that App
// (and anything else on the critical path) can read/normalise the saved a11y
// prefs WITHOUT eagerly importing the whole SettingsScreen module. That import
// would otherwise drag SettingsScreen back into the main bundle and defeat its
// lazy split.
//
// Prefs persist in localStorage under `spectrum_a11y` and are applied globally
// by App.jsx.

export const A11Y_KEY = "spectrum_a11y";

// Every selectable theme id. Fail-closed: anything not in this list normalises
// to the dim default (never to a surprise theme). Keep in sync with the theme
// blocks in index.html, the pre-paint bootstrap script there, and the picker
// in SettingsScreen.
export const THEMES = ["dim", "light", "navy", "lightblue", "pink"];

export const DEFAULT_A11Y = {
  reduceMotion: false,
  highContrast: false,
  largerText: false,
  theme: "dim", // 'light' | 'dim' — the warm dim theme is the product default
  plainLanguage: false,   // shorter, more literal copy throughout the app
  reducedSensory: false,  // hide decorative illustrations + flatten header mark
};

// The warm dim theme is the DEFAULT for anyone who hasn't explicitly chosen a
// theme — the calmer first impression for this audience. An explicit saved
// choice always wins (see readA11y); Settings offers Light for those who
// prefer it.
//
// Motion, unlike theme, IS seeded from the OS: `prefers-reduced-motion` users
// get the global reduce-motion sheet without having to find the in-app toggle
// (previously only the toggle activated it — an audit-flagged gap).
function osPrefersReducedMotion() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// The defaults for a first-time visitor.
export function seededDefaults() {
  return { ...DEFAULT_A11Y, reduceMotion: osPrefersReducedMotion() };
}

// Read + normalise the saved prefs. Always returns a full, well-typed object so
// callers never have to guard for missing/garbage values. When nothing is saved
// yet, the theme follows the OS preference (D14) — but any explicitly saved
// theme is honored verbatim and never overridden.
export function readA11y() {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (!raw) return seededDefaults();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return seededDefaults();
    return {
      reduceMotion: !!parsed.reduceMotion,
      highContrast: !!parsed.highContrast,
      largerText: !!parsed.largerText,
      // Explicit saved choice wins; anything else falls back to the dim default.
      theme: THEMES.includes(parsed.theme) ? parsed.theme : "dim",
      plainLanguage: !!parsed.plainLanguage,
      // Low Stimulation absorbed the former "Calm mode" — migrate any legacy calmMode=true.
      reducedSensory: !!(parsed.reducedSensory || parsed.calmMode),
    };
  } catch {
    return seededDefaults();
  }
}
