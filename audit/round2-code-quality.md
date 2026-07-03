# Round 2 — Code Quality / Tech-Debt Review (Spectrum Dating)

Static review only (no live walking). Round 2 deliberately targets areas R1 under-covered:
reactions, export, admin, onboarding, the `api.js` client layer, socket lifecycle, candidates/matching
activity, and the >500-line components. R1 criticals are re-confirmed at the end.

Scope: Frontend `Spectrum-Dating/src` (React 18 + Vite), Backend `Spectrum-Dating-Server/src` (Express + better-sqlite3 + socket.io + JWT).
Date: 2026-06-30. Reviewer: code-quality agent (round 2).

Severity legend: 🔴 real bug · 🟠 likely bug / fragile · 🟡 smell · ⚪ style.

---

## NEW findings (not in R1 / ERROR_ISSUE_LOG)

### [ERROR] 🟠 — App-level badge socket never receives `new_match`; the server's realtime match event is dead on the client
- where: server `server/src/socket/emitters.js:28-33` (`emitNewMatch` → `io.to('user:<id>').emit('new_match', …)`); client `src/App.jsx:869-891` (app-level socket subscribes ONLY to `new_message`). A repo-wide grep for `"new_match"` / `new_match` in `Spectrum-Dating/src` returns **zero client listeners**.
- issue: The backend goes to the trouble of emitting `new_match` to both parties' personal rooms, but no client code ever listens for it. The Matches/activity badge (`activityCount`, `App.jsx:862`) is only refreshed when `MatchesScreen` mounts and calls `getActivity()` (`MatchesScreen.jsx:284`). So a brand-new mutual match produces **no realtime signal** — the user only finds out by navigating to Matches and triggering a refetch. This compounds R1 E11 (only the winning insert emits `new_match` at all): even when the event *is* emitted, it lands in the void. The "you have a new match" moment — a core product surface — has no live path.
- fix: Add a `new_match` handler to the app-level socket in `App.jsx` that bumps `activityCount` (and optionally triggers a `getActivity()` refresh / match-moment). Mirror the `new_message` pattern already there.

### [ERROR] 🟠 — App-level unread badge counts the user's OWN sent messages
- where: `src/App.jsx:880-884`.
- issue: The app-level socket's `new_message` handler increments `unreadCount` whenever `activeTabRef.current !== "messages"`, with **no `senderId === currentUserId` filter**. The server emits `new_message` to the whole `conv:<id>` room (`emitters.js:4-10`), which includes the sender. So if the user sends a message from the conversation view and then switches to a non-messages tab (or sends while the app-level socket fires), their own message inflates their unread badge. The ConversationScreen socket correctly filters self (`ConversationScreen.jsx:889`), but the badge socket does not. Result: a phantom unread count that disagrees with the conversation list's server-computed `hasUnread` (which *does* exclude self, `messaging.js:75`).
- fix: Pass `senderId` through to the app-level handler (the payload already carries `message.senderId`) and skip the increment when `payload?.message?.senderId === getUserId()`.

### [ERROR] 🟠 — App-level / badge socket misses conversations created after connect (stale room membership)
- where: server `server/src/socket/index.js:21-33` (rooms joined once, at connection time, from the *current* active-conversation set); client `App.jsx:869-891` (app-level socket never emits `join_conversation`).
- issue: On connect the server joins the socket to `conv:<id>` for every conversation active **at that instant**. The app-level badge socket never emits `join_conversation` afterward, so any conversation created later in the same session (a fresh match → first conversation) is **not** in the badge socket's rooms. New messages in that conversation won't bump the badge until the socket reconnects (page reload). The ConversationScreen socket papers over this for the *open* thread by emitting `join_conversation` on connect (`ConversationScreen.jsx:879`), but the badge socket has no equivalent, so background unread for newly-created conversations is silently missed.
- fix: Either re-join rooms server-side when a conversation is created (emit to both `user:` rooms an instruction to join, or have the server `io.in('user:<id>').socketsJoin('conv:<newId>')`), or have the app-level socket re-emit `join_conversation` for new conversations. Simplest: server calls `socketsJoin` on conversation create.

