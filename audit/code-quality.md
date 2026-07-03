# Code Quality / Tech-Debt Audit — Spectrum Dating

Dimension: latent bugs, fragile patterns, maintainability risk. Static review only (no live walking).
Scope: Frontend `Spectrum-Dating/src` (React 18 + Vite), Backend `Spectrum-Dating-Server/src` (Express + better-sqlite3 + socket.io + JWT).
Date: 2026-06-30. Reviewer: code-quality agent.

Severity legend: 🔴 real bug · 🟠 likely bug / fragile · 🟡 smell · ⚪ style.

---

## 🔴 Real bugs

### [ERROR] 🔴 — Migration runner silently skips later `ADD COLUMN`s in a multi-statement file
- where: `server/src/db.js:57-70` (the `runMigrations` catch/`continue`); triggered by multi-`ALTER` files e.g. `server/src/migrations/014_dealbreakers.sql`, `018_richer_profile.sql`, `023_search_radius.sql`, `026_age_pref.sql`.
- issue: `db.exec(sql)` runs every statement in a file as one sequential batch and throws on the FIRST failing statement, leaving the rest of that file unexecuted. The runner catches `duplicate column name` and `continue`s to the *next file*. So for any file with N `ADD COLUMN`s, on a re-boot where column #1 already exists, the exception fires on #1 and columns #2…N in the same file are never (re)attempted. This is invisible today only because on the original fresh boot all columns applied; but it means the runner is NOT actually idempotent (violates the stated house rule). The moment someone edits one of these files to append a new column, that new column will never be added on existing databases — the first (already-present) `ALTER` aborts the batch before reaching it. Result: missing column → `SQLITE_ERROR: no such column` at query time in prod.
- fix: Split each statement and exec/catch per-statement, e.g. parse the file into individual statements (split on `;` at statement boundaries, or keep one `ALTER` per migration file) and wrap each in the duplicate-column tolerant try/catch. Better: track applied migrations in a `schema_migrations` table and run each file once inside a transaction.

### [ERROR] 🔴 — Photo-attachment send path fabricates message IDs and never links the attachment (dead/half-wired feature)
- where: `src/messaging/ConversationScreen.jsx:1034-1099` (esp. 1059-1076); gated off by `ATTACHMENTS_ENABLED = false` at line 37.
- issue: When sending with an attachment and no text body, the code sets `savedId = \`msg-${Date.now()}\`` and `savedTimeLabel = "Today"` and pushes a message that the server never persisted (no `sendMessage` call when `capturedBody` is empty). The optimistic photo message has a client-only id, won't survive reload, can't be deleted (server returns 404), and `confirmAttachment` marks the attachment `scanned` but nothing ever links it to a message (`message_attachments.message_id` stays NULL — see `routes/photos.js:255`). The TODO at line 1059 documents this. The whole upload pipeline (`uploadIntent`/`confirmAttachment`, `routes/photos.js:188-242`) is reachable but produces orphaned rows. Currently masked because `ATTACHMENTS_ENABLED=false`, but the code is live and a flag-flip ships a broken feature.
- fix: Do not ship attachments until `sendMessage`/`POST /conversations/:id/messages` accepts an `attachmentId`, persists it, and links `message_attachments.message_id`. Until then, delete the dead send-with-attachment branch (or keep it clearly behind the flag with a test). Don't fabricate server ids on the client.

### [ERROR] 🔴 — `getConversations` unread-badge filter reads a key that the normaliser does not normalise
- where: `src/messaging/MessagingApp.jsx:36` (`arr.filter(c => c.hasUnread)`) vs `src/api.js:199-209` (`normaliseConversationList`).
- issue: This one currently works only by accident. `normaliseConversationList` spreads `...c`, so the server's `hasUnread` survives, and it ALSO adds an `unread` alias. The app then reads `c.hasUnread` here but `c.started`/`c.unread` elsewhere — two parallel naming conventions for the same data. Any future cleanup that drops the raw `hasUnread` in favour of the normalised `unread` (the obvious refactor, since that's why the alias exists) silently zeroes the unread count. Fragile coupling between the client normaliser and three different consumer keys (`hasUnread`, `unread`, `started`).
- fix: Pick one canonical field (`unread`) in the normaliser, map the server's `hasUnread`→`unread` there, and have every consumer read `unread`. Remove the raw passthrough so the two can't diverge.

