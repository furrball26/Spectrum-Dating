// Plain-language context — a single global source of truth for the a11y
// "Plain language" preference (a11y.plainLanguage). Before this existed the
// boolean was hand-threaded as a prop to only a handful of screens, so most of
// the app silently ignored the toggle. Any component can now read the current
// value via usePlainLanguage() without prop-drilling, so a new surface can
// never again drop the preference by forgetting to pass a prop.
//
// App.jsx wraps the tree in <PlainLanguageProvider value={!!a11y.plainLanguage}>
// and re-renders on every prefs change, so consumers stay in sync. Existing
// prop-based reads (SuggestionScreen, LikesScreen, MessagingApp, BestFits) keep
// working — the prop wins when explicitly passed; otherwise the hook falls back
// to the context (see usePlainLanguage).

import { createContext, useContext } from "react";

// Default false so a consumer rendered outside a provider (e.g. an isolated
// unit test or a stray mount) reads the calm, standard copy rather than crash.
const PlainLanguageContext = createContext(false);

export function PlainLanguageProvider({ value, children }) {
  return (
    <PlainLanguageContext.Provider value={!!value}>
      {children}
    </PlainLanguageContext.Provider>
  );
}

// Returns the current plain-language boolean. Components that already accept a
// `plainLanguage` prop can pass it through as the optional `override` argument
// so an explicit prop still wins over the context (keeps the legacy screens
// behaving exactly as before while everything else reads the global value).
export function usePlainLanguage(override) {
  const ctx = useContext(PlainLanguageContext);
  return override === undefined ? ctx : !!override;
}

export default PlainLanguageContext;