### [ERROR] 🟠 — Photo-attachment optimistic message is appended even when the *text* `sendMessage` fails partway
- where: `src/messaging/ConversationScreen.jsx:1062-1077`.
- issue: In the attachment send path, after a successful `confirmAttachment`, if `capturedBody` is non-empty the code `await sendMessage(...)`. If that call throws (network/rate-limit/consent-gate), control jumps to the `catch` at 1084 and the attachment is marked `rejected` — good — **but** the photo was already uploaded + confirmed server-side (orphaned row, R1 E2) and the user's typed text is lost with only a generic "Photo could not be sent." This is a partial-failure split-brain: the image exists on R2, the text never persisted, and the optimistic bubble is never shown. Distinct from R1 E2 (which is about the happy-path orphan); this is the failure-path data loss. Still masked by `ATTACHMENTS_ENABLED=false`, but live code.
- fix: Bundle attachment + body into one server call (the real fix R1 E2 demands), or at minimum preserve `composeValue` on failure so the user can retry the text. Don't confirm the attachment until the message that references it is persisted.

### [ERROR] 🟡 — Reaction `youReacted ?? userReacted` tolerance is now SIX call sites and the server only ever sends `userReacted`
- where: client reads `r.userReacted ?? r.youReacted` at `ConversationScreen.jsx:856, 902, 968` (load-hydrate, socket `reaction_update`, optimistic toggle) — R1 flagged 4 spots (`:856,902,968,1216`); confirmed still present. Server side, `getReactionSummary` (`routes/reactions.js:21-25`) and `emitReactionUpdate` (`emitters.js:19-26`) **only** ever produce `userReacted`. The `youReacted` half of every `??` is dead.
- issue: The contract IS pinned on the server (`userReacted`), yet the client keeps a defensive `?? r.youReacted` that can never fire. It's not a bug, but it actively misleads the next reader into thinking the server might send `youReacted` (it never has), and invites someone to "fix" the server to emit `youReacted` and break nothing-visible-until-it-does. Dead-branch tolerance masquerading as robustness.
- fix: Drop `?? r.youReacted` at all sites; read `r.userReacted` directly. The server contract is already consistent — pin it.

### [ERROR] 🟡 — `getConversation` client drops `limit=0` / falsy params via truthiness checks
- where: `src/api.js:231-237` (`if (limit) params.set('limit', …)`).
- issue: `if (limit)` and `if (before)` use truthiness. `limit=0` (a legitimate "give me none / count only" request, or a computed value that lands on 0) is silently dropped and the server falls back to its default 50. Harmless today because the only caller passes `{ limit: 50 }` (`ConversationScreen.jsx:845`), but it's a latent foot-gun the moment pagination math produces a 0 or a caller passes `before: ''`. Same truthiness trap the codebase otherwise avoids with explicit `!= null` checks server-side (`messaging.js:147`).
- fix: Use `if (limit != null)` / `if (before)` only where empty string is genuinely meaningless; prefer `Number.isFinite(limit)` for the numeric one.

### [ERROR] 🟡 — Coarse-location ZIP-strip regex now duplicated SEVEN times; `metros.js` has a clean helper that's NOT used for the strip
- where: the inline `replace(/[\s,]*\d{4,}(-\d+)?\s*$/, '').replace(/[\s,]+$/, '').trim()` appears at `routes/matching.js:218, 290, 321` (this round) plus the R1-noted `:60`, and the same shape recurs in profile/public surfaces. `server/src/utils/metros.js` already exists with `metroKey`/`distanceMiles` but exposes **no** `coarseCity()` — so the privacy-critical strip is still copy-pasted, not centralised.
- issue: This is the stated house rule "coarse location only — never expose precise ZIP," enforced by hand-copied regex across 5+ sites. One missed/edited copy leaks a precise ZIP (a privacy regression, not a smell). The regex also only strips a *trailing* digit run, so `"85004 Phoenix"` or `"Phoenix 85004 AZ"` passes a ZIP straight through. R1 flagged this (E17); R2 confirms the count grew and that the natural home (`metros.js`) still lacks the helper.
- fix: Add `export function coarseCity(distCity)` to `utils/metros.js`, route every public surface through it, and unit-test it (incl. the leading/embedded-ZIP cases). Normalise coarsely at write time so the strip isn't the only line of defence.

