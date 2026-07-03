# Round 2 — Functional QA Audit — Spectrum Dating (RELAUNCH)

Dimension: behavioral/functional defects on the LIVE site, with Chrome driver access granted.
Live site: https://spectrum-dating-eta.vercel.app · API: https://spectrum-dating-server-production.up.railway.app
Tested as: sample user **Mira K.** (mira.k.1) on desktop (1920px viewport). Focus: the R1 coverage gaps —
failed-send retry, consent-gate (403), rate-limit (429), archived conversations, pause/verification, match-moment.
Date: 2026-06-30. Driver: Claude-in-Chrome (Browser 1, local). Permission note: `tabs_context_mcp`, `find`,
and a couple of other calls were intermittently denied this session; I worked around with standalone `navigate`
(which front-loads tab context), coordinate clicks, and the `javascript_tool`. No blanket Chrome denial — testing proceeded.

Method note: error-state UIs (failed-send / 403 / 429) were exercised by injecting a client-side `fetch` override
that fails/synthesizes ONLY the relevant POST. **No injected failure ever reached the server** — verified by
network capture (the blocked requests do not appear) and by post-test API reads. Zero server-side mutations from these tests.

---

## NEW this round

### [ERROR] 🟠 — A failed "I'm interested" like is silently lost; candidate is removed from the deck with a *success* confirmation
- where: /?tab=suggestions (Discover); desktop. **Live confirmation of known issue E9.**
- repro (live, reproduced):
  1. On the Discover card (Ana Beltran), inject a network failure on `POST /matching/swipe` (simulates any real-world blip/offline).
  2. Click **"I'm interested"**.
  3. UI immediately shows the full success state: *"Saved. You said you're interested in Ana Beltran. If Ana Beltran also says they're interested, you'll both be able to message each other…"* with a **"Next person"** button.
  4. Network capture: **no `/matching/swipe` request reached the server** — the like was never recorded. Ana is gone from the local deck. No error, no retry, no resync.
- expected vs actual: A failed like should surface an error and offer retry (as the *messaging* composer correctly does — see below), or at minimum keep the candidate in the deck. Actual: the like is dropped silently AND the person is consumed from the queue, so the user may never see them again to re-like. For a dating product this is a real missed-connection / data-integrity bug.
- contrast: the messaging composer handles the same failure gracefully (shows "Didn't send. Retry"); Discover does not — inconsistent resilience.
- file:line: `src/SuggestionScreen.jsx:518-527` — `handleInterested()` does `setQueue(q => q.slice(1))` *before* `await swipe(...)`, and the `catch {}` at :524 swallows the failure with the comment "Swipe failed — already removed from queue, proceed gracefully." Same pattern in `handleNotNow`/`handleSkip` (:530-560), but those are low-stakes; the **like** path is the damaging one.

### [ERROR] 🟡 — Deleting an unsent (failed) message fires a doomed `DELETE …/messages/temp-<id>` → 404
- where: /?tab=messages → thread → unsent message → ⋯ → Delete message; desktop
- repro (live, reproduced):
  1. With `POST /messages` failing (offline), send a message → it shows "Didn't send. Retry".
  2. Open the message's ⋯ menu → "Delete message" → confirm.
  3. Network: `DELETE …/conversations/<id>/messages/temp-1782863291144` → **404** (the id is a client-fabricated `temp-` id that the server never knew about).
- expected vs actual: An unsent/never-persisted message should be discarded purely client-side with no network call. Actual: a 404-bound DELETE is issued for a temp id. The message body does clear, but momentarily an **orphaned empty "Didn't send / Retry" stub** is left behind (cleared on reload — purely local junk).
- corroborates E2's note that the client fabricates `temp-`/client-only message ids.
- file:line: `src/messaging/ConversationScreen.jsx` (delete handler ~`:1161-1181`); the temp-id fabrication is in the send path (~`:1034-1099`).

### [DESIGN] 🟡 — Unsent-message delete shows the same scary "This can't be undone" dialog as a real delete
- where: /?tab=messages → unsent message → ⋯ → Delete; desktop
- repro: Deleting a message that *never sent* pops "Delete message? **Are you sure? This can't be undone.**" — identical to deleting a persisted message.
- expected vs actual: For a local-only discard there is nothing irreversible to warn about. Copy should be "Discard unsent message?" with no permanence warning. Actual: misleading, mildly alarming copy for a no-op-on-server action — extra weight for an audience that values clarity.
- file:line: `src/messaging/ConversationScreen.jsx` confirm-delete dialog (~`:1161-1181`).

