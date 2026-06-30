# Spectrum Dating — Status Log

Rolling log of notable changes, newest first, grouped by role.

---

## Backend Dev

### 2026-06-29 — Pause/snooze · undo-skip · report feedback loop
- **Migration `017_pause`**: `profiles.paused INTEGER NOT NULL DEFAULT 0`.
  Registered in `src/db.js` (bare `ALTER TABLE ADD COLUMN`, runner tolerates
  re-runs). A paused user is **hidden from others' Discover** but keeps full app
  access (matches, messaging, profile editing).
- **Pause** (`src/routes/profile.js`): `PUT /profile/me` accepts `paused`
  (boolean → 0/1, handled via the existing `boolFieldMap`); `GET /profile/me` and
  the `PUT` echo return `paused: !!profile.paused`. `src/matching/candidates.js`
  selects `p.paused` and filters `AND p.paused = 0` in SQL — paused profiles never
  surface as candidates.
- **Undo last skip** (`src/routes/matching.js`): `POST /matching/undo-skip`
  (`requireAuth`) finds the viewer's most recent `decision='skip'` swipe
  (`ORDER BY created_at DESC LIMIT 1`) and deletes it → `{ ok: true,
  candidateId }`, resurfacing that person. No skip → `{ ok: false }`. Never
  touches `'like'` swipes.
- **Report feedback loop** (`src/routes/messaging.js`): `GET /messaging/my-reports`
  (`requireAuth`) returns the user's own reports (`reporter_id = me`), newest
  first, as `{ reports: [{ id, reportedName, reason, status, createdAt,
  resolvedAt }] }` — `reportedName` via LEFT JOIN `profiles`. **`moderator_note`
  deliberately NOT exposed.** Lets a reporter see their report was reviewed/actioned.
- Deployed via `npm run deploy` (health-gated, SHA `65ab8ae`). Verified in
  production: `/health` 200 with new SHA; `PUT {paused:true}` then `GET` shows
  `paused:true` (and toggles back to `false`); `undo-skip` returns `{ok:false}`
  with no prior skip, and on a real skip returns `{ok:true, candidateId:<skipped>}`
  then `{ok:false}` on the second call; `GET /messaging/my-reports` returns
  `{reports:[]}`.
- Updated `RUNBOOK.md` (new §6f, migrations list).

### 2026-06-29 — Identity verification trust signal (badge)
- **Migration `015_verification`**: `profiles.identity_verified INTEGER NOT NULL
  DEFAULT 0`. **Migration `016_backfill_demo_verified`** (separate file — data
  backfill, since the runner skips an `ALTER` file wholesale on re-run): marks
  ~half the `*@sample.spectrum-dating.app` accounts verified for demos
  (idempotent — only flips rows at 0, scoped to sample domain). Both registered
  in `src/db.js` (015 then 016).
- **Exposed `verified` (`!!identity_verified`) on every profile read path**:
  `GET /profile/me`; `GET /matching/candidates` (selected in
  `src/matching/candidates.js`); `GET /matching/matches` `otherUser` (added
  `identity_verified` to the per-match profile SELECT); `GET /messaging/
  conversations` `otherUser` (added it to the per-conversation profile SELECT).
- **Admin manual verification**: `POST /admin/users/:id/verify` (`requireAuth` +
  `requireAdmin`), body `{ verified: boolean }` → `UPDATE profiles SET
  identity_verified = ? WHERE user_id = ?`. **400** non-boolean, **404** no
  profile (via `result.changes === 0`), returns `{ ok: true, verified }`. Same
  column a real ID/photo **vendor webhook** can write later.
- Deployed via `npm run deploy` (health-gated). Verified `/health` 200; a sample
  user's `GET /profile/me` includes `verified` (true for some, false for others
  after backfill); `POST /admin/users/:id/verify {verified:true}` flips it, and
  the route returns 401 unauthenticated.
- Updated `RUNBOOK.md` (new §6e, migrations list + data-backfill note).

