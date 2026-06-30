# Backend & Security Audit — Spectrum Dating Server

Scope: `C:\Users\Pen\Desktop\Spectrum-Dating-Server\src` (routes, middleware, db.js + migrations 001–029, matching, socket, utils, storage).
Method: full source review + read-only probes against `https://spectrum-dating-server-production.up.railway.app`.
Live build SHA at audit time: `75430624ffbc8d317cbf0c3948ab62ac445583c2`.

Overall the backend is in noticeably good shape: parameterized queries everywhere, fail-fast `JWT_SECRET`, bcrypt rounds 12, token_version revocation, constant-time login, generic error responses (verified no stack leak on prod), per-user rate limiting, and the match-gated `GET /profile/:userId` genuinely gates. Findings below are mostly hardening plus a few half-wired/correctness issues.

---

## Security

### [FEATURE] 🔴 — Message photo-attachment flow is half-wired; "scan" is a no-op and attachments never link to a message
- where: `routes/photos.js:188-242` (`/upload-intent`, `/confirm/:attachmentId`), `migrations/004_reactions_photos.sql:14-24`; `messaging.js` (no attachment handling anywhere)
- risk: `POST /photos/confirm/:attachmentId` flips `upload_status` from `pending` → `scanned` with **no actual content scan** (no AV/NSFW/CSAM check exists anywhere in the repo — grep for scan/clamav/nsfw/moderate finds nothing). The column name and `scanned_at` imply safety that does not exist. Worse, `message_attachments.message_id` is **never set by any code path** — there is no endpoint that associates an attachment with a message, so the whole feature is dead/orphaned: users can presign + upload arbitrary image bytes to R2 (publicly served via `getPublicUrl`) and obtain a permanent public URL via `GET /photos/:attachmentId/url`, but it can never appear in a conversation. Net effect: an unmoderated public image host bolted to authenticated accounts, with zero delivery.
- fix: Either (a) finish the flow — add a message-send path that sets `message_id`, gate `GET /:attachmentId/url` strictly, and integrate a real scan before flipping to `approved`; or (b) if attachments are out of scope for launch, remove `/upload-intent`, `/confirm`, `/:attachmentId/url` so there is no unauthenticated-content surface. Do not name a status `scanned` until something scans.

### [ERROR] 🟠 — `POST /messaging/block` allows self-block and trusts `blockedUserId` existence to the DB layer
- where: `routes/messaging.js:402-430`
- risk: No check that `blockedUserId !== userId` (a user can block themselves, polluting `isBlocked` checks and the blocked list) and no existence check on `blockedUserId`. A non-existent id is caught only by the FK, which throws and bubbles to the central handler as a generic **500** (wrong status; also burns the abuse limiter). Compare with `/report` (lines 474-482), which correctly rejects self-target and verifies the user exists with a 404.
- fix: Mirror `/report`: reject `blockedUserId === userId` with 400, and `SELECT 1 FROM users WHERE id = ?` → 404 before inserting. Return 400/404 rather than letting the FK throw a 500.

### [ERROR] 🟠 — Account deletion cascades destroy moderation evidence (reports filed BY the deleted user)
- where: `routes/account.js:64-90`; `migrations/010_moderation.sql:4-5` (`reporter_id ... ON DELETE CASCADE`)
- risk: `DELETE /account/me` removes the user; `reports.reporter_id` is `ON DELETE CASCADE`, so every report the user filed is silently deleted. A harasser who was *reported* can also be the *reporter* on other open cases; more importantly an abuser can self-delete to wipe their own outbound report trail, and reports *against* a deleted abuser also vanish (`reported_id` cascades too). Moderators lose history. The handler also does not delete `verification_requests`, `feedback` (SET NULL — fine), `reports`, `moderation_log`, `message_attachments`, `email_verifications`, `profile_photos`, `profile_prompts` explicitly — it relies entirely on cascade, which is correct for most but means evidence loss is by-design rather than considered.
- fix: For `reports`, change `reporter_id`/`reported_id` to `ON DELETE SET NULL` (keep the row for audit) and retain `reason/details`. Consider soft-deletion of users involved in open reports, or snapshot report context into `moderation_log` before deletion.

