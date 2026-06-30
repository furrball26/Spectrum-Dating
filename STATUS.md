# Status

## Frontend Dev

### 2026-06-29 — Admin moderation dashboard + report wiring
- Added moderation/admin API helpers to `src/api.js` (`getAdminMe`, `getAdminReports`, `resolveReport`, `suspendUser`, `getAdminStats`, `reportUser`).
- New `src/AdminScreen.jsx`: self-contained moderation dashboard — stats row, status-filter segmented control (Open / Reviewed / Actioned / Dismissed / All), report cards with resolve (Reviewed/Actioned/Dismissed + optional note) and inline-confirmed suspend/unsuspend. Loading + empty states, WCAG 2.2 AA focus rings, 44px targets, live regions.
- `src/App.jsx`: captures `isAdmin` from login response and `getProfile()` (persists across reload), resets it on sign-out / expiry / account deletion. Discreet "⚙ Moderation" nav tab rendered only for admins; non-admins never see it.
- Report wiring: messaging `BlockReportScreen` submit now also calls `reportUser(..., conversationId)` alongside the existing block; pre-match `ReportModal` in `SuggestionScreen.jsx` now calls `reportUser` (plus block so the candidate is hidden).
- `npm run build` clean.

~Frontend Dev
