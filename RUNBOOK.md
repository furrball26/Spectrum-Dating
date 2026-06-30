# Spectrum Dating — Operations Runbook

Autism-friendly dating platform. This is the operational source of truth:
how to deploy, seed, back up, and activate optional services.

- **Frontend:** Vercel — https://spectrum-dating-eta.vercel.app
- **Backend:** Railway — https://spectrum-dating-server-production.up.railway.app
- **Repos:** `Spectrum-Dating` (frontend, Vite+React), `Spectrum-Dating-Server` (this repo)
- **DB:** SQLite (better-sqlite3) on Railway persistent volume at `/data/spectrum.db`

---

## 1. Deploying

### Backend (Railway)

**Always use the health-gated deploy — never `railway up --detach` by hand.**

```bash
cd Spectrum-Dating-Server
npm run deploy
```

This runs `railway up`, then polls `/health` until it returns `{"status":"ok"}`,
and **exits non-zero if the service does not come up within 4 minutes.** A broken
deploy fails loudly instead of silently crashing behind a detached upload.

> **Why this exists:** earlier in the project, several `--detach` deploys shipped
> onto a backend that was crash-looping at startup (a non-idempotent migration +
> an express-rate-limit v8 validation error). Nobody noticed for hours because the
> uploads "succeeded." `npm run deploy` makes that failure mode impossible.

If it fails:
```bash
railway logs --deployment        # read the startup crash
railway status                   # ● Online / ● Crashed
```

### Frontend (Vercel)

```bash
cd Spectrum-Dating
npm run build                    # must be clean first
npx vercel --prod --yes
```

Production alias: `spectrum-dating-eta.vercel.app`.
Frontend talks to the backend via `VITE_API_URL` (set in Vercel project env).

---

## 2. Environment variables (Railway)

The app runs without any of these — optional features degrade gracefully
(return 503 / no-op) rather than crashing. Set with PowerShell (NOT Git Bash —
it mangles values containing `/`):

```powershell
railway variables set KEY="value"
```

### Core (already set)
| Var | Purpose |
|-----|---------|
| `JWT_SECRET` | Signs auth tokens |
| `DB_PATH` | `/data/spectrum.db` (persistent volume) |
| `ALLOWED_ORIGIN` | CORS origin = the Vercel URL |
| `ADMIN_EMAILS` | Comma-separated list of admin emails (e.g. `ttitleman@gmail.com,mod@x.com`). Grants access to the `/admin/*` moderation endpoints. Case-insensitive; unset = no admins. |

### Photos — Cloudflare R2 (public bucket)
| Var | Notes |
|-----|-------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | e.g. `spectrum-dating-photos` (public access ON) |
| `R2_PUBLIC_URL` | e.g. `https://pub-xxx.r2.dev` |

Bucket needs a CORS rule allowing `PUT`/`GET` from the Vercel origin (see §5).

### Push notifications — VAPID
| Var | Notes |
|-----|-------|
| `VAPID_PUBLIC_KEY` | from `web-push` keygen |
| `VAPID_PRIVATE_KEY` | keep secret |
| `VAPID_CONTACT_EMAIL` | `ttitleman@gmail.com` |

Regenerate keys: `node -e "import('web-push').then(m=>console.log(m.default.generateVAPIDKeys()))"`

### Email verification — Resend
| Var | Notes |
|-----|-------|
| `RESEND_API_KEY` | from resend.com |
| `EMAIL_FROM` | `Spectrum Dating <onboarding@resend.dev>` or a verified domain |
| `APP_URL` | `https://spectrum-dating-eta.vercel.app` (used in verify links) |

### Backups — private R2 bucket (see §4)
| Var | Notes |
|-----|-------|
| `R2_BACKUP_BUCKET` | **Separate, PRIVATE bucket** — never the public photos bucket |

Uses the same `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` creds.

---

## 3. Seeding sample data

24 diverse sample users live in `scripts/seed-users.mjs`.

```bash
npm run seed                          # all 24 (full set)
START=20 npm run seed                 # only indices 20–23 (resume)
START=0 COUNT=10 npm run seed         # first 10 only
```