### [ERROR] 🟡 — Email enumeration via `change-email` / `register` distinct from the (good) login defense
- where: `routes/account.js:49-50` (409 "That email is already in use"), `routes/auth.js:48-50` (409 on register)
- risk: Login is correctly non-enumerable (constant-time dummy hash + generic 401) and forgot-password always returns 200. But `register` and `change-email` return a distinct 409 when an email exists, so an attacker can enumerate which emails have accounts. For a dating app this is a privacy leak (confirms someone uses the service).
- fix: This is a known trade-off (registration UX usually wins). At minimum keep `register`/`change-email` behind the existing IP `authLimiter` (register already is; `change-email` is **not** rate-limited at all — add a limiter) so enumeration is slow.

### [ERROR] 🟡 — `change-email` and `change-password` have no rate limiting
- where: `routes/account.js:13` (`/change-password`), `:35` (`/change-email`) — only `requireAuth`, no limiter
- risk: `/change-password` calls `bcrypt.compare` on `currentPassword`; an attacker with a stolen 30-day token (but not the password) can brute-force the current password here with no throttle, and a successful guess is a stepping stone to email takeover. Also enables CPU exhaustion via repeated bcrypt.
- fix: Apply `authLimiter` (or a per-user limiter) to both routes.

### [ERROR] 🟡 — CORS reflects a single origin but `ALLOWED_ORIGIN` default is dev; verify prod value is set
- where: `index.js:60`, `socket/index.js:4-9`
- risk: If `ALLOWED_ORIGIN` is unset in prod, CORS falls back to `http://localhost:5173`, which would break the frontend (fail-closed, so not exploitable) — but it is worth confirming it is set. `credentials` is not enabled (token-based auth, no cookies) which is correct. No wildcard, good.
- fix: Treat unset `ALLOWED_ORIGIN` in production as a fatal boot error like `JWT_SECRET`, so a misconfig is loud rather than a silent localhost lockout. Optionally support a comma-separated allowlist.

### [ERROR] 🟡 — `helmet` CSP disabled and HSTS relies on defaults
- where: `index.js:56-59`
- risk: CSP is off ("JSON API" — reasonable), but several R2 public URLs and `placehold.co` fallbacks (`photos.js:271`) are served to the SPA from another origin; ensure the *frontend* sets CSP. `crossOriginResourcePolicy: cross-origin` is required and fine here. Minor: confirm HSTS `includeSubDomains`/`preload` posture is intentional.
- fix: Hardening only — document that CSP is the frontend's responsibility; no server change strictly required.

### [ERROR] ⚪ — `optionalAuth` runs on every request including `/auth/login` and `/auth/register`
- where: `index.js:62` mounts `optionalAuth` globally before routers
- risk: Negligible — it just no-ops on a bad/absent token. Noted only because it does a DB read (`checkTokenVersion`) on every authenticated request *and* the route's own `requireAuth` does the same check again (double DB hit per request). Pure efficiency, not security.
- fix: Optional: have `requireAuth` reuse `req.user` set by `optionalAuth` instead of re-verifying.

---

## Correctness / Robustness

### [ERROR] 🟠 — Messaging is NOT gated on an existing match (only on block status)
- where: `routes/messaging.js:259-331` (`POST .../messages`), `messaging.js:219-253` (conversation create requires a match, but…)
- risk: A conversation is created from a match, but **unmatching** (`DELETE /matching/matches/:id`, matching.js:235-249) deletes the conversation row, so that path is covered. However, messaging only checks `isConversationMember` + `isBlocked` — it never re-checks that the underlying match still exists. If a conversation can ever outlive its match (e.g. future code, partial delete, or a manually-created conversation row), users could keep messaging post-unmatch. Today it is saved only by the unmatch handler also deleting the conversation in the same transaction. Fragile coupling worth an explicit guard.
- fix: In the message-send path, also verify the conversation's `match_id` still resolves to a live match, or document that conversation lifetime == match lifetime and enforce with a FK (`conversations.match_id REFERENCES matches(id) ON DELETE CASCADE`).

