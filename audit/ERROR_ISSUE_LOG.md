# Spectrum Dating — Error / Issue Log

Consolidated from the 2026-06-30 six-agent audit (Backend & Security, Code Quality, Functional QA, plus accessibility/robustness defects that break flows). Deduped and severity-ranked. "Sources" notes how many independent agents flagged it — items found by 2+ agents are high-confidence.

Severity: 🔴 broken / exploitable / data-loss · 🟠 serious · 🟡 minor / hardening · ⚪ nit

---

## 🔴 Critical

| # | Issue | Location | Sources | Note |
|---|---|---|---|---|
| E1 | **Migration runner is not actually idempotent** — `db.exec` runs a file as one batch and aborts on the first `duplicate column name`; the runner catches it and skips to the *next file*, so any `ADD COLUMN` *after* an already-applied one in the same file is silently never applied. Latent: the next time a column is appended to an existing migration it won't apply on prod DBs → `no such column` at query time. No `schema_migrations` bookkeeping table. | `Server/src/db.js:57-70` (triggers: `014`,`018`,`023`,`026`) | Code-Quality + Backend | Fix: per-statement exec/catch, or one ALTER per file, or a `schema_migrations` table run inside a txn. A boot-twice test would catch it. |
| E2 | **Message photo-attachment flow is dead and unsafe** — `POST /photos/confirm` flips status to `scanned` with **no actual scan** (no AV/NSFW/CSAM anywhere), and `message_attachments.message_id` is never set by any code path, so uploaded images can never appear in a conversation but *are* served as permanent public URLs. Effectively an unmoderated public image host bolted to accounts. Client send-path fabricates client-only message ids. Currently masked by `ATTACHMENTS_ENABLED=false`; a flag-flip ships it broken. | `Server/src/routes/photos.js:188-242`; `Client/src/messaging/ConversationScreen.jsx:1034-1099` | Backend + Code-Quality + Feature-Gap | Fix: either finish (message↔attachment link + real scan + strict URL gating) or remove the upload/confirm/url endpoints. Don't name a status `scanned` until something scans. |
| E3 | **Unread-badge filter reads a key the normaliser doesn't guarantee** — `MessagingApp` filters on `c.hasUnread` while other consumers read `c.unread`/`c.started`; works only because the normaliser spreads the raw server field. The obvious future cleanup (drop raw passthrough for the `unread` alias) silently zeroes the unread count. | `Client/src/messaging/MessagingApp.jsx:36` vs `api.js:199-209` | Code-Quality | Fix: pick one canonical field (`unread`), map in the normaliser, read it everywhere. |

## 🟠 Serious