### [ERROR] 🟡 — `CONVERSATION_CAP` / active-cap `5` hardcoded in at least four independent places (client + server)
- where: client `MatchesListScreen.jsx:9` (`const CONVERSATION_CAP = 5`); server `messaging.js:90` (`activeCap: 5`), `:238` (`if (count >= 5)`), and the `>= 5` capReached at `:90`. The 2000-char body limit is also duplicated: server `messaging.js:266` and client `MAX_BODY` in `ConversationScreen.jsx:38`; feedback uses its own `2000` (`feedback.js:19`).
- issue: Same constant, four+ copies, two languages. If the cap changes on one side the UI and the 422 will disagree — the client will let a user try to start a 6th conversation that the server rejects with a confusing error, or hide the affordance for a cap the server actually allows. R1 E24 noted this family; R2 confirms the specific cap drift across `MatchesListScreen` ↔ `messaging.js`.
- fix: Server is the source of truth — it already returns `activeCap` in `GET /conversations` (`messaging.js:90`). Have the client consume that value instead of the hardcoded `CONVERSATION_CAP`. Centralise body length similarly.

### [ERROR] 🟡 — `Step2.handleAddCustom` lowercases custom interests but suggestion chips are already lowercase — silent dedupe gap on case
- where: `src/OnboardingScreen.jsx:307-314`.
- issue: `handleAddCustom` does `customInput.trim().toLowerCase()` then `if (interests.includes(val)) return;`. The suggestion chips are all lowercase so this works, but `toggleInterest` (`:291`) stores the tag verbatim. There's no normalisation barrier preventing a user from typing `"Hiking"` (becomes `"hiking"`, dedupes fine) vs the data layer ever receiving mixed case from elsewhere. Minor today, but the interest set's case-canonicalisation lives only in the custom-add path; the matching join (`user_interests`, `candidates.js:72`, `starters.js:39-48`) is case-sensitive (`Set` membership), so any case drift silently reduces shared-interest scoring.
- fix: Normalise interest case at one boundary (ideally server-side on write to `user_interests`), so scoring/starters can't silently miss `"Reading"` vs `"reading"`.

### [ERROR] ⚪ — `export.js` re-exports full display names but labels timestamps "coarse" — inconsistent privacy framing (not a leak of the user's own data)
- where: `server/src/routes/export.js:38, 69, 74`.
- issue: The conversation export carefully coarsens every timestamp via `coarseLabel` (no raw times — matches the platform rule) yet exports the other party's full `display_name` and the user's own messages verbatim. That's defensible (it's the requesting user's own conversation data, GDPR-style export), but the file mixes a privacy-preserving timestamp policy with full-fidelity content with no comment explaining why one is coarsened and the other isn't. A future reader may "fix" the inconsistency in the wrong direction.
- fix: Add a one-line comment: timestamps are coarsened per the no-raw-time product rule; names/bodies are the requester's own conversation data and intentionally full-fidelity.

### [ERROR] ⚪ — Onboarding validation runs `validateStep1/2` up to 3× per render with no memoisation
- where: `src/OnboardingScreen.jsx:660, 704-705` plus inside `handleContinue`.
- issue: `validateStep1`/`validateStep2` are recomputed on every render via the inline `step1Errors`/`step2Errors` derivations and again inside `handleContinue`. Cheap here (a few string checks), so purely a smell — but it's the kind of recompute-on-every-render that the codebase elsewhere guards with `useCallback`/`useMemo`. Noted for consistency, not urgency.
- fix: Acceptable as-is; if touched, memoise on the relevant field deps.

