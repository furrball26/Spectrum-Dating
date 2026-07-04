// Traveler / at-risk region alert — pure gating helper (frontend-only).
//
// The banner (App.jsx) warns a member who appears to be somewhere LGBTQ+ people
// can face legal risk and offers to hide their profile. It must be CALM: shown
// at most ONCE per browser session so it never nags. This module holds the
// pure decision so it can be unit-tested without the DOM.

// sessionStorage key set when the member dismisses or acts on the banner. Session
// scope (not localStorage) is deliberate: a member who moves in/out of a region
// across days should be re-informed, but never nagged within a single session.
export const REGION_ALERT_SESSION_KEY = "spectrum:regionAlertSeen";

// Show the banner iff the backend flagged the member as at-risk AND they have
// not already seen/dismissed it this session. `seenThisSession` is the
// sessionStorage flag (a truthy string once set). Strict `=== true` so a missing
// or malformed backend field never trips the alert.
export function shouldShowRegionAlert(atRisk, seenThisSession) {
  return atRisk === true && !seenThisSession;
}
