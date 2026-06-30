# Spectrum Dating — Status Log

Rolling log of notable changes, newest first, grouped by role.

---

## Backend Dev

### 2026-06-29 — Trust & safety / moderation layer
- **Migration `010_moderation`**: new `reports` table (open/reviewed/actioned/dismissed
  lifecycle, moderator note, resolved_at) separate from `blocks`; added
  `users.suspended` column. Registered in `src/db.js`.
- **Admin gating** (`src/middleware/admin.js`): `ADMIN_EMAILS`-based `isAdminEmail()`
  + `requireAdmin` middleware (runs after `requireAuth`).
- **Admin routes** (`src/routes/admin.js`, mounted at `/admin`): `GET /me`,
  `GET /reports`, `GET /reports/:id`, `POST /reports/:id/resolve`,
  `POST /users/:id/suspend`, `GET /stats`.
- **Report submission**: `POST /messaging/report` (any authed user) — validated,
  separate from `/block`.
- **Suspension enforcement**: login returns 403 for suspended accounts; auth
  middleware rejects suspended users (force-logout). Suspending bumps
  `token_version` to invalidate live tokens immediately.
- **isAdmin** surfaced on the login response and `GET /profile/me` for the frontend.
- Updated `RUNBOOK.md` (§2 `ADMIN_EMAILS` row, new §6a Moderation section,
  migrations list, open-items).
- Verified end-to-end locally (report → list → detail → resolve → suspend →
  force-logout → login-blocked → unsuspend) and confirmed migration idempotency
  on restart. Deployed via `npm run deploy` (health-gated).
