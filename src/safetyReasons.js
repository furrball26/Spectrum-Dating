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
  { value: "other", label: "Something else" },
];
