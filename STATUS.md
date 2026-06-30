# Spectrum Dating — Status Log

Rolling log of notable changes, newest first, grouped by role.

---

## Backend Dev

### 2026-06-29 — Multi-photo profiles (gallery, max 6)
- **Migration `011_profile_photos_gallery`**: new `profile_photos` table
  (`id, user_id` FK CASCADE`, storage_key, url, position, is_primary, created_at`),
  indexed on `(user_id, position)`. Idempotent backfill turns each existing
  `profiles.photo_url` into the user's primary gallery row. Registered in `src/db.js`.
- **New endpoints** (`src/routes/photos.js`, all `requireAuth`): `POST /photos/profile-add`
  (max 6 → 409), `PUT /photos/profile-photos/:id/primary`, `DELETE /photos/profile-photos/:id`
  (best-effort R2 delete + promotes lowest-position survivor to primary). Shared
  `addGalleryPhoto` helper; `MAX_PHOTOS = 6`.
- **Primary mirrors to `profiles.photo_url`** so match cards / candidates (which read
  that column) are unaffected.
- **Backward compat**: `POST /photos/profile-confirm` now routes through the same add
  logic and still returns `{ photoUrl }` (plus `photos`); frontend `confirmProfilePhoto`
  keeps working.
- **`GET /profile/me`** now returns a `photos` array (`{ id, url, isPrimary, position }`)
  alongside `photoUrl` (via exported `listPhotos`).
- R2-graceful preserved (presign 503s when unconfigured; url falls back to raw key).
- Verified migration + add/max/primary/delete logic locally (in-memory DB), then
  deployed via `npm run deploy` (health-gated, SHA 35a7a3c). Confirmed `/health` 200
  and `/profile/me` returns a `photos` array in production.

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