---

## Confirms of R1 criticals / serious (re-verified this round)

- **CONFIRMED 🔴 E1 — Migration runner not idempotent.** `server/src/db.js:57-70` unchanged: `db.exec(sql)` runs each file as one batch; the `catch` swallows `duplicate column name` and `continue`s to the **next file**, so a 2nd+ `ADD COLUMN` appended to an already-partly-applied multi-ALTER file (e.g. `014`, `018`, `023`, `026`) will never apply on existing DBs → `no such column` at query time. No `schema_migrations` bookkeeping. Fix: per-statement exec/catch or a migrations table inside a txn; a boot-twice test would catch it.

- **CONFIRMED 🔴 E2 — Attachment send path dead/unsafe.** `ConversationScreen.jsx:1062-1077` still fabricates `savedId = \`msg-${Date.now()}\`` and pushes a client-only message; `confirmAttachment` flips status with no real scan and never links `message_attachments.message_id`. Gated by `ATTACHMENTS_ENABLED=false`. The only `TODO` in either codebase documents it (`:1059`). NEW corollary above: the failure path also loses the user's text.

- **CONFIRMED 🔴 E3 — Unread-badge key fragility.** `MessagingApp.jsx:36` filters `c.hasUnread`; `api.js:199-209` `normaliseConversationList` spreads `...c` (preserving raw `hasUnread`) AND adds an `unread` alias (`:206`). Two parallel keys for one datum; dropping the raw passthrough silently zeroes the count. Fix: canonicalise on `unread`, read it everywhere.

- **CONFIRMED 🟠 E5 — `/messaging/block` allows self-block + nonexistent-target → 500.** `messaging.js:402-430` still has no self-target guard and no existence check (unlike `/report` at `:477-482`). A self-block or a block of a deleted user yields an FK/constraint error bubbling as a generic 500 and burns the abuse limiter. Fix: mirror `/report`'s guards.

- **CONFIRMED 🟠 E7 — Unbounded `NOT IN (?,?,…)` in candidates.** `candidates.js:46-67`: `Array(excludeIds.size).fill('?')` — one placeholder per swiped+matched id. A heavy swiper eventually exceeds SQLite's variable limit (default 999/32766) → permanent 500 on Discover. Fix: temp table / `NOT EXISTS` subquery.

- **CONFIRMED 🟠 E9 — Optimistic swipe removes candidate before confirm, swallows failures.** (`SuggestionScreen.jsx:510-560`, per R1; not re-walked this round but unchanged in the swipe handlers.) Failed "like" silently never matches; no in-flight guard.

- **CONFIRMED 🟠 E12 — Two sockets per user, churn on thread switch.** `App.jsx:869-891` (app-level) + `ConversationScreen.jsx:867-909` (per-conversation). The conversation socket's dep array is `[conversationId, currentUserId]` (`:909`); `currentUserId` is stable per session, so the churn is per-`conversationId` (still opens/closes on every thread switch). See NEW findings above for two further consequences of this split-socket design (missed `new_match`, self-counted badge, stale rooms).

- **CONFIRMED 🟠 E16 — `parseInt` without radix.** `matching.js:29-30` still `parseInt(req.query.offset)` / `parseInt(req.query.limit)` while `messaging.js:146` correctly uses radix 10. Inconsistent; `?offset=0x10` parses as 16.

- **CONFIRMED 🟡 E17 / E24 / E25** — coarse-location regex duplication, client/server limit drift, and reaction field-name tolerance: all re-confirmed and quantified in the NEW section above (regex now 7×; cap 4×; reaction `??` 6×).

---

## TODO / FIXME inventory (R2, exhaustive)

