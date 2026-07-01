// Accessibility preference helpers — extracted from SettingsScreen so that App
// (and anything else on the critical path) can read/normalise the saved a11y
// prefs WITHOUT eagerly importing the whole SettingsScreen module. That import
// would otherwise drag SettingsScreen back into the main bundle and defeat its
// lazy split.
//
// Prefs persist in localStorage under `spectrum_a11y` and are applied globally
// by App.jsx.

export const A11Y_KEY = "spectrum_a11y";

export const DEFAULT_A11Y = {
  reduceMotion: false,
  highContrast: false,
  largerText: false,
  theme: "light", // 'light' | 'dim'
  plainLanguage: false,   // shorter, more literal copy throughout the app
  reducedSensory: false,  // hide decorative illustrations + flatten header mark
};

// D14 — when the visitor has never set a preference (e.g. logged-out Landing /
// Auth), seed the initial theme from the OS `prefers-color-scheme: dark` query
// so dim-preferring users get a calm first impression instead of a bright one.
// An explicit saved choice always wins over this (see readA11y below).
function osPrefersDim() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// The defaults for a first-time visitor, with the theme seeded from the OS.
export function seededDefaults() {
  return { ...DEFAULT_A11Y, theme: osPrefersDim() ? "dim" : "light" };
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
      // Explicit saved choice wins; if the stored blob predates the theme field,
      // fall back to the OS preference rather than forcing light.
      theme: parsed.theme === "dim" ? "dim" : parsed.theme === "light" ? "light" : (osPrefersDim() ? "dim" : "light"),
      plainLanguage: !!parsed.plainLanguage,
      // Low Stimulation absorbed the former "Calm mode" — migrate any legacy calmMode=true.
      reducedSensory: !!(parsed.reducedSensory || parsed.calmMode),
    };
  } catch {
    return seededDefaults();
  }
}