| # | Issue | Location | Sources |
|---|---|---|---|
| E4 | **Safety "Copy" throws uncaught `NotAllowedError`** — `navigator.clipboard.writeText` not wrapped in try/catch; rejection escapes and the graceful "Couldn't copy" announce never fires (SR users get nothing). Environment-dependent (didn't repro in one Chrome session) but the unguarded code is real. | `Client/src/SafetyScreen.jsx:169-173` (callers `:359-371`, `:386-407`) | Code-Quality + A11y + (Functional QA confirmed unguarded) |
| E5 | **`/messaging/block` allows self-block; nonexistent target → 500** — missing the self-target guard and existence check that `/report` has; FK violation bubbles as a generic 500 and burns the abuse limiter. | `Server/src/routes/messaging.js:402-430` | Backend |
| E6 | **Account deletion destroys moderation evidence** — `reports.reporter_id`/`reported_id` are `ON DELETE CASCADE`, so a self-delete wipes the user's outbound report trail and reports filed *against* a deleted abuser. Moderators lose history. | `Server/src/routes/account.js:64-90`; `migrations/010_moderation.sql:4-5` | Backend |
| E7 | **`getCandidates` builds an unbounded `NOT IN (?,?,…)`** — one placeholder per swiped/matched id; a heavy swiper eventually exceeds SQLite's variable limit → permanent 500 on Discover. Scaling time-bomb. | `Server/src/matching/candidates.js:46-67` | Backend |
| E8 | **No rate limiting on `/account/change-password` & `/change-email`** — a stolen 30-day token lets an attacker brute-force the current password (and pivot to email takeover); also bcrypt CPU exhaustion. | `Server/src/routes/account.js:13,35` | Backend |
| E9 | **Optimistic swipe removes the candidate before server confirm and swallows failures** — a failed "like" silently never matches; double-tap can double-submit. No in-flight guard, no resync. | `Client/src/SuggestionScreen.jsx:510-560` | Code-Quality |
| E10 | **Messaging gated only on block, not on a live match** — relies on the unmatch handler also deleting the conversation in the same txn; fragile coupling, no explicit guard / FK. | `Server/src/routes/messaging.js:259-331` | Backend |
| E11 | **Swipe→match race: only the winning insert emits the new-match event** — the racing mutual-like returns `{matched:true}` without emitting, so one user may miss the realtime/push "new match". (UNIQUE constraint correctly prevents duplicate rows.) | `Server/src/routes/matching.js:116-159` | Backend |
| E12 | **Two socket.io connections per user; churn on thread switch** — app-level + per-conversation sockets; the conversation socket re-`io()`s on every `conversationId`/`currentUserId` change, opening/closing in a loop on rapid switching. | `Client/src/App.jsx:869-891`; `messaging/ConversationScreen.jsx:867-909` | Code-Quality |
| E13 | **`markConversationRead` fire-and-forget races the list refresh** — unread can flicker back if the PUT hasn't committed before the re-fetch; two writers to the badge. | `Client/src/messaging/MessagingApp.jsx:95-99` | Code-Quality |
| E14 | **`handleBlockReportSubmit` null-derefs `currentConvo.otherUser.userId`** — async handler can fire after state nulls `currentConvo` → unhandled rejection, block/report silently lost. (`handleUnmatchConfirm` uses optional chaining — inconsistent.) | `Client/src/messaging/MessagingApp.jsx:134-147` | Code-Quality |
| E15 | **Inactivity effect's blanket `eslint-disable` hides dep-array risk** — fine today, but a future state reference would capture a stale value with no lint to catch it (no ESLint installed). | `Client/src/App.jsx:712-759` | Code-Quality |
| E16 | **`parseInt` without radix on matching query params** (messaging route correctly uses radix — inconsistent). | `Server/src/routes/matching.js:29-30` | Code-Quality |

## 🟡 Minor / hardening

| # | Issue | Location |
|---|---|---|
| E17 | **Coarse-location ZIP-strip regex duplicated 5× (privacy rule, no shared helper)** — one missed/edited copy leaks a precise ZIP; regex only strips *trailing* digit runs ("12345 Phoenix" passes through). | `Server/src/routes/matching.js:60,218,290,321` |
| E18 | Email enumeration via `register` / `change-email` distinct 409 (login is correctly non-enumerable). | `Server/src/routes/account.js:49-50`, `auth.js:48-50` |
| E19 | `verification-request` ↔ `verification_requests` dual-write can drift; make `profiles.identity_verified` the single source of truth. | `Server/src/routes/profile.js:127-151`, `admin.js:142-167` |
| E20 | `getCandidates` loads ALL eligible profiles into memory + N+1 interest queries, scores in JS, then slices — O(N)/request. | `Server/src/matching/candidates.js:50-141` |
| E21 | Missing prod env (`ALLOWED_ORIGIN`/push/R2) fails silently to 503/no-op instead of a loud boot warning; `ALLOWED_ORIGIN` unset → localhost CORS lockout. | `Server/src/index.js:60`, `push.js:10-14`, `photos.js:58-61`, `storage/r2.js:20-22` |
| E22 | Pervasive empty `catch {}` / `.catch(()=>{})` with no logging hides real failures (block, archive, unmatch, swipe). | `MessagingApp.jsx`, `SuggestionScreen.jsx`, `api.js`, `App.jsx` |
| E23 | Auth subview `document.title` stale on Forgot-password / Check-email / in-card login↔register toggle. | `Client/src/App.jsx:573-587`, `AuthScreen.jsx:105-109,409-427` |
| E24 | Client/server duplicate the same limits (2000-char body, 10MB upload, 6 photos, 5-convo cap) — can drift. | various |
| E25 | `userReacted ?? youReacted` field-name tolerance in 4 spots — server contract never pinned. | `ConversationScreen.jsx:856,902,968,1216` |
| E26 | helmet CSP disabled (acceptable for JSON API, but document that CSP is the frontend's job); confirm HSTS posture. | `Server/src/index.js:56-59` |

## ⚪ Nits
- `DELETE /messaging/blocked/:userId` returns success even when nothing was blocked (`messaging.js:458-463`).
- `change-email` doesn't bump `token_version` (other sessions survive) — inconsistent with `change-password` (`account.js:35-61`).
- `undo-skip` undoes the most recent skip globally, not per-candidate, and isn't rate-limited (`matching.js:167-183`).
- `optionalAuth` global + route `requireAuth` = double `checkTokenVersion` DB hit per request (`index.js:62`).
- Identical-branch ternary `rejected ? t.surfaceAlt : t.surfaceAlt` (`ConversationScreen.jsx:1566`).
- Stale "no backend calls" comment in `SafetyScreen.jsx:6` (it makes 2 API calls); unused `getUserId` import in `ConversationScreen.jsx:3`.
- `unhandledRejection` only logs while `uncaughtException` exits — inconsistent recovery posture (`index.js:94-100`).
- Message delete leaves a permanent, unrecoverable tombstone (by design — flagged for test-data integrity, not a bug).

---

## Verified SOLID (no action — for confidence)
Parameterized SQL throughout (fixed allowlist for dynamic profile UPDATE — no column injection); fail-fast `JWT_SECRET`, 30-day expiry, `token_version` revocation on header/query/socket; bcrypt-12 + constant-time login + dummy hash; suspended-account blocking; match-gated `GET /profile/:userId` (registered last, genuinely gates); `contextCard` withheld pre-match; coarse location stripped on every public surface; photo upload MIME allowlist + 10MB cap + prefix ownership; socket JWT auth + membership re-check; central error handler returns generic errors (verified no stack leak on prod); `unhandledRejection`/`uncaughtException` guards present. **Gender + seeking (mutual) and age-range filtering are correctly implemented** in `candidates.js:102-118` and captured in the Profile editor (corrects an audit over-claim).

---

# Round 2 — 2026-06-30 (8-agent re-audit)

> **Meta:** the live build SHA is unchanged since R1, so **none of the R1 items above were fixed** — all remain live. Full per-dimension detail in `audit/round2-*.md`.

## 🔴 NEW Critical

| # | Issue | Location | Source |
|---|---|---|---|
| E27 | **[SAFETY] Report silently fails to block the most common bad actor.** Discover's report sheet defaults to reason `"inappropriate"`, which the **block** endpoint rejects (`400`, `VALID_REASONS` omits it); the error is swallowed by an empty `catch`, yet the user is told *"you will not see them again."* The reported person is **never blocked** and can resurface. A literal safety promise that silently fails — highest-harm finding this round. | `SuggestionScreen.jsx:237,332` → `messaging.js:400` | Trust-Safety |
| E1▲ | **Migration non-idempotency now concretely proven.** `005_profile_photos.sql` adds `public_url` as the *tail* statement after a duplicate-column ALTER; a re-migrated DB silently skips it → `/photos/upload-intent` 500s on `no such column: public_url`. (Upgrades R1 E1 from latent to demonstrated.) | `db.js:57-70`; `migrations/005` | Backend + Code |

## 🟠 NEW Serious

| # | Issue | Location | Source |
|---|---|---|---|
| E28 | **Export ships full message corpus via the 30-day session JWT in the URL** (`?token=`) → proxy/CDN logs, history, Referer; leak = account takeover. Use a short-lived purpose-scoped token. | `export.js:7-19` | Backend |
| E29 | **Account deletion orphans photos in the public R2 bucket forever** — FK cascade drops DB rows but nothing calls `deleteObject`; deleted user's photos stay world-fetchable. Right-to-erasure gap. | `account.js:64-90` | Backend |
| E30 | **`/export/conversations` has no rate limiter + O(convos×msgs) N+1** — cheap PII-scrape + DoS amplifier. | `export.js` | Backend |
| E31 | **Realtime "new match" is dead** — server emits `new_match` to both users but **no client listens**; the live match signal lands in the void (compounds E11). | `emitters.js:28` vs `App.jsx:869-891` | Code |
| E32 | **App-level unread badge counts the user's OWN sent messages** (no self-filter) → phantom unread disagreeing with the server count. | `App.jsx:880-884` | Code |
| E33 | **Badge socket misses conversations created after connect** (rooms joined once; no later `join_conversation`) → new-match threads don't bump unread until reload. | `socket/index.js:21-33` | Code |
| E34 | **Search radius silently no-ops outside ~7 hardcoded US metros** — `distanceMiles` returns null for almost any real location, so "Within 25 mi" still shows distant people; free-text city, no validation. | `utils/metros.js:68-112`, `candidates.js:93-99` | User-Journey |
| E35 | **Removing your only photo leaves you photoless but still in Discover** (candidate filter needs name+bio+interest, not a photo); no last-photo guard/warning. | `photos.js:153-183`, `candidates.js:50-67` | User-Journey |
| E36 | **`message_attachments.mime_type` CHECK omits `image/gif`** though `ALLOWED_MIME` accepts it → GIF INSERT throws → opaque 500. | `migrations/004:19` vs `photos.js:9` | Backend |
| E37 | **Attachment failure-path loses the user's typed text** after the photo is uploaded/confirmed (split-brain). Masked by `ATTACHMENTS_ENABLED=false`. | `ConversationScreen.jsx:1062-1077` | Code |
| E9▲ | **Failed "I'm interested" like silently lost — now live-reproduced.** Candidate removed before the swipe POST; on failure the UI shows full success and consumes the person. Messaging retries; Discover doesn't. | `SuggestionScreen.jsx:518-527` | Functional QA |

## 🟡 NEW Minor / hardening

| # | Issue | Location | Source |
|---|---|---|---|
| E38 | Socket suspension not enforced on already-open connections — a suspended user keeps live-receiving room events until reconnect (read-only leak; can't send). | `socket/index.js:11-19` | Backend |
| E39 | `/photos/upload-intent` unmetered + client-trusted `file_size_bytes` (presigned PUT doesn't pin content-length) → unscanned public image host. | `photos.js:188-242` | Backend |
| E40 | `verifyToken` ignores the JWT `purpose` claim → a leaked reset/export token replayable as a full session token. Add `if (payload.purpose) return null;`. | `middleware/auth.js:19-27` | Backend |
| E41 | **Shared abuse-limiter bucket** (10/15min) covers report + block + feedback + verification — so feedback spam can **rate-starve a safety report/block**. | `feedback.js:12`, `messaging.js:402,470` | Backend + Trust-Safety |
| E42 | `/auth/forgot-password` has **no rate limiting** (login/register do) → email-bomb + enumeration-at-volume. | `routes/auth.js` | Functional QA |
| E43 | Deleting an unsent message fires `DELETE …/messages/temp-<id>` → 404 (client-fabricated id). | `ConversationScreen.jsx:1161-1181` | Functional QA |
| E44 | `getConversation` drops `limit=0`/falsy params via truthiness; latent pagination foot-gun. | `api.js:231-237` | Code |
| E45 | Onboarding interest case-canonicalisation lives only in the add path; `user_interests` matching is case-sensitive → case drift silently reduces shared-interest scoring. | `OnboardingScreen.jsx:307-314` | Code |
| E17▲ | Coarse-location ZIP regex now duplicated **7×** and only strips a *trailing* digit run — `"85004 Phoenix"` leaks the ZIP; still no shared `coarseCity()` helper. (Privacy.) | `matching.js:60,218,290,321` | Backend + Code |
| E24▲/E25▲ | Conversation-cap `5` hardcoded **4×** (client/server can disagree); reaction `userReacted ?? youReacted` dead-branch in **6** spots (server only sends `userReacted`). | various | Code |

## ⚪ NEW Nits
Reactions 404-vs-403 existence oracle (`reactions.js:51-55`) · `change-email` doesn't bump `token_version` · `export.js` mixes coarsened timestamps with full names/bodies (add comment) · onboarding re-validates 3×/render.

## ✅ Corrections this round
- **E10 DOWNGRADED to non-issue** — messaging-vs-live-match is guaranteed by `conversations.match_id … ON DELETE CASCADE` (`003_messaging.sql:3`). Optional defense-in-depth comment only.
- R1 criticals (E1, E2, E3) and serious (E5, E7, E9, E12, E16) **re-confirmed unchanged and live**.

---

# ✅ Fix status — 2026-06-30 (autonomous 2-agent correction sweep)

Two builder agents fixed the Error Log in parallel (backend + frontend repos, separate deploy pipelines). **Backend** deployed `Spectrum-Dating-Server` @ `0c3fef7` (health-gated, `/health` SHA verified). **Frontend** deployed `Spectrum-Dating` @ `61cc34b`, bundle `index-B1PmTRzs.js` (aliased to `spectrum-dating-eta.vercel.app`, live-verified).

## FIXED & deployed
- 🔴 **E27** — report/block reason mismatch. Backend added `inappropriate` to `VALID_REASONS`; frontend added `canonicalBlockReason()` + honest UI (only shows "you won't see them again" on real success) + client-side deck fallback. **Verified live end-to-end**: block w/ reason `inappropriate` → `201 {blocked:true}` (was 400), block took, then unblocked to restore.
- 🔴 **E1 / E1▲** — migration runner now execs/catches per statement; **boot-twice verified** (2nd boot clean, `public_url` present).
- 🔴 **E3** — unread key canonicalized on `unread` in the normaliser; no consumer reads raw `hasUnread`.
- 🟠 **E5** (self-block → clean 400, **verified live**), **E9** (swipe restores candidate + in-flight guard), **E28** (5-min purpose token + `no-store`/`no-referrer`), **E29** (R2 objects deleted on account deletion), **E30/E39/E41/E42** (rate-limit split; safety actions get their own bucket), **E31** (`new_match` client listener), **E32** (self-filter unread badge).
- 🟡 **E16** (parseInt radix), **E17/E17▲** (shared `coarseCity()`, strips embedded ZIPs), **E23** (auth subview titles), **E24** (client consumes server `activeCap`), **E25** (dead reaction branch removed), **E38** (sockets torn down on suspend/sign-out), **E40** (`verifyToken` rejects purpose tokens), **E43** (unsent discard client-side), **E44** (`limit=0` survives), **E45** (interest case normalized), **E22** (catch-block logging) + the reactions/unblock/change-email nits.
- ℹ️ **E36** — found **already fixed** in current source (migration 004 CHECK already allows `image/gif`); no change needed.

## Deferred-four → follow-up status (updated 2026-07-01)
- ✅ **E33 — FIXED** (backend `1e458aa`): new conversations `socketsJoin` both users' live sockets on create; new-match threads bump unread without a reload.
- ✅ **E6 — FIXED** (backend `1e458aa`, migration `030`): `reports` rebuilt to `ON DELETE SET NULL`, guarded + boot-twice tested — deleting a user now preserves the report row (moderation evidence retained instead of cascading away).
- ✅ **E2 / E37 — BUILT, GATED OFF** (backend `2d6b634` + frontend `8f8bdaa`): full attachment flow — attachment↔message linking in one txn, honest `pending → pending_review → approved/rejected` lifecycle (`scanned` retired, migration `031` boot-twice tested), strict serving (approved + member only), admin human-review queue logged to `moderation_log`; typed text preserved on failure (E37 closed). `ATTACHMENTS_ENABLED=false` — attach UI tree-shaken out of the bundle; gate verified live (`400 "Attachments are not enabled"`). R2 storage configured + round-trip verified in prod. **Go-live requires:** backend env flag `true` + frontend flag flip + redeploys + your ToS/Privacy update + NCMEC reporting process (+ optional real CSAM/NSFW scanner to augment human review).
- ⏳ **E12 — still DEFERRED**: dual-socket consolidation (real refactor with reconnection/room-rejoin risk) — parked for a dedicated QA-backed session.