### [ERROR] 🟠 — Swipe → match creation has a check-then-insert race (mutual-like double match) only partly mitigated
- where: `routes/matching.js:116-142`
- risk: Two simultaneous mutual likes both pass the `theirLike` check, then both `INSERT` into `matches`. The `UNIQUE(user_a_id,user_b_id)` constraint + canonical ordering correctly collapses this to one row (the loser catches the UNIQUE error and re-selects), so no duplicate match — good. But `emitNewMatch` / push (lines 144-159) only run on the *winning* insert path; the racing request returns `{matched:true}` without emitting, so one user may not get the realtime/push "new match" event. Minor UX/consistency, not data corruption.
- fix: After the catch-and-reselect branch, also emit/push (idempotently) so both racers notify.

### [ERROR] 🟠 — `verification-request` upsert can desync with `verification_requests` after admin reject
- where: `routes/profile.js:127-151`, `routes/admin.js:142-167`
- risk: Admin `unverify`/reject sets `verification_requests.status = 'rejected'`. The user can immediately re-submit (`verification-request`), which upserts back to `'pending'` (profile.js:144-148) — fine. But `GET /profile/me` (profile.js:74-77) queries `status != 'approved'` and returns the first row; combined with the admin verify path also setting `identity_verified` on `profiles`, the two sources of truth (`profiles.identity_verified` vs `verification_requests.status`) can drift if the admin verify UPDATE matches 0 rows on `verification_requests` (e.g. user verified manually before ever requesting — no request row exists, so `verify` updates 0 rows and there is simply no request record; `/profile/me` then shows `verified:true, verificationRequested:null`, which is actually correct). Low severity but the dual-write is brittle.
- fix: Make `profiles.identity_verified` the single source of truth for "verified"; treat `verification_requests` purely as a queue. Already mostly the case — just document and ensure admin verify path is idempotent when no request row exists (it is).

### [ERROR] 🟡 — Migration runner swallows ALL "duplicate column" errors, masking genuinely bad migrations
- where: `db.js:57-69`
- risk: `runMigrations` re-runs every `.sql` on every boot and catches `duplicate column name` to tolerate non-idempotent `ALTER TABLE ADD COLUMN`. This works, but: (1) there is **no migrations bookkeeping table**, so a migration that *should* run but happens to also contain a duplicate-column ALTER will have that error silently swallowed and the rest of the file's statements (after the failing one) skipped, because `db.exec` runs the whole file as one batch and aborts at the first error. A multi-statement migration file where statement 1 is a duplicate ALTER and statement 2 is a new table would silently skip the new table forever. (2) Re-running data backfills (013, 016, 021, 025) every boot is wasteful and can re-apply unintended writes if not written idempotently.
- fix: Add a `schema_migrations(filename, applied_at)` table and skip already-applied files instead of relying on error-swallowing. Split each ALTER into its own `db.exec` call (or check `PRAGMA table_info`) so one duplicate column never aborts later statements in the same file. Audit backfill migrations for idempotency.

### [ERROR] 🟡 — `getCandidates` builds an IN-clause with `excludeIds.size` placeholders — unbounded growth
- where: `matching/candidates.js:46-67`
- risk: The exclude set = self + all swiped + all matched. A heavy user accumulates thousands of swipes; the query `WHERE p.user_id NOT IN (?, ?, …)` grows one placeholder per excluded id. SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999 (older builds) / 32766 (newer). A user past the limit gets a hard query error → `/matching/candidates` 500s for that user permanently. Placeholders are parameterized (no injection), but this is a scaling time-bomb.
- fix: Replace the `NOT IN (...)` with anti-joins (`LEFT JOIN swipes ... WHERE swipes.id IS NULL`) or a temp table of excluded ids, so the count never becomes a parameter-count problem.

