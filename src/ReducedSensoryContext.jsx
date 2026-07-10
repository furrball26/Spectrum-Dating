// Reduced-sensory context — a single global source of truth for the a11y
// "Low stimulation" preference (a11y.reducedSensory). Mirrors
// PlainLanguageContext: before this existed the boolean was hand-threaded as a
// prop to only a handful of screens (SuggestionScreen, LikesScreen,
// MessagingApp, BestFits), so most of the app — notably the error/empty-state
// illustrations — ignored the toggle and always drew decorative art. Any
// component can now read the current value via useReducedSensory() without
// prop-drilling, so a new surface can never again drop the preference.
//
// App.jsx wraps the tree in <ReducedSensoryProvider value={!!a11y.reducedSensory}>
// and re-renders on every prefs change, so consumers stay in sync. Existing
// prop-based reads keep working — this only ADDS global coverage for the
// previously ungated decorative illustrations.

import { createContext, useContext } from "react";

// Default false so a consumer rendered outside a provider (e.g. an isolated
// unit test or a stray mount) draws the standard, decorated state rather than
// crash or silently hide art everywhere.
const ReducedSensoryContext = createContext(false);

export function ReducedSensoryProvider({ value, children }) {
  return (
    <ReducedSensoryContext.Provider value={!!value}>
      {children}
    </ReducedSensoryContext.Provider>
  );
}

// Returns the current reduced-sensory boolean. Components that already accept a
// `reducedSensory` prop can pass it through as the optional `override` argument
// so an explicit prop still wins over the context (keeps the legacy screens
// behaving exactly as before while everything else reads the global value).
export function useReducedSensory(override) {
  const ctx = useContext(ReducedSensoryContext);
  return override === undefined ? ctx : !!override;
}

export default ReducedSensoryContext;
