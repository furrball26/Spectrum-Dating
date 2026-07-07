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

// sessionStorage key for the separate "trans home-region" banner. Kept distinct
// from REGION_ALERT_SESSION_KEY so dismissing one never suppresses the other —
// they warn about different things (acute travel/legal danger vs. the member's
// stated HOME state having anti-trans law). Same session scope + calm intent.
export const TRANS_ALERT_SESSION_KEY = "spectrum:transAlertSeen";

// Show the trans-home-region banner iff the backend flagged the member as
// trans-at-risk AND they have not already seen/dismissed it this session. Strict
// `=== true` mirrors shouldShowRegionAlert so a missing/malformed field never
// trips the alert. (Priority — showing at most one banner at a time — is decided
// by the caller, not here.)
export function shouldShowTransAlert(transAtRisk, seenThisSession) {
  return transAtRisk === true && !seenThisSession;
}
