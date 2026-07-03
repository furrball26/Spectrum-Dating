# Round 2 — Backend & Security Audit (deep dive)

Scope of this pass (areas R1 only touched): socket.io authz + event payload validation, `GET /export/conversations`, `reactions`/`feedback` routes, photo presign ownership edge cases, the migration runner's multi-statement-abort behavior (verified concretely), and IDOR across messaging/profile/matching.

Method: full source re-review of `C:\Users\Pen\Desktop\Spectrum-Dating-Server\src` + read-only probes against `https://spectrum-dating-server-production.up.railway.app`.
Live build SHA at audit time: `75430624ffbc8d317cbf0c3948ab62ac445583c2` — **identical to R1**, so no code has changed since the first audit; all R1 findings that were code-level remain live.

Probes run (read-only): `/health` → 200 `{status:ok, sha:7543...}`; `/export/conversations` with no token → 401; with `?token=garbage` → 401 (auth gating itself is sound — see EXPORT findings for the *transport* risk, not an auth bypass).

Tag legend: **NEW** = not in R1 log; **confirmed (R1)** = re-verified an existing finding.
Severity: 🔴 exploitable / data-loss · 🟠 serious · 🟡 hardening · ⚪ nit.

---

## Security

### [ERROR] 🟠 NEW — `GET /export/conversations` ships full message history + names via a `?token=` query param (token leakage surface)
- where: `routes/export.js:7-19`, mounted at `index.js:71`
- risk: The export endpoint deliberately accepts the 30-day JWT in the URL query string (`?token=`) so a browser download link works without custom headers. The auth check itself is correct (it re-runs `verifyToken` → version/suspension/existence). **But putting a long-lived bearer token in a URL is the classic token-leak channel**: it lands in browser history, the server/proxy/CDN access logs (Railway's included), and — if the export page ever renders any third-party resource or the user navigates onward — the `Referer` header. The token is the *full-power* 30-day session token (not a purpose-scoped, short-lived export token like the password-reset flow uses via `signPurposeToken`). Anyone who recovers that URL string gets complete account takeover, and the response body it unlocks is the user's entire conversation corpus (every message, both sides, including `[deleted]` bodies are excluded but all other names/bodies present). For a dating app serving a vulnerable audience, that is a high-value secret in a low-security location.
- fix: Mint a **short-lived, purpose-scoped** export token (reuse `signPurposeToken(sub,'export',tv,'5m')` + `verifyPurposeToken`) instead of accepting the session JWT in the query string; or require the export to be fetched with an `Authorization` header (client does a `fetch` + `Blob` download rather than a bare `<a href>`). At minimum, set `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the response and document that the URL is sensitive.

### [ERROR] 🟠 NEW — `GET /export/conversations` has no rate limiter (bulk PII scrape + bcrypt-free amplification)
- where: `routes/export.js` (only auth, no `mutationLimiter`/`abuseReportLimiter`)
- risk: The handler runs an unbounded fan-out: for every conversation it issues a per-conversation `messages` query **and** a per-conversation reactions JOIN (N queries per call), then serializes the whole history into one JSON blob. There is no throttle, so a valid token can hammer this endpoint to (a) repeatedly dump the full corpus and (b) drive O(conversations × messages) DB work per request as a cheap DoS amplifier. Every other state-touching or expensive authenticated route is rate-limited; this read is both expensive and PII-dense and is not.
- fix: Apply a limiter (e.g. a low-ceiling per-user limiter, ~5/15min — exports are rare). Keying is easy since `req.ctx.userId` is set by `optionalAuth`/`contextMiddleware`.

### [ERROR] 🟠 NEW — Account deletion orphans uploaded photos in public R2 storage forever (PII persistence)
- where: `routes/account.js:64-90`; contrast `routes/photos.js:153-183` (single-photo delete *does* call `deleteObject`)
- risk: `DELETE /account/me` relies on FK cascade to remove `profile_photos` and `message_attachments` rows (confirmed: `011_profile_photos_gallery.sql:3` and `004_reactions_photos.sql:16-17` cascade on user delete). But the cascade only drops **DB rows** — it never calls `deleteObject` on the R2 storage keys. The per-photo `DELETE` route deletes the R2 object; the account-deletion path does not. Net result: a deleted user's face/photos remain **permanently and publicly fetchable** at their `getPublicUrl` (R2 public bucket) after they have exercised their right to delete. For a vulnerable-audience dating product this is a serious privacy/GDPR-style "right to erasure" gap — the user believes their photos are gone; they are not.
- fix: In the deletion transaction, first `SELECT storage_key FROM profile_photos WHERE user_id = ?` (and message-attachment keys for the user), then best-effort `deleteObject` each after the DB commit. Same for any `message-attachments/{userId}/...` keys.

### [ERROR] 🟡 NEW — Socket `io.use` auth uses `verifyToken` but never re-checks suspension/version *after* connect; long-lived rooms outlive revocation
- where: `socket/index.js:11-19`, `30-33`
- risk: JWT (incl. version + suspension) is validated **once at connect** via `verifyToken` — good. But a socket can stay connected for the lifetime of the TCP connection. If an admin suspends the user (`admin.js:123-127` bumps `token_version` + sets `suspended`) **while their socket is open**, the existing socket keeps receiving `new_message`/`new_match`/`reaction_update` events for every room it already joined — there is no periodic re-check and no forced disconnect on suspension. A suspended/abusive user thus keeps live-receiving their matches' messages until they happen to reconnect. Severity is moderated by the HTTP side (they can't *send* — `requireAuth` re-checks every POST), so this is a read-only leak window, not a write path.
- fix: On suspend/`token_version` bump, disconnect the user's sockets (`io.to('user:'+id).disconnectSockets()`), or add a lightweight periodic re-validation in a socket heartbeat. Low effort, closes the window.

### [ERROR] 🟡 NEW — Socket connection joins rooms from a stale archived-state snapshot; `join_conversation` never enforces block status
- where: `socket/index.js:28-33` (auto-join), `37-51` (`join_conversation`)
- risk: Two small gaps. (1) On connect the server auto-joins every conversation room where the user is a non-archived member — but `join_conversation` re-join only checks **membership**, not **block status**. After a block, the HTTP send path correctly refuses (`messaging.js:271` consent gate), so a blocked party can't *send*; but both users remain joined to `conv:<id>` and would still receive any event emitted there. Since sends are gated this is currently inert, but it's a latent leak if any future emit path (typing, presence, system messages) bypasses the send gate. (2) `join_conversation` membership check is correct and IDOR-safe (verified: it re-queries `conversations` and compares `user_a_id`/`user_b_id` to `socket.userId`) — no issue there.
- fix: When emitting to a `conv:` room for a message, you already gate at the HTTP layer, so this is defense-in-depth: consider leaving the room on block, or filter recipients. Document that all `conv:` emits must be preceded by a send-side consent check.

### [ERROR] 🟡 confirmed (R1, E5) — `POST /messaging/block` allows self-block and 500s on a nonexistent target
- where: `routes/messaging.js:402-430`
- risk: No `blockedUserId === userId` guard and no existence check; a bad id throws an FK error → generic 500 (wrong status) and still burns the `abuseReportLimiter` quota. `/report` (`:470-504`) does both checks correctly — `/block` is the inconsistent twin. Re-confirmed unchanged at the current SHA.
- fix: Mirror `/report`: 400 on self-target, `SELECT 1 FROM users WHERE id=?` → 404 before insert.

### [ERROR] 🟡 NEW — `/photos/upload-intent` + `/confirm` lets any authed user create permanent public-URL image rows with a fake `file_size_bytes`, no rate limit, no real scan
- where: `routes/photos.js:188-242`
- risk: Distinct from R1's "attachment flow is dead" finding — this is the *abuse* angle on the still-present endpoints. `/upload-intent` has **no rate limiter** (unlike `/profile-upload-url` which has `mutationLimiter`), so a token can presign unlimited R2 PUT URLs (each a 5-min window to upload 10 MB of arbitrary image bytes to a public bucket). `fileSizeBytes` is **client-supplied and never enforced** against the actual uploaded object — the presigned PUT doesn't pin content-length, so the "10 MB cap" is advisory only. `/confirm` flips status to `scanned` with no scan (R1 E2 / FEATURE). Combined: an authenticated account is an unmetered, unscanned, public image host. The `message_id` gating in `GET /:attachmentId/url` (`:255-265`) is correct *when* `message_id` is set, but since no code ever sets it, every attachment falls into the `else` branch and is served to its uploader on demand — fine for the uploader, but the object itself is already world-readable via the raw R2 public URL regardless of this endpoint.
- fix: Add `mutationLimiter` to `/upload-intent`; pin `Content-Length`/`Content-Type` in the presigned PUT policy; gate `GET /:attachmentId/url` to `approved` only; integrate a real scan before `approved`; or remove the trio until the message-attachment feature is finished (R1's recommendation).

### [ERROR] 🟡 confirmed (R1, E17) — Coarse-location ZIP-strip regex is duplicated 6× and only strips a *trailing* digit run
- where: `routes/matching.js:60,218,290,321`, `routes/profile.js:490` (and the export uses `coarseLabel`, not city). Six hand-copied instances of `(c.dist_city||'').replace(/[\s,]*\d{4,}(-\d+)?\s*$/,'').replace(/[\s,]+$/,'').trim()`.
- risk: (1) No shared helper → one edited/missed copy silently leaks a precise ZIP on that surface. (2) The regex anchors on `$`, so it only removes a ZIP at the **end** of the string. A value like `"85004 Phoenix, AZ"` (ZIP first) or `"Phoenix 85004 AZ"` (ZIP in the middle) passes through unstripped, exposing the precise postal code the house rule forbids. The `dist_city` field is free-text (`profile.js:177-180` only length-limits it), so users can and do enter ZIP-first formats.
- fix: Extract one `coarseCity(distCity)` helper in `utils/` and call it on every public surface; make the regex strip a 4-5 digit run **anywhere** (`/\b\d{4,5}(-\d{4})?\b/g`) not just trailing. Verified present on all current surfaces, but the brittleness + middle-ZIP leak are real.

### [ERROR] ⚪ NEW — `reactions` route leaks message existence across conversation boundaries via status-code differential
- where: `routes/reactions.js:51-55`, `85-92`
- risk: Both handlers return **404 "Message not found"** for a nonexistent id but **403 "Forbidden"** for a real message in someone else's conversation. An authenticated user can therefore probe arbitrary `messageId`s and distinguish "real message I'm not party to" (403) from "no such message" (404) — a minor existence/enumeration oracle for opaque ids. No content leaks (body/reactions are not returned on the 403 path). Very low impact because ids are random `newId()`s.
- fix: Return an identical 404 for both "not found" and "not a member" so the two are indistinguishable.

### Security — re-verified SOLID (no change from R1)
- JWT fail-fast on missing prod `JWT_SECRET` (`middleware/auth.js:6-11`); 30-day expiry; `token_version` + `suspended` re-checked on every header/`?token=`/socket path (`checkTokenVersion`). The export `?token=` path correctly re-runs the full check.
- bcrypt rounds 12; `change-password`/`change-email` both `bcrypt.compare` the current password before mutating; `change-password` bumps `token_version`.
- All SQL parameterized; the only string-interpolated SQL is the `${col}` read-cursor column (`messaging.js:211`) and the dynamic profile `SET` clause (`profile.js:366`) — both driven by **fixed server-side allowlists**, not user input. No injection.
- `GET /profile/:userId` genuinely match-gates and is registered last (`profile.js:472-483`). `contextCard` withheld from Discover (`matching.js:49-53`), exposed only post-match (`matching.js:225`, `profile.js:512`). Verified.
- Reactions/feedback/messaging member checks (`isConversationMember`) compare ids correctly — no IDOR on read/write of others' conversations or reactions.
- `before`-cursor pagination verifies the pivot message belongs to the conversation (`messaging.js:153-156`) — no cross-conversation timestamp disclosure.
- Admin routes all chain `requireAuth, requireAdmin`; `/admin/me` intentionally auth-only. `requireAdmin` re-reads the email from DB (not the token), so admin status can't be forged or stale.
- Central error handler returns generic `{error}` with no stack leak (verified on prod). `helmet` on, `x-powered-by` off, body cap 1 MB.

---

## Correctness / Robustness

### [ERROR] 🔴 confirmed (R1, E1) — Migration runner aborts the rest of a multi-statement file on the first error; **concretely demonstrable today**
- where: `db.js:57-70`
- risk: `db.exec(sql)` runs an entire `.sql` file as **one batch**; SQLite aborts the batch at the first failing statement. The runner catches only `duplicate column name` and `continue`s **to the next file** — it does **not** resume later statements in the *same* file. R1 flagged this as latent; this pass found the live files that prove it bites the next time these DBs are re-seeded from migrations:
  - **`010_moderation.sql`**: statement order is `CREATE TABLE reports` → `CREATE INDEX` → `CREATE INDEX` → **`ALTER TABLE users ADD COLUMN suspended`** (line 18, last). On a second boot the ALTER throws `duplicate column`, which is *caught after* the CREATEs already ran — so this file is safe **only because the ALTER is last**. 
  - **`005_profile_photos.sql`**: `ALTER profiles ADD photo_url` (line 2) → `ALTER message_attachments ADD public_url` (line 5). On re-run, statement 1 throws `duplicate column`, the batch aborts, and **statement 2 is skipped**. It happens to be idempotent-equivalent (both already applied), so no breakage *today* — but this is the exact failure shape: **a file where an already-applied ALTER precedes a not-yet-applied statement will silently skip the tail forever.**
  - The moment anyone appends a new `CREATE TABLE`/`ALTER` *after* an existing ALTER in any of `005/008/014/018/024/026` (all multi-ALTER files), it will never apply on existing prod DBs and queries will later hit `no such column`/`no such table`. There is no `schema_migrations` bookkeeping, so the runner cannot tell "already applied" from "should run."
- fix: Add a `schema_migrations(filename, applied_at)` table; skip applied files. Run each statement individually (split on `;` or one statement per `db.exec`) inside a transaction per file, or guard ALTERs with `PRAGMA table_info` checks. A boot-twice integration test catches the whole class.

### [ERROR] 🟠 NEW — `message_attachments` was created in 004 without `public_url`; the column only exists because of the 005 ALTER — and `/upload-intent` would 500 if 005's tail were ever skipped
- where: `server/src/migrations/004_reactions_photos.sql:14-24` (no `public_url`), `005_profile_photos.sql:5` (adds it), `photos.js:209-212` (INSERTs into `public_url`, `file_size_bytes`)
- risk: This is the concrete coupling between the migration bug above and a live endpoint. `/photos/upload-intent` writes `public_url`. That column is added by the **second** statement of `005`, i.e. exactly the "tail statement after a duplicate-column ALTER" that the runner will skip on any DB where `005`'s first ALTER is already applied. On a fresh DB it's fine (both run first time). But this is the precise latent break: a DB that ever loses/rebuilds and re-runs migrations after `photo_url` exists would skip `public_url`, and every `/upload-intent` call would then 500 on `no such column: public_url`. Documents *why* the migration bug is not merely theoretical.
- fix: Same as the migration fix. Separately, fold the `public_url` column into `004`'s `CREATE TABLE` (or its own single-ALTER migration) so it isn't the tail of a multi-statement file.

### [ERROR] 🟠 NEW — `message_attachments.mime_type` CHECK constraint omits `image/gif`, contradicting the code's allowlist
- where: `server/src/migrations/004_reactions_photos.sql:19` (`CHECK (mime_type IN ('image/jpeg','image/png','image/webp'))`) vs `photos.js:9` `ALLOWED_MIME` includes `'image/gif'`
- risk: `/upload-intent` accepts `image/gif` (passes the `ALLOWED_MIME` check at `photos.js:192`), then the `INSERT` violates the table's CHECK constraint → throws → generic **500** instead of a clean 400. A user uploading a GIF attachment gets an opaque server error. (The CHECK lists only jpeg/png/webp; profile-photo uploads don't hit this table so they're unaffected.)
- fix: Add `'image/gif'` to the CHECK constraint (new migration) or drop gif from `ALLOWED_MIME` for attachments. Reconcile the two allowlists.

### [ERROR] 🟠 confirmed (R1, E6) — Report evidence cascades away on account deletion
- where: `account.js:70-81`; `server/src/migrations/010_moderation.sql:4-5` (`reporter_id`/`reported_id` both `ON DELETE CASCADE`)
- risk: Re-verified. `DELETE /account/me` doesn't touch `reports` explicitly, and the FK cascade deletes (a) every report the deleting user **filed** and (b) every report filed **against** them. An abuser can self-delete to erase their own moderation trail. The explicit-delete block in `account.js` cleans push/interests/matches/conversations/swipes/blocks/profile/users but deliberately leaves `reports` to the cascade → evidence loss by design.
- fix: Change `reports.reporter_id`/`reported_id` to `ON DELETE SET NULL` (keep the row + reason/details for audit), or snapshot into `moderation_log` before deleting.

### [ERROR] 🟠 confirmed (R1, E7/E20) — `getCandidates` builds an unbounded `NOT IN (?,?,…)` and scores all profiles in JS
- where: `matching/candidates.js:46-67`, `136-141`
- risk: `excludeIds` = self + every swiped id + every matched id, one `?` placeholder each. A heavy swiper eventually exceeds SQLite's `SQLITE_MAX_VARIABLE_NUMBER` → hard query error → permanent 500 on Discover for that user. Plus the N+1 `getInterests` per candidate and full in-memory scoring. Re-confirmed unchanged.
- fix: Anti-join (`LEFT JOIN swipes … WHERE swipes.id IS NULL`) or a temp table of excluded ids; batch-fetch interests for the page only.

### [ERROR] 🟠 confirmed (R1, E10) — Messaging is gated on block + membership, never on a live match
- where: `messaging.js:259-273`
- risk: Send path checks `isConversationMember` + `isBlocked` but never re-verifies the underlying match still exists. Today the unmatch handler (`matching.js:243-247`) deletes the conversation row in the same transaction, so it's covered — but the coupling is implicit and `conversations.match_id` is `REFERENCES matches(id) ON DELETE CASCADE` (`003_messaging.sql:3`), which *does* enforce it at the DB level. So this is actually **better than R1 implied**: the FK cascade guarantees conversation lifetime ≤ match lifetime. Downgrading concern — the only residual risk is a manually-inserted conversation row, which no code path creates.
- fix: No action strictly required; optionally add an explicit `match_id` liveness assert in the send path as defense-in-depth + a comment noting the FK guarantee.

### [ERROR] 🟡 confirmed (R1, E11) — Swipe→match race: the losing mutual-like returns `{matched:true}` without emitting/pushing
- where: `matching.js:133-147`
- risk: Two simultaneous mutual likes: the UNIQUE constraint collapses to one match row (correct, no dup), but only the winning insert path runs `emitNewMatch` + push (`:144-159`). The racing request catches the UNIQUE error, re-selects, and returns `{matched:true}` **without** emitting — so one user may miss the realtime/push "new match." UX consistency, not corruption.
- fix: After the catch-and-reselect branch, emit + push idempotently so both racers are notified.

### [ERROR] 🟡 NEW — `verifyToken` (used by socket + export) does NOT enforce JWT `purpose`, while `verifyPurposeToken` exists but is bypassable in one direction
- where: `middleware/auth.js:19-27` vs `36-44`
- risk: `verifyToken` accepts **any** validly-signed session token. That's correct for session use. But note the asymmetry: a *purpose* token minted by `signPurposeToken(sub,'reset',…)` carries `{sub, purpose:'reset', tv}` and is also a valid plain token — so if a reset token ever leaked, `verifyToken` would accept it as a full session token (it ignores `purpose`). The reset flow's single-use property (tv bump) mitigates this, and reset tokens are short-lived, so impact is low — but `verifyToken` should reject tokens that carry a `purpose` claim so purpose-scoped tokens can't be replayed as session tokens.
- fix: In `verifyToken`, `if (payload.purpose) return null;` — a session token never has a purpose claim.

### [ERROR] 🟡 NEW — `/feedback` and `/profile/verification-request` share the same `abuseReportLimiter` bucket as `/report` + `/block`
- where: `feedback.js:12`, `profile.js:127`, `messaging.js:402,470` all use `abuseReportLimiter` (10 / 15 min)
- risk: One 10-per-15-min bucket is shared across **four** distinct user actions (report, block, feedback, verification-request) because the limiter keys only on `u:<userId>` with no per-route discriminator. A user who submits 10 pieces of feedback is then unable to **file a safety report or block someone** for 15 minutes — a safety action is throttled by an unrelated benign action. For a safety-first product, abuse-reporting and blocking should never be rate-starved by feedback spam.
- fix: Give `/report` + `/block` their own limiter instance (or include the route in the key) so safety actions have a dedicated budget; keep feedback/verification on a separate bucket.

### [ERROR] 🟡 confirmed (R1, E8) — `/account/change-password` and `/change-email` have no rate limiter
- where: `account.js:13,35`
- risk: Both `bcrypt.compare` the current password with no throttle. A stolen 30-day token (but not the password) → unlimited offline-speed bcrypt guessing of the current password here, and a hit enables email takeover. Also bcrypt CPU exhaustion. Re-confirmed unchanged.
- fix: Apply a per-user limiter to both.

### [ERROR] 🟡 confirmed (R1, ⚪) — `DELETE /messaging/blocked/:userId` always returns `{unblocked:true}`
- where: `messaging.js:458-463`
- risk: Returns success even when no row matched; can't distinguish "unblocked" from "was never blocked." Harmless.
- fix: `{ unblocked: result.changes > 0 }`.

### [ERROR] ⚪ NEW — `change-email` does not invalidate other sessions (no `token_version` bump)
- where: `account.js:35-61` (no tv bump) vs `change-password` `:28-29` (bumps tv)
- risk: After an email change, other logged-in sessions keep working under the new email. Inconsistent with the password path; arguably an account-recovery gap (changing your email after a compromise doesn't boot the attacker's sessions). Low impact. (R1 noted this as a nit; re-confirming.)
- fix: Bump `token_version` on email change too, or document the intentional difference.

### Correctness — re-verified SOLID
- `isConversationMember` / match-party checks are consistent and IDOR-safe across messaging, reactions, matching, and profile.
- `db.transaction(...)` wraps multi-write paths (profile update + interests, photo primary swap, unmatch, account delete, prompts replace) — atomic.
- Reaction toggle is idempotent per `(message,user,emoji)` via the UNIQUE constraint; export reaction map is per-user-scoped correctly.
- Socket payloads are type-checked and try/catch-wrapped; a malformed `join_conversation` can't crash the process.
- `parseInt(req.query.limit,10)` clamped in messaging pagination; matching still uses radix-less `parseInt` (`matching.js:29-30`) — R1 E16, cosmetic.

---

## Net-new this round (not in R1 log)
1. Export endpoint: session JWT in URL query string (token-leak channel) + no rate limit + N+1 PII fan-out.
2. Account deletion orphans R2 photo objects → permanent public PII after "right to erasure."
3. Socket suspension/revocation not enforced on already-open connections (read-only leak window).
4. `/upload-intent` unmetered + client-trusted `file_size_bytes` + GIF CHECK-constraint 500.
5. Migration multi-statement-abort proven against `005` (`public_url` tail) and characterized on `010`.
6. `verifyToken` ignores the `purpose` claim (purpose tokens replayable as session tokens).
7. Shared abuse-limiter bucket lets feedback spam starve safety reports/blocks.
8. Reactions 403/404 existence oracle.