**Rate-limit note:** registration is capped at **20 requests / 15 min per IP**.
Seeding all 24 at once will create 20 and 429 the last 4 — wait out the window
and run `START=20 npm run seed` to finish. All sample accounts share the
password `SamplePass123!` and use `*.@sample.spectrum-dating.app` emails.

---

## 4. Backups

Daily online SQLite snapshots upload to `R2_BACKUP_BUCKET` under
`backups/YYYY-MM-DD/spectrum-<timestamp>.db`. The snapshot is consistent even
under live writes (better-sqlite3 `.backup()`, WAL-safe). Disabled with a log
line if `R2_BACKUP_BUCKET` is unset.

**Set up:**
1. Create a **private** R2 bucket, e.g. `spectrum-dating-backups` (public access OFF).
2. `railway variables set R2_BACKUP_BUCKET="spectrum-dating-backups"`
3. Add an R2 **lifecycle rule** to expire objects older than ~30 days (retention).
4. Redeploy. Log shows `[backup] enabled — first snapshot in 60s...`

**Restore:**
1. Download the desired `.db` from the backup bucket.
2. Upload it to the Railway volume as `/data/spectrum.db` (stop the service, or
   use a one-off shell), or set `DB_PATH` to the restored file.
3. Redeploy and verify `/health` + a test login.

> Backups are **not** a substitute for testing restores. Do a dry-run restore
> before you ever need a real one.

---

## 5. Cloudflare R2 CORS (photo uploads)

On the **public photos** bucket → Settings → CORS:

```json
[{
  "AllowedOrigins": ["https://spectrum-dating-eta.vercel.app"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["Content-Type"],
  "MaxAgeSeconds": 3600
}]
```

---

## 6. Database migrations

Plain `.sql` files in `src/migrations/`, run in order on every boot by
`src/db.js`. The runner is **idempotent**: `ALTER TABLE ADD COLUMN` re-runs are
caught (`duplicate column name` is ignored) so restarts never crash.

To add a migration: create `NNN_name.sql`, append its filename to the
`MIGRATIONS` array in `src/db.js`. Use `CREATE TABLE IF NOT EXISTS`. For new
columns, a bare `ALTER TABLE ADD COLUMN` is fine — the runner tolerates re-runs.

Current migrations: `001_init` · `002_matching` · `003_messaging` ·
`004_reactions_photos` · `005_profile_photos` · `006_push_subscriptions` ·
`007_token_version` · `008_read_cursors` · `009_email_verification` ·
`010_moderation` · `011_profile_photos_gallery` · `012_date_of_birth` ·
`013_backfill_demo_dob` · `014_dealbreakers` · `015_verification` ·
`016_backfill_demo_verified` · `017_pause` · `018_richer_profile` ·
`019_profile_prompts` · `020_feedback`.

> **Data backfills go in their own file.** The runner skips an entire `.sql` file
> wholesale once its `ALTER` has been applied (the `duplicate column name` catch
> aborts the rest of the file), so a backfill bundled after an `ALTER` would never
> run on subsequent boots. Put `UPDATE`/`INSERT` backfills in a separate numbered
> migration (e.g. `016_backfill_demo_verified` after `015_verification`) and make
> them idempotent (scope + a guard so re-runs are no-ops).

---

## 6b. Profile photos — multi-photo gallery

Users can have up to **6** profile photos, one marked **primary**.

**Schema** — `profile_photos` table (migration `011_profile_photos_gallery`):
`id, user_id (FK → users, ON DELETE CASCADE), storage_key, url, position,
is_primary, created_at`. Indexed on `(user_id, position)`. The migration
**backfills** each user's existing `profiles.photo_url` as a single primary
gallery row (`<userId>-legacy`, empty `storage_key`); the `NOT EXISTS` guard
keeps the `INSERT ... SELECT` idempotent across boots.

**The primary photo mirrors to `profiles.photo_url`** — that column is still
what match cards / candidates display, so legacy read paths are untouched.

**Endpoints** (`src/routes/photos.js`, all `requireAuth`, key format
`profile-photos/<userId>/<id>.<ext>`):
- `POST /photos/profile-upload-url` — body `{ mimeType }` → `{ uploadUrl, key, publicUrl }` (presigned PUT). Unchanged.
- `POST /photos/profile-add` — body `{ key }`. Adds a gallery photo at the next
  position. **409** if already at 6. First photo becomes primary and sets
  `profiles.photo_url`. Returns `{ photos: [...] }`.