---

## 🟠 Likely bugs / fragile patterns

### [ERROR] 🟠 — Confirmed: clipboard `writeText` can reject with `NotAllowedError` (SafetyScreen) — plus siblings
- where: `src/SafetyScreen.jsx:169-173` (`copyText`), consumed at `:359-371` (`handleCopyScript`) and `:386-407` (`handleSharePlan`).
- issue: `await navigator.clipboard.writeText(text)` at line 171 is NOT wrapped in try/catch. The async clipboard API rejects with `NotAllowedError` when the document isn't focused, permission is denied, or it's a non-secure context. The rejection propagates out of `copyText` (the try/catch at 175-188 only guards the `execCommand` fallback, which is never reached because the early `return true` path throws first). `handleCopyScript` does `const ok = await copyText(...)` with no `.catch`, so a rejection becomes an unhandled promise rejection and the "Couldn't copy" branch never runs. Same for `handleSharePlan`. SIBLINGS with the same uncaught-clipboard shape: none other call `navigator.clipboard` directly (good), but the same swallow-everything anti-pattern recurs in `handleSharePlan`'s `navigator.share` handling — it only catches `AbortError` and lets other share rejections fall through to copy, which then itself can reject uncaught.
- fix: Wrap the `navigator.clipboard.writeText` call in try/catch inside `copyText` and fall through to the `execCommand` fallback on rejection (return `false` if both fail). The callers already handle `ok === false` gracefully.

### [ERROR] 🟠 — Two independent socket.io connections per authed user; app-level badge double-counts
- where: `src/App.jsx:869-891` (app-level socket) and `src/messaging/ConversationScreen.jsx:867-909` (per-conversation socket).
- issue: When the Messages tab is open with a thread, the user holds TWO socket connections (app-level + conversation-level), both subscribed to `new_message`. The app-level one increments `unreadCount` for any non-`messages` tab; the conversation one appends to the thread. They don't double-count the badge (guarded by `activeTabRef`), but every authed user permanently holds an app-level socket for badge purposes, and opening/closing threads churns a second connection. The conversation socket re-`io()`s on every `conversationId`/`currentUserId` change (dep array line 909), so rapid thread switching opens/closes sockets in a tight loop. Fragile and wasteful; also the app-level socket's `new_message` handler has no de-dup, so a message the user is actively viewing still bumps the count the instant they switch away.
- fix: Consolidate to a single app-level socket and have ConversationScreen subscribe via a shared context/emitter rather than opening its own connection. At minimum, memoize the connection so it isn't torn down on every `currentUserId` change (that value is stable per session).

### [ERROR] 🟠 — `markConversationRead` fire-and-forget races the list refresh; unread can flicker back
- where: `src/messaging/MessagingApp.jsx:95-99` (`handleSelectConversation`) and `:45-50` (refresh-on-list effect).
- issue: Selecting a conversation calls `markConversationRead(id).catch(() => {})` without awaiting. Navigating back to the list bumps `refreshKey` (line 47), re-fetching conversations. If the read-write hasn't committed server-side before the list re-fetch returns, the conversation re-appears as unread. No ordering guarantee between the unawaited PUT and the subsequent GET. Also `onUnreadCount(0)` is called unconditionally on entering the list (line 48), which can disagree with the freshly-fetched `hasUnread` count set at line 35-37 a moment later — two writers to the same badge.
- fix: Await `markConversationRead` (or optimistically clear `hasUnread` on the local conversation object) before triggering the refresh, and let the fetched count be the single source of truth for the badge.

