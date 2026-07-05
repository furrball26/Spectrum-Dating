// Unified safety-reason taxonomy shared across every report/block surface
// (the in-chat BlockReportScreen and the pre-match ReportModal) so both offer
// the same, consistent options.
//
// These `value`s are what get sent to the backend:
//   • POST /messaging/report — free-text reason, accepts any of these.
//   • POST /messaging/block  — only accepts harassment | spam | fake_profile |
//     other. `canonicalBlockReason` in api.js maps anything else (e.g.
//     "inappropriate") to a valid block reason, so block always lands.
export const SAFETY_REASONS = [
  { value: "harassment", label: "Harassment or abuse" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "spam", label: "Spam" },
  { value: "fake_profile", label: "Fake or suspicious profile" },
  // Severe safety concern (Community Standard §4.5/§4.6 — a minor, a threat, or
  // something illegal). Placed just before "Something else": present and easy to
  // reach, but not alarmingly first. The backend maps this to §4.5 (immediate
  // removal + legal referral).
  { value: "minor_safety", label: "A safety concern (a minor, a threat, or something illegal)" },
  { value: "other", label: "Something else" },
];
