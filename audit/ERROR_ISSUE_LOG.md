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