- `PUT /photos/profile-photos/:id/primary` — marks that photo primary (others
  off) and mirrors its url to `profiles.photo_url`. **404** if not owned.
  Returns `{ photos: [...] }`.
- `DELETE /photos/profile-photos/:id` — deletes (ownership-checked); best-effort
  R2 `deleteObject` when `storage_key` is non-empty. If the deleted photo was
  primary, promotes the lowest-`position` remaining photo (or clears
  `photo_url` if none remain). Returns `{ photos: [...] }`.
- `POST /photos/profile-confirm` — **backward-compat**: now routes through the
  same add logic (adds the photo, sets primary if first). Returns the legacy
  `{ photoUrl }` plus `{ photos }`.

Photo serialization (ordered by `position`): `{ id, url, isPrimary, position }`.
`GET /profile/me` now includes a `photos` array (plus the existing `photoUrl`).

All endpoints still **503 gracefully** when R2 isn't configured (presign only);
add/primary/delete work regardless — when R2 is unset, `url` falls back to the
raw key.

---

## 6c. Age gate (18+)

Spectrum Dating is **18+ only**. Enforced via a `date_of_birth` column on
`profiles` (migration `012_date_of_birth`: `TEXT NOT NULL DEFAULT ''`).

- **`PUT /profile/me`** accepts `dateOfBirth` (`YYYY-MM-DD`). It must be a real
  calendar date and yield age ≥ 18, else **400**:
  - malformed / impossible date → `{ error: 'Please enter a valid date of birth.' }`
  - under 18 → `{ error: 'You must be 18 or older to use Spectrum Dating.' }`
- **`GET /profile/me`** returns `dateOfBirth` and a computed `age` (or `null`).
- **`onboardingComplete` now requires a valid 18+ `date_of_birth`** (in addition
  to display_name + bio + ≥1 interest). **Existing users with no DOB are sent
  back through onboarding to confirm 18+ — this is intended age-gate behaviour.**
- **Matching** (`GET /matching/candidates`): candidates without a valid 18+ DOB
  are filtered out and never surfaced; each candidate includes an `age` field.
- Age is computed by the shared `ageFromDob(dob)` helper in `src/utils/time.js`
  (handles month/day correctly; returns `null` for missing/invalid dates).

---

## 6d. Lifestyle attributes + deal-breaker filters

Structured lifestyle fields on `profiles` (migration `014_dealbreakers`, all
`NOT NULL DEFAULT ''` / `DEFAULT 0`):

| Column | Type | Allowed values |
|--------|------|----------------|
| `wants_children` | TEXT | `''` · `yes` · `no` · `open` |
| `smoking` | TEXT | `''` · `no` · `sometimes` · `yes` |
| `drinking` | TEXT | `''` · `no` · `sometimes` · `yes` |
| `db_wants_children` | INTEGER (0/1) | viewer deal-breaker flag |
| `db_non_smoker` | INTEGER (0/1) | viewer deal-breaker flag |
| `db_must_be_local` | INTEGER (0/1) | viewer deal-breaker flag |

**`PUT /profile/me`** accepts `wantsChildren`, `smoking`, `drinking` (validated
against the enums above → **400** on invalid) and `dbWantsChildren`,
`dbNonSmoker`, `dbMustBeLocal` (booleans in the request, coerced to 0/1).
**`GET /profile/me`** returns the three strings plus the three flags as
booleans (`!!profile.db_*`).

**Deal-breaker matching** (`src/matching/candidates.js`): a viewer's *active*
deal-breaker flags act as **exclusion filters** on the candidate list, applied
on top of (not replacing) the existing 18+ / onboarding filters.

> **"Unknown passes" — the key semantic.** A deal-breaker only excludes a
> candidate on a **known conflict**. If the candidate hasn't set the relevant
> attribute (empty/unknown), they **pass** the filter. Most profiles haven't
> filled these in yet, so excluding unknowns would empty out Discover.

- `db_must_be_local` (+ viewer `dist_city` set): exclude candidates whose
  `dist_city` is set **and** not equal (case-insensitive, trimmed) to the
  viewer's. Unknown city passes.