### [ERROR] 🟡 — `GET /matching/candidates` loads ALL eligible profiles into memory, scores in JS, then slices
- where: `matching/candidates.js:50-141`, `routes/matching.js:32-33`
- risk: Every Discover request selects all non-excluded profiles, fetches each one's interests with a per-row prepared query (N+1), scores all in JS, sorts, then `slice(offset, offset+limit)`. Fine at demo scale, O(N) per request as the userbase grows; the per-candidate `listPrompts` and `getInterests` calls multiply it.
- fix: Push scoring/pagination into SQL or precompute; at minimum batch-fetch interests for the page only.

### [ERROR] 🟡 — `ALLOWED_ORIGIN` / push / R2 misconfig fail silently to "not configured" 503s
- where: `push.js:10-14`, `photos.js:58-61`, `storage/r2.js:20-22`
- risk: If prod env vars are missing, photo upload and push silently return 503 / become no-ops rather than alerting operators. Not a security hole (fail-closed) but a "broken endpoint" trap.
- fix: Log a loud warning at boot when expected prod integrations are unconfigured.

### [ERROR] ⚪ — `DELETE /messaging/blocked/:userId` returns success even when nothing was blocked
- where: `routes/messaging.js:458-463`
- risk: Always returns `{unblocked:true}` regardless of whether a row existed. Harmless; just imprecise (cannot distinguish "unblocked" from "was never blocked").
- fix: Return `{ unblocked: result.changes > 0 }`.

### [ERROR] ⚪ — `undo-skip` undoes the most recent skip globally, not per-candidate
- where: `routes/matching.js:167-183`
- risk: Deletes the single most-recent `skip` row by `created_at`. Correct for an "undo last" button, but there is no way to undo a *specific* earlier skip, and no rate limit (it is not on `mutationLimiter`). Low impact.
- fix: Optional: accept a candidateId, and add the mutation limiter.

### [ERROR] ⚪ — `change-email` does not invalidate other sessions
- where: `routes/account.js:35-61`
- risk: `change-password` bumps `token_version` (good); `change-email` does not. After an email change, other logged-in sessions keep working under the new email. Usually acceptable, but inconsistent with the password path and arguably an account-takeover-recovery gap.
- fix: Consider bumping `token_version` on email change too (or document the intentional difference).

---

## Things checked and found SOLID (no action)
- `GET /profile/:userId` genuinely match-gates (profile.js:472-483); registered last so it never shadows `/me`.
- `contextCard` correctly withheld from Discover candidates and only exposed post-match (matching.js:49-53).
- Precise location: ZIP/postal stripped from `distCity` in every public surface (candidates, matches, activity, public profile).
- All SQL is parameterized; dynamic `PUT /profile/me` SET clause uses a fixed allowlist `fieldMap`/`boolFieldMap` (profile.js:306-357) — no column injection.
- JWT: fail-fast secret in prod, 30-day expiry, `token_version` revocation enforced on header/query/socket paths; export `?token=` correctly re-runs the full version/suspension check (export.js:14-19).
- bcrypt rounds 12; constant-time login with dummy-hash; suspended accounts blocked at login and via `checkTokenVersion`.
- Photo upload: MIME allowlist, 10MB cap, presigned PUT scoped to `profile-photos/{userId}/` with a server-side prefix ownership check (photos.js:26-28).
- Socket.IO auth validates JWT on connect and re-checks membership on `join_conversation`; malformed payloads wrapped in try/catch.
- Central error handler logs server-side and returns generic `{error:'Something went wrong.'}` — verified on prod (clean 404 JSON, 401s on `/profile/me` and `/admin/stats`, no stack leak).
- Admin routes consistently chain `requireAuth, requireAdmin`; `/admin/me` intentionally auth-only (returns just an isAdmin boolean).
- `process.on('unhandledRejection')` + `uncaughtException` guards present; async push/email calls all `.catch(() => {})`.