### [ERROR] 🟠 — Optimistic swipe removes the candidate before the server confirms; failures are swallowed with no resync
- where: `src/SuggestionScreen.jsx:510-560` (`handleInterested`/`handleNotNow`/`handleSkip`).
- issue: All three handlers `setQueue(q => q.slice(1))` immediately, then `await swipe(...)` and silently swallow any error (`catch {}`). If the swipe POST fails (network, 409 already-swiped, 500), the candidate is already gone from the deck with no restoration and no error surfaced. For a "like" that fails, the user believes they expressed interest but the server never recorded it — they'll never match. A double-tap before state settles can also fire two swipes on the same person (the second hits the server's UNIQUE-constraint 409, swallowed). No double-submit guard.
- fix: On swipe failure, restore the candidate to the front of the queue and show a calm retry affordance (at least for `like`). Add an in-flight guard to prevent double-submit. `skip` failures can stay silent but should still not desync the deck.

### [ERROR] 🟠 — `handleBlockReportSubmit` dereferences `currentConvo.otherUser.userId` without a null guard
- where: `src/messaging/MessagingApp.jsx:134-147`.
- issue: `const otherUserId = currentConvo.otherUser.userId;` — `currentConvo` is derived (line 68-71) and can be `null` if `selectedConversationId` points at a conversation no longer in either list (e.g. it was just unmatched/archived in another tab, or the lists refreshed mid-action). The block-report pane is only rendered when `currentConvo` is truthy, but the submit handler is an async callback that can fire after a state change nulls it. A null deref throws inside an async handler → unhandled rejection, block/report silently lost. (Contrast `handleUnmatchConfirm` at :112-114 which DOES use optional chaining — inconsistent.)
- fix: Guard at the top: `if (!currentConvo?.otherUser) return;`. Apply the same optional-chaining consistently across all four conversation action handlers.