### 2026-06-29 — Lifestyle attributes + hard deal-breaker filters
- **Migration `014_dealbreakers`**: six new `profiles` columns — `wants_children`,
  `smoking`, `drinking` (`TEXT NOT NULL DEFAULT ''`) and `db_wants_children`,
  `db_non_smoker`, `db_must_be_local` (`INTEGER NOT NULL DEFAULT 0` deal-breaker
  flags). Registered in `src/db.js` (bare `ALTER TABLE ADD COLUMN`, runner
  tolerates re-runs).
- **`PUT /profile/me`** (`src/routes/profile.js`): accepts the three strings
  (validated — `wantsChildren` ∈ `''|yes|no|open`, `smoking`/`drinking` ∈
  `''|no|sometimes|yes`, else **400**) and the three `db*` booleans (coerced to
  0/1). Strings added to `fieldMap`; flags handled via a separate `boolFieldMap`.
- **`GET /profile/me`** (and the `PUT` echo): returns `wantsChildren`, `smoking`,
  `drinking` (strings) + `dbWantsChildren`, `dbNonSmoker`, `dbMustBeLocal`
  (booleans via `!!profile.db_*`).
- **Matching** (`src/matching/candidates.js`): selects the new columns for viewer
  + candidates and applies the viewer's active deal-breakers as **exclusion**
  filters. **"Unknown passes"** — only excludes on a KNOWN conflict (set, mismatched);
  empty/unknown candidate values pass so Discover doesn't empty out. Local
  (city, case/trim-insensitive), non-smoker (smoking set & ≠ `no`), wants-children
  (set & ≠ viewer's). 18+ / onboarding filters left intact.
- Verified filter logic locally (known-match + unknown pass; smoker/diff-city/
  diff-kids/sometimes excluded; case+trim city match) on an in-memory DB, then
  deployed via `npm run deploy` (health-gated, SHA 0de6f30). Confirmed `/health`
  200 with new SHA; valid `{wantsChildren:'yes', smoking:'no', dbNonSmoker:true}`
  persists + `GET` echoes; invalid enum (`smoking:'occasionally'`,
  `wantsChildren:'maybe'`) → 400.
- Updated `RUNBOOK.md` (new §6d, migrations list).

### 2026-06-29 — 18+ age gate (date of birth)
- **Migration `012_date_of_birth`**: `profiles.date_of_birth TEXT NOT NULL
  DEFAULT ''`. Registered in `src/db.js` (bare `ALTER TABLE ADD COLUMN`, runner
  tolerates re-runs).
- **Shared helper `ageFromDob(dob)`** in `src/utils/time.js`: parses `YYYY-MM-DD`,
  rejects impossible calendar dates (e.g. `2020-02-30`), returns integer years
  with correct month/day handling, or `null` for missing/invalid input.
- **`PUT /profile/me`** (`src/routes/profile.js`): accepts `dateOfBirth` (added to
  fieldMap → persists). Validates format `^\d{4}-\d{2}-\d{2}$` + real date + age.
  400 `Please enter a valid date of birth.` (malformed) / `You must be 18 or older
  to use Spectrum Dating.` (age < 18).
- **`GET /profile/me`**: returns `dateOfBirth` + computed `age`. `onboardingComplete`
  now ALSO requires a valid 18+ DOB — existing users without a DOB are intentionally
  routed back through onboarding to confirm 18+.
- **Matching**: `src/matching/candidates.js` selects `date_of_birth` and post-filters
  to age ≥ 18 (no/invalid DOB never surfaced). `src/routes/matching.js` adds `age`
  to each candidate. Both reuse the shared `ageFromDob` helper.
- Verified helper logic locally (birthday boundaries, impossible dates → null), then
  deployed via `npm run deploy` (health-gated). Confirmed `/health` 200; underage DOB
  (`2015-01-01`) → 400 with the 18+ message; valid adult DOB persists + returns `age`.

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