- `db_non_smoker`: exclude candidates whose `smoking` is set **and** not `'no'`
  (i.e. `'yes'`/`'sometimes'`). Unknown smoking passes.
- `db_wants_children` (+ viewer `wants_children` set): exclude candidates whose
  `wants_children` is set **and** differs from the viewer's. Unknown passes.

---

## 6e. Identity verification (trust badge)

A profile-level **verification trust signal** so members can see who has been
identity-verified. Backed by `profiles.identity_verified` (migration
`015_verification`: `INTEGER NOT NULL DEFAULT 0`).

**Badge semantics:** `identity_verified = 1` means a human moderator (or, later,
a vendor) has confirmed this person's identity. `0` = not verified (the default
for every account). Verification is **not** the same as email verification
(`users.email_verified`) — that only confirms a working inbox; this confirms a
real person/ID.

**Exposed as `verified` (boolean) everywhere a profile is shown:**
- `GET /profile/me` → `verified: !!profile.identity_verified`.
- `GET /matching/candidates` → each candidate has `verified` (selected in
  `src/matching/candidates.js`).
- `GET /matching/matches` → `otherUser.verified`.
- `GET /messaging/conversations` → `otherUser.verified`.

**Admin manual verification** (`ADMIN_EMAILS`-gated):
- `POST /admin/users/:id/verify` — body `{ verified: boolean }` →
  `UPDATE profiles SET identity_verified = ? WHERE user_id = ?`. **400** if
  `verified` isn't a boolean, **404** if no profile for that user. Returns
  `{ ok: true, verified }`. Lets moderators verify people now.

**Demo backfill** (`016_backfill_demo_verified`): marks ~half the
`*@sample.spectrum-dating.app` accounts verified so the badge is visible in
demos. Idempotent (only flips rows still at 0) and scoped to the sample domain —
never touches real users.

> **Vendor webhook plugs in here later.** A real ID/photo verification vendor
> (e.g. Stripe Identity, Persona, Onfido) integrates by writing this same
> `identity_verified` column from a webhook handler on a successful check — no
> schema or read-path changes needed. The admin endpoint stays as a manual
> override/fallback.

---

## 6f. Pause/snooze · undo-skip · report feedback loop

Three member-facing controls. All `requireAuth`.

**Pause / snooze** — `profiles.paused` (migration `017_pause`:
`INTEGER NOT NULL DEFAULT 0`). A paused user simply **doesn't appear to others**
in Discover; they keep full app access (matches, messaging, profile editing).
- `PUT /profile/me` accepts `paused` (boolean in the request → coerced to 0/1
  via the existing bool field handling).
- `GET /profile/me` (and the `PUT` response) returns `paused: !!profile.paused`.
- `src/matching/candidates.js` selects `p.paused` and filters with `p.paused = 0`
  in the SQL `WHERE` — paused profiles are never surfaced as candidates.

**Undo last skip** — `POST /matching/undo-skip`. Finds the viewer's MOST RECENT
swipe with `decision='skip'` (`ORDER BY created_at DESC LIMIT 1`) and deletes
that row, letting that person resurface in candidates.
- No skip to undo → `{ ok: false }`.
- Otherwise → `{ ok: true, candidateId: <swiped_id> }`.
- **Never touches `'like'` swipes** (the `decision='skip'` filter guarantees it).

**Report feedback loop** — `GET /messaging/my-reports`. Returns the current
user's submitted reports (`reporter_id = me`), newest first, so a reporter can
see their report was reviewed/actioned:
`{ reports: [{ id, reportedName, reason, status, createdAt, resolvedAt }] }`.
`reportedName` is the reported user's `display_name` (LEFT JOIN `profiles`, `''`
if missing). **`moderator_note` is deliberately NOT exposed.**

---

## 6g. Differentiator dimensions (autistic-friendly profile)

The dimensions that make Spectrum Dating distinct for autistic users: structured
**communication style**, **sensory/environment** preferences, and a user-authored
**context card** ("how to talk to me"). All on `profiles` (migration
`018_richer_profile`, all `TEXT NOT NULL DEFAULT ''`). The existing free-text
`comm_note` stays — these are the structured, *matchable* complement.