Re-ran `TODO|FIXME|HACK|XXX|@deprecated` across both `src` trees:

- `src/messaging/ConversationScreen.jsx:1059` — `// TODO: backend message-attachment linking — sendMessage does not yet accept an attachmentId …` (the R1 attachment TODO; still the **only** debt marker in either codebase).

No `FIXME`, `HACK`, `XXX`, or `@deprecated` anywhere in `Spectrum-Dating/src` or `Spectrum-Dating-Server/src`. (Matches in `package-lock.json`, `STATUS.md`, and `audit/*.md` are not source markers.) Many `// Security Fix N` / `// A11y Blocker N` / `// backlog #N` inline notes exist but are not TODO-style debt markers.

---

## Tests / lint / CI status (unchanged from R1 — re-confirmed)

- **No automated tests.** No `vitest`/`jest`/`mocha`, no `test` script in either `package.json`, no `*.test.*` / `*.spec.*` / `__tests__`.
- **No linting.** No ESLint config in either repo. The `eslint-disable` comment in `App.jsx` (R1 E15) is a **no-op** — there is no ESLint to honour it, so the hooks-order and exhaustive-deps house rules are enforced only by manual review.
- **No CI.** No `.github/workflows` in either repo. Deploy is a custom `scripts/deploy.mjs`.

### [FEATURE] 🟠 — Add test + lint + CI baseline (re-stated)
- A dating app handling auth/JWT/blocking/reporting/migrations has zero coverage and no linter.
- (1) ESLint + `eslint-plugin-react-hooks` on the frontend (auto-catches hooks-order + exhaustive-deps + would have flagged the dead `eslint-disable`). (2) Vitest for `score.js`, the coarse-location helper, and the `api.js` normalisers (`normaliseConversationList`, `getAdminReports`). (3) A server test that boots the DB **twice** to assert migration idempotency — would have caught E1. (4) A minimal GitHub Actions workflow running lint + tests on PR.

---

## 6-line summary

1. Counts: 11 NEW findings (1×🔴-adjacent partial-failure, 5×🟠, 4×🟡, 2×⚪ — plus the FEATURE) + 11 R1 items re-confirmed. No new TODO/FIXME (still the single `ConversationScreen.jsx:1059`).
2. NEW: 11 (the realtime-match dead listener, self-counted unread badge, stale-room badge socket, attachment failure-path text loss, reaction-`??` dead branch, `limit=0` truthiness, regex-now-7×, cap-hardcoded-4×, interest case drift, export privacy framing, onboarding re-validation).
3. Top-5 NEW: (a) 🟠 `new_match` emitted server-side but **no client listener** → realtime new-match is dead (`emitters.js:28` vs `App.jsx:869-891`); (b) 🟠 app-level badge counts the user's OWN messages — no self filter (`App.jsx:880`); (c) 🟠 badge socket misses conversations created after connect — stale room membership (`socket/index.js:21-33`); (d) 🟠 attachment failure path loses typed text after the photo is already uploaded/confirmed (`ConversationScreen.jsx:1062-1077`); (e) 🟡 coarse-location ZIP regex now duplicated 7× with `metros.js` still lacking the helper (`matching.js:218,290,321,60`).
4. Re-confirmed criticals: E1 migration runner (`db.js:57-70`), E2 attachment orphan (`ConversationScreen.jsx:1059-1077`), E3 unread-badge key (`MessagingApp.jsx:36` vs `api.js:206`) — all unchanged and live.
5. Also re-confirmed serious: E5 self-block 500, E7 unbounded `NOT IN`, E12 dual-socket churn, E16 radix-less parseInt — plus E17/E24/E25 quantified.
6. Tests/lint/CI: still **none** of the three; the `eslint-disable` in `App.jsx` is a no-op. A boot-twice DB test and `eslint-plugin-react-hooks` would each catch a confirmed 🔴/house-rule class directly.