### [FEATURE/DESIGN] 🟡 — A paused profile can still browse and like in Discover, with no "you're paused" reminder
- where: /?tab=profile (Pause my profile = ON) then /?tab=suggestions; desktop
- repro (live, reproduced + restored): Toggled Pause ON, Saved (persisted: `paused:true` confirmed via `GET /profile/me`). Discover still renders candidates and the "I'm interested" / "Not right now" / "Skip" actions are fully active — no banner indicating the profile is paused.
- expected vs actual: When paused ("You won't appear in Discover"), most apps either gate Discover behind an "unpause to keep browsing" interstitial or show a persistent "Your profile is paused" banner. Actual: the paused user can silently keep liking people (they're invisible to those people) with no reminder of their paused state — confusing, especially for a clarity-first audience.
- note: Pause itself works correctly (clear explanatory copy on the toggle: "Your profile is paused… Your matches and messages stay."), persists, and unpauses cleanly. The gap is the missing Discover-side indication.

### [DESIGN] 🟡 — Empty active-conversation copy says "No matches yet" when the only match is merely *archived*
- where: /?tab=messages with the sole conversation archived; desktop
- repro: Archive the only conversation → the active list shows the empty state *"No matches yet. Check back soon. Only people you've both matched with can message you."*
- expected vs actual: The user DOES have a match (it's archived, not gone). Copy should distinguish "no active conversations (you have N archived)" from "no matches at all." Actual: inaccurate "No matches yet."
- file:line: empty-state copy in `src/messaging/MatchesListScreen.jsx` / `MessagingApp.jsx`.

### [DESIGN] ⚪ — "Restore" label is clipped in the archived-conversation card (2-pane width)
- where: /?tab=messages → Archived conversations; desktop
- repro: In the Archived view, the per-conversation **Restore** action renders truncated ("Rest…") because the card layout doesn't reserve room for the full label at the 2-pane sidebar width.
- expected vs actual: Full "Restore" label visible. Actual: clipped. (Restore *functions* correctly — clicking it restored the conversation to active.)

### [ERROR] 🟡 — `/auth/forgot-password` has no rate limiting (login and register do)
- where: API `POST /auth/forgot-password`; observed via direct fetch from the logged-in page context.
- repro (live): 12 rapid `POST /auth/forgot-password` for the same/neutral address → **all 200, no 429**. By contrast `POST /auth/login` trips **429 after 8 attempts**, and `/auth/register` is also throttled.
- expected vs actual: An unauthenticated endpoint that triggers email sends + account-existence DB lookups should be throttled. Actual: unthrottled → enables email-bombing of a target address and timing-based enumeration at volume. Extends E8 (no rate limiting on account endpoints) and E18 (enumeration).
- file:line: forgot-password handler in `server/src/routes/auth.js` (limiter present on login/register, absent here).

### [DESIGN] ⚪ — Consent-gate (403) disables the send button but the text input still looks/acts enabled
- where: /?tab=messages, conversation in a 403 (consent-gate) state; desktop
- repro (live, reproduced): Injected `403` on send → red alert "This conversation is no longer available." appears and the **send (↑) button is disabled**, but the composer textarea retains its focus ring / "Write a message…" placeholder and accepts typing.
- expected vs actual: When `composingDisabled` is true the textarea should also be visibly disabled/read-only. Actual: a user can type into a dead composer. Minor.
- file:line: `src/messaging/ConversationScreen.jsx:1026` (`composingDisabled = consentGateFailed || rateLimited`) feeds `sendDisabled` (:1028) but the textarea `disabled` is not clearly bound to it.

---

## Confirms / re-verifies R1 (now exercised LIVE, working as intended)

- **Failed-send retry (messaging)** — WORKS. Injected `POST /messages` failure → optimistic bubble shows **"Didn't send. Retry"** + ⋯ menu. Clicking **Retry** re-fires the send (re-fails while still offline, as expected). No console error leaked; failure handled gracefully. (R1 could not reach this.) `src/messaging/ConversationScreen.jsx:1119-1133`.
- **Consent-gate (403) state** — WORKS. Removes optimistic message, shows `role="alert"` "This conversation is no longer available.", disables send. `ConversationScreen.jsx:1120-1123, :1527-1531`.
- **Rate-limit (429) state** — WORKS. Removes optimistic message, sets a 60s lockout (`RATE_LIMIT_SECONDS=60`), `role="status"` aria-live announces "You're sending messages quickly. Please wait a moment before sending again.", send disabled. `ConversationScreen.jsx:1124-1127`.
- **Archived conversations** — WORKS + reversible. Header ⋯ → Archive moves the conversation to "Archived (1)"; the Archived view ("Tap Restore to move a conversation back…") + per-card Restore returns it to the active list. Empty archived state copy is good ("No archived conversations…").
- **Pause profile** — WORKS + reversible + persists. Toggle ON → clear copy → Save → `paused:true` server-side; toggle OFF → Save → `paused:false`. (See the Discover-reminder gap above.)
- **Login rate limiting** — present and correct (429 after 8 bad attempts), non-enumerable 401s. Register throttled too.
- **MatchMoment overlay** (by code inspection; could not safely trigger live — see Coverage) — `src/MatchMoment.jsx` is a clean presentational overlay: calm opacity-led choreography, reduced-motion end-state, focus-to-heading, Tab focus-trap, Escape→continue, `role="dialog" aria-modal aria-labelledby`. Triggered by `swipe()` returning `{matched:true}` in `SuggestionScreen.jsx:519-523`, rendered at `:928-957`. (E11's "racing mutual-like misses the event" is a server-side emit gap, not reproducible from one client.)
- No console errors or 5xx observed on any screen walked (Discover, Matches, Messages, Profile, Safety).

---

## New surfaces noted (not defects)
- `GET /matching/activity` → `{ incomingLikes, recentMatches }` powers a "People who liked you" row in Matches (`MatchesScreen.jsx:168-261`). For Mira `incomingLikes` is empty, so the liked-you UI couldn't be exercised and **no safe path to a mutual match exists** (would need someone who already liked Mira).
- Profile screen issues `GET /profile/me` **twice** on load (minor duplicate fetch).
- Safety screen makes 3 API calls (`my-reports`, `blocked`, `profile/me`) — the source comment "no backend calls" is stale (nit already in the log).

---

## Coverage

Reached & exercised LIVE (desktop, sample user): failed-send + Retry + delete-unsent; consent-gate 403; rate-limit 429;
archive → archived view → restore; pause → save → persist → unpause; Discover failed-like (E9 live repro); Discover card +
actions; Matches list; Messages thread render + tombstone integrity check; Profile pause/verification sections; Safety load;
forgot-password/login/register rate-limit probing (API). Console + network watched throughout.

Could NOT reach / not safely exercisable:
- **MATCH MOMENT (real mutual match):** not triggered — requires a permanent mutual like. `incomingLikes` is empty, so no candidate has pre-liked Mira; the only path would create a permanent match with a sample profile (avoided). MatchMoment verified by source inspection instead.
- **TRUE MOBILE (<600px):** `resize_window(420×820)` resized the OS window but `window.innerWidth` stayed **1920** (this environment clamps the rendering viewport). Same limitation R1 hit. The 2-pane↔single-pane Messages switch and mobile bottom-nav were NOT visually verified at narrow width. Mobile was **not** tested live.
- **Load-earlier pagination:** the only thread (Eli) has 9 messages; page size is `limit=50`, so there is no "load earlier" to trigger without a 50+ message thread.
- **Empty-deck "All caught up":** 10 candidates in the deck; reaching it requires liking/skipping all 10 (likes irreversible) — not exercised. `AllCaughtUp` illustration present in source; R1 verified "Done for now" escape.
- **Incoming-likes / liked-you UI:** `incomingLikes` empty → not renderable.
- **Verification-request flow:** Mira is already verified ("✓ Your identity is verified"), so the request-submission path isn't shown for this account.
- **Block / unmatch / account-delete:** destructive/irreversible — not executed.

## Sample data touched / restored
- Messages (Mira ↔ Eli): exercised failed-send, 403, 429, and unsent-delete — **all via client-side fetch injection; nothing reached the server.** Post-test API read confirms the thread is unchanged: **9 messages, 4 tombstones** (same as R1's state — zero new tombstones created). Restored.
- Messages: **Archived** the Eli conversation, then **Restored** it. Active list back to 1/5. Restored.
- Profile (Mira): toggled **Pause ON → Saved → Pause OFF → Saved**; verified `paused:false` via API. Restored.
- Discover: injected a failed "I'm interested" on Ana Beltran (client-side only — no `/matching/swipe` reached server); reloaded and confirmed Ana is still candidate #1, deck intact (10 candidates). Restored.
- a11y/localStorage: only read; no theme/toggle changes left applied.
- API probes: 12× forgot-password (neutral address, no account), bad-login + register attempts to probe rate limits (invalid credentials / invalid password → no accounts created, no state changed beyond tripping the transient auth limiter which resets).
- Session: remained logged in as the sample user (Mira K.) — the account that was active at session start. No accounts created. Admin account not touched this round.