| Column (camelCase API) | Allowed values |
|------------------------|----------------|
| `comm_directness` (`commDirectness`) | `''` · `direct` · `softened` |
| `comm_literal` (`commLiteral`) | `''` · `literal` · `playful` |
| `comm_cadence` (`commCadence`) | `''` · `instant` · `daily` · `whenever` |
| `sensory_environment` (`sensoryEnvironment`) | `''` · `quiet` · `lively` · `either` |
| `sensory_lighting` (`sensoryLighting`) | `''` · `dim` · `bright` · `either` |
| `social_duration` (`socialDuration`) | `''` · `short` · `medium` · `long` |
| `context_card` (`contextCard`) | free text, **≤ 300 chars** |

**`PUT /profile/me`** accepts all seven. The six enums validate against the lists
above (→ **400** on an invalid value); `contextCard` must be a string ≤ 300 chars
(→ **400** if longer). All added to the string `fieldMap`.
**`GET /profile/me`** (and the `PUT` echo) returns all seven as camelCase.

**Exposed on read paths:** `GET /matching/candidates` (each candidate) and
`GET /matching/matches` (`otherUser`) include all seven. `candidates.js` SELECTs
the columns; `matching.js` maps them.

**Light matching signal** (`src/matching/score.js`) — modest nudges, like the
city/goal bonus; **never excludes**, only re-ranks:
- **+2** if both have the same non-empty `sensory_environment`.
- **+2** if both have the same non-empty `comm_cadence`.
- **`'either'`/empty count as no-bonus** — only exact, non-`'either'` matches
  score. (`comm_cadence` has no `'either'` value; `'whenever'` is a real shared
  preference and does count.)