### [ERROR] 🟠 — Inactivity-warning effect intentionally omits deps (stale-closure risk on the eslint-disable)
- where: `src/App.jsx:712-759` (note `// eslint-disable-line react-hooks/exhaustive-deps` at 759).
- issue: The effect closes over `INACTIVITY_WARN_MS`/`INACTIVITY_GRACE_S` (module-constant-like, fine) but the disable comment hides the fact that it also relies on `setShowInactivityWarning` etc. This one is actually OK because all referenced setters are stable and the constants are defined in-component as literals — but the blanket eslint-disable is a latent trap: if someone later references `activeTab` or another piece of state inside `startWarningCountdown`, it'll silently capture a stale value with no lint warning. The house rule "all hooks before early return" is satisfied here (good), but the disable defeats the dep-array safety net.
- fix: Move `INACTIVITY_WARN_MS`/`INACTIVITY_GRACE_S` to module scope (they're constants) and remove the eslint-disable so the dep array is actually checked. Or list the true deps.

### [ERROR] 🟠 — `parseInt` without radix on query params (matching)
- where: `server/src/routes/matching.js:29-30` (`parseInt(req.query.offset)`, `parseInt(req.query.limit)`).
- issue: `parseInt` is called without a radix. Modern engines default to base-10 for non-`0x` strings so this is benign today, but it's the same family of latent bug the messaging route deliberately avoided (`parseInt(req.query.limit, 10)` at `messaging.js:146`). Inconsistent. A query like `?offset=0x10` would parse as 16.
- fix: Add the radix: `parseInt(req.query.offset, 10)`.

---

## 🟡 Smells

### [ERROR] 🟡 — Coarse-location ZIP-strip regex is duplicated 5× and is a fragile heuristic
- where: `server/src/routes/matching.js:60, 218, 290, 321` and described in candidates; the regex `replace(/[\s,]*\d{4,}(-\d+)?\s*$/, '').replace(/[\s,]+$/, '').trim()`.
- issue: The privacy-critical "never expose precise ZIP" rule is enforced by copy-pasting the same regex into four call sites. If one copy is edited or a new endpoint forgets it, a precise ZIP leaks (a safety regression, not just a smell). The regex only strips trailing 4+ digit runs — a city stored as "12345 Phoenix" or "Phoenix 85004 AZ" (digits not trailing) would pass through. This is a coarse-location house rule; it deserves one shared, tested helper.
- fix: Extract `coarseCity(distCity)` into `utils/metros.js` (or a new `utils/location.js`), use it at all call sites, and store/normalise location coarsely at write time so the strip isn't the only line of defence.

### [ERROR] 🟡 — `useFocusable` hook re-declared in ~12 files (copy-paste)
- where: identical `useFocusable` + `focusRing` in `App.jsx:28-37`, `SafetyScreen.jsx:12-21`, `SuggestionScreen.jsx:43-52`, `ProfileScreen.jsx:13-22`, `ConversationScreen.jsx:24-33`, `OnboardingScreen.jsx:6-15`, `AuthScreen.jsx:5-14`, `AdminScreen.jsx:37-46`, `EmptyConversationState.jsx:6-15`, and more.
- issue: The same 10-line hook and `focusRing`/`usePrefersReduced` constants are duplicated across the codebase. Any focus-ring design change requires editing a dozen files; they will drift.
- fix: Move `useFocusable`, `focusRing`, and `usePrefersReduced` to a shared `src/hooks.js` (or into `tokens.js`/a `a11y.js`) and import.

### [ERROR] 🟡 — `commStyleChips` / comms-sensory chip mapping duplicated across 3 components
- where: `SuggestionScreen.jsx:135-154` (`commStyleChips`), `MatchProfileModal.jsx:9-24` (`commChips`), `ProfileScreen.jsx:1273-1285` (inline chip build).
- issue: The same value→label mapping ("direct"→"Direct", "quiet"→"Quiet settings", …) is reimplemented three times with subtly different inline copies. Adding a new sensory option means editing three places; they can disagree.
- fix: One shared `commSensoryChips(person)` helper imported by all three.

### [ERROR] 🟡 — Magic numbers scattered (conversation cap, message limit, sizes, timers)
- where: e.g. `messaging.js:90,238` active cap `5` (also `activeCap: 5` hardcoded in two places); `messaging.js:266` body length `2000` (duplicated as `MAX_BODY` on the client `ConversationScreen.jsx:38`); `photos.js:11-12` `MAX_FILE_SIZE`/`MAX_PHOTOS` (client re-hardcodes 10MB at `ConversationScreen.jsx:1001`); inactivity `20*60*1000` / `120` (`App.jsx:701-702`).
- issue: Client and server independently hardcode the same limits (2000-char body, 10MB upload, 6 photos, 5-convo cap). They can drift, producing confusing mismatches (client allows what server rejects or vice versa).
- fix: Centralise shared limits (a small constants module per side) and, where they must agree client/server, document the coupling or expose them via an API/config response.

### [ERROR] 🟡 — Reaction-summary `userReacted ?? youReacted` key tolerance papered over in 4 places
- where: `ConversationScreen.jsx:856, 902, 968, 1216` (`r.userReacted ?? r.youReacted`).
- issue: The client tolerates two server field names for the same boolean (`userReacted` vs `youReacted`) in four spots. This indicates the server contract was never pinned down. Defensive, but it hides which name the server actually sends and invites the wrong one to be relied on.
- fix: Confirm the server's field name (`getReactionSummary` in `routes/reactions.js`) and use it consistently; drop the `??` tolerance once aligned.

### [ERROR] 🟡 — Broad empty `catch {}` swallows errors throughout (no logging, no surfacing)
- where: pervasive — e.g. `MessagingApp.jsx:87, 98, 120, 139, 143, 150`; `SuggestionScreen.jsx:524, 541, 557`; `api.js:52, 99-105`; `App.jsx:602, 607, 653, 827`.
- issue: Dozens of `catch {}` / `.catch(() => {})` with no logging. Some are legitimately best-effort (sign-out, push), but many hide real failures (block/unblock, archive, unmatch, swipe). When something silently fails in prod there's zero signal. Inconsistent with the server's careful central error logger.
- fix: For user-affecting actions, surface a calm error or at least `console.warn`. Reserve fully-silent catches for genuinely fire-and-forget telemetry/push.

---

## ⚪ Style / minor

### [ERROR] ⚪ — Unused imports / dead identifiers
- where: `SafetyScreen.jsx:1` imports `useCallback` used heavily (fine) but the module-level comment claims "No backend calls" (line 6) while it imports and calls `getMyReports`/`getBlockedUsers`/`unblockUser` — stale comment. `ConversationScreen.jsx` imports `getUserId` (line 3) but `currentUserId` is passed as a prop and `getUserId` is unused in this file.
- issue: Stale comment actively misleads (claims client-only; it makes 2 API calls on mount). Unused imports add noise.
- fix: Update the SafetyScreen header comment; remove the unused `getUserId` import.

### [ERROR] ⚪ — `attachment.status === "rejected" ? t.surfaceAlt : t.surfaceAlt` — both branches identical
- where: `src/messaging/ConversationScreen.jsx:1566`.
- issue: Ternary returns the same value on both branches (`background:` in the attachment status banner). Dead branch; intent unclear (likely meant a different rejected colour).
- fix: Remove the ternary or use the intended distinct colour for the rejected state.

### [ERROR] ⚪ — `Spectrum-Dating-Server` has no `dotenv` guard ordering note; `uncaughtException` exits but `unhandledRejection` only logs
- where: `server/src/index.js:94-100`.
- issue: `unhandledRejection` logs but does not exit; `uncaughtException` exits. An unhandled promise rejection can leave the process in a half-broken state running indefinitely. Minor, but inconsistent recovery posture.
- fix: Decide a policy — either treat unhandled rejections as fatal (log + exit for clean restart) or ensure all async paths are guarded (they mostly are via `.catch`).

---

## TODO / FIXME inventory

Full enumeration (exhaustive grep of `TODO|FIXME|HACK|XXX|@deprecated` across both `src` trees):

- `src/messaging/ConversationScreen.jsx:1059` — `// TODO: backend message-attachment linking — sendMessage does not yet accept an attachmentId, so the photo is shown optimistically via publicUrl and the text body (if any) is persisted on its own.` (corresponds to the 🔴 attachment finding above).

No `FIXME`, `HACK`, `XXX`, or `@deprecated` markers found anywhere in either codebase. Note: many "Security Fix N" / "A11y Blocker N" / "backlog #N" inline comments exist but are not TODO-style debt markers.

---

## Tests / linting / CI

- **No automated tests.** No `vitest`, `jest`, `mocha`, or any `test` script in either `package.json`; no `*.test.*` / `*.spec.*` files; no `__tests__` dirs.
- **No linting.** No ESLint config (`.eslintrc*`, `eslint.config.*`) in either repo — despite eslint-disable comments in `App.jsx:759` referencing rules that aren't enforced. No Prettier config.
- **No CI.** No `.github/` (workflows) in either repo. Deploys go through a custom `scripts/deploy.mjs`.

### [FEATURE] 🟠 — Add a test + lint + CI baseline
- where: both repos (`Spectrum-Dating`, `Spectrum-Dating-Server`).
- issue: A dating app handling auth, JWT, blocking/reporting, and idempotent migrations has zero automated coverage and no linter. The hooks-before-early-return house rule, the dep-array correctness, and the migration-idempotency invariant are all enforced only by manual review. The `eslint-disable` comments are no-ops with no ESLint installed.
- fix: (1) Add ESLint + `eslint-plugin-react-hooks` (catches the hooks-order + exhaustive-deps house rules automatically) to the frontend; (2) add Vitest for the matching/scoring + coarse-location helpers and a few API-client unit tests; (3) add a server-side test that boots the DB twice to assert migration idempotency (would have caught the 🔴 db.js bug); (4) a minimal GitHub Actions workflow running lint + tests on PR.
