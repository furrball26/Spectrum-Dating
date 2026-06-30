# Status

## Frontend Dev

### 2026-06-29 — Profile photo gallery (up to 6, choose main)
- Added photo API helpers to `src/api.js` (`addProfilePhoto`, `setPrimaryPhoto`, `deleteProfilePhoto`), each returning the server's ordered `photos` array.
- Replaced the single-avatar `PhotoUpload` in `src/ProfileScreen.jsx` with a responsive `PhotoGallery` (3-col grid, up to 6 cells). Each photo: square cover image, "Main" badge on the primary, "Set as main" on non-primary, inline-confirmed "Remove" (danger outline). One "+ Add photo" tile when under 6; helper text + empty state. Friendly 503 handling ("Photo uploads aren't available right now").
- `photos` state populated from `GET /profile/me` (`data.photos`); old `photoUrl` state and `PhotoUpload` component removed. All hooks declared before the loading/error early returns.
- `npm run build` clean.

### 2026-06-29 — Admin moderation dashboard + report wiring
- Added moderation/admin API helpers to `src/api.js` (`getAdminMe`, `getAdminReports`, `resolveReport`, `suspendUser`, `getAdminStats`, `reportUser`).
- New `src/AdminScreen.jsx`: self-contained moderation dashboard — stats row, status-filter segmented control (Open / Reviewed / Actioned / Dismissed / All), report cards with resolve (Reviewed/Actioned/Dismissed + optional note) and inline-confirmed suspend/unsuspend. Loading + empty states, WCAG 2.2 AA focus rings, 44px targets, live regions.
- `src/App.jsx`: captures `isAdmin` from login response and `getProfile()` (persists across reload), resets it on sign-out / expiry / account deletion. Discreet "⚙ Moderation" nav tab rendered only for admins; non-admins never see it.
- Report wiring: messaging `BlockReportScreen` submit now also calls `reportUser(..., conversationId)` alongside the existing block; pre-match `ReportModal` in `SuggestionScreen.jsx` now calls `reportUser` (plus block so the candidate is hidden).
- `npm run build` clean.

~Frontend Dev