- Adds a `whyReasons` line on a contributing match (e.g. *"You both prefer quiet
  settings"*, *"You both like to check in about once a day"*).

`candidates.js` passes the viewer's `sensory_environment` + `comm_cadence` into
the scorer (same way it passes goal/city).

---

## 6h. Profile prompts (Hinge-style scaffolding)

Structured prompts: the user picks from a fixed catalog and answers in their own
words. A blank bio is hard — a concrete, literal prompt ("A perfect day for me
looks like…") is far easier, especially for autistic users. Stored in
`profile_prompts` (migration `019_profile_prompts`), one row per answer.

**Catalog** lives in `src/data/prompts.js` — `PROMPTS` is an array of
`{ key, text }` (12 prompts). Keys are **stable**; an answer whose key has been
retired from the catalog is silently skipped when serialized (never crashes).
`PROMPT_KEYS` (a `Set`) is the validation source of truth.

**Endpoints** (mounted under `/profile`):
- `GET /profile/prompt-catalog` — **public** (no auth). Returns
  `{ prompts: PROMPTS }` so the frontend can render the options.
- `PUT /profile/prompts` (auth) — body `{ prompts: [{ promptKey, answer }] }`.
  Validation (→ **400** on any failure): **max 3** entries; each `promptKey` ∈
  catalog; each `answer` a non-empty string **≤ 200 chars**. Replaces the user's
  whole set in a transaction (DELETE all, INSERT at positions `0..n`). Returns
  `{ prompts: [...] }`.

**Serialized shape** (helper `listPrompts(db, userId)` in `routes/profile.js`):
`{ promptKey, promptText, answer }`, ordered by `position`; `promptText` is
looked up from the catalog by key.

**Exposed on read paths:** `GET /profile/me` includes `prompts` for the current
user; `GET /matching/candidates` includes `prompts` per candidate; and
`GET /matching/matches` includes `prompts` on `otherUser`. (The candidate/match
paths issue one small extra query per person via `listPrompts` — fine at current
scale.)

---

## 6i. User feedback ("tell us what felt wrong")

An always-on feedback channel so members can tell us what felt wrong, with no
pressure. Stored in `feedback` (migration `020_feedback`):
`id, user_id (FK → users, ON DELETE SET NULL), message, created_at`, indexed on
`created_at`. **`user_id` is `SET NULL` on delete** — feedback survives account
deletion (the message is still useful) but is de-identified.

- `POST /feedback` (`requireAuth`) — body `{ message }`. `message` must be a
  non-empty string **≤ 2000 chars** (→ **400** otherwise). Inserts with the
  caller's `userId`, a fresh `newId()`, and `Date.now()`. Returns `{ ok: true }`.
- `GET /admin/feedback` (`requireAuth` + `requireAdmin`) — returns
  `{ feedback: [{ id, userEmail, message, createdAt }] }`, **newest first**.
  `userEmail` comes from a LEFT JOIN on `users` and is **null** when the
  submitter's account has since been deleted.

---

## 6j. Calm-notification policy

Spectrum Dating's brand is **no pressure**. All push/notification copy must be
**calm, emoji-free, and free of urgency/FOMO** — no "X is waiting", countdowns,
"reply now", exclamation-driven hype, or emoji. Plain and reassuring only.

Current notification copy (source of truth):
- **New match** (`src/routes/matching.js`): title `'New match'`, body
  *"You and someone both said yes. There's no rush to say hello."*
- **New message** (`src/routes/messaging.js`) — **tier-aware** off
  `profiles.notification_tier`, copy kept plain at every tier:
  - `in_app` → title `'New message'`, body `'You have a new message.'`
  - `name_only` → title = sender display name (or `'Someone'`), body
    `'Sent you a message.'`
  - `silent_push` → title `'Spectrum Dating'`, empty body.
  - `none` (or anything else) → no push sent.

> **Email verification copy is exempt** — "This link expires in 24 hours" is a
> factual security detail, not urgency marketing, and stays. Reaction emoji
> (`src/routes/reactions.js`) are user-chosen content, not notification copy.

---

## 6a. Moderation (trust & safety)

A dedicated `reports` table (migration `010_moderation`) feeds moderator review,
separate from the `blocks` table — a user can **report without blocking** and
vice versa. Admin access is gated on `ADMIN_EMAILS` (see §2).

**Reporting (any authenticated user):**
- `POST /messaging/report` — body `{ reportedUserId, reason, details?, conversationId? }`.
  `reason` required (≤100 chars), `details` optional (≤1000). Inserts a report
  with status `open`. Cannot report yourself.

**Admin endpoints** (all require `ADMIN_EMAILS` membership):
- `GET  /admin/me` — auth-only; returns `{ isAdmin }` so the frontend can show/hide admin UI.
- `GET  /admin/reports?status=open` — list reports (joined with reporter/reported
  email + display name). `status=all` returns everything; default `open`. Newest first.
- `GET  /admin/reports/:id` — single report with full reporter/reported profile context.
- `POST /admin/reports/:id/resolve` — body `{ status, note }`; `status` ∈ `reviewed|actioned|dismissed`.
  Stamps `moderator_note` and `resolved_at`.
- `POST /admin/users/:id/suspend` — body `{ suspended: boolean }`.
- `GET  /admin/stats` — platform counts (users, suspended, matches, conversations,
  messages) + reports grouped by status.

**Suspend flow:** suspending a user sets `users.suspended = 1` **and** bumps
`token_version`, which immediately invalidates all their existing JWTs (next
request → 401). Suspended users also cannot log in (login returns
`403 "This account has been suspended. Contact support."` before any token is
issued). Unsuspending (`{ suspended: false }`) clears the flag; the user can log
in again. `isAdmin` is surfaced on the login response and `GET /profile/me` so
the frontend can render admin UI after a reload.

---

## 7. Known limitations / open items

- **Auth login rate limiter on Railway:** keys on client IP via `X-Real-IP` /
  `X-Forwarded-For`. Behind Railway's proxy this is now functional, but if IP
  forwarding regresses, the limiter weakens. The *message* limiter keys on
  `userId` and is unaffected.
- **Email verification is non-blocking** by design — unverified users can still
  use the app; the status is shown as a dismissible banner.
- **Photos/push/email are inert** until their env vars are set (graceful).
- **Moderation backend is live** (see §6a) — `ADMIN_EMAILS`-gated `/admin/*`
  endpoints + report submission + suspension. A moderator **dashboard UI** on the
  frontend is still to be built.

---

## 8. Quick health checks

```bash
curl -s https://spectrum-dating-server-production.up.railway.app/health
# {"status":"ok"}

railway status            # ● Online, replicas 1/1
railway logs --deployment # tail recent logs
```
