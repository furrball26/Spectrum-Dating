# Spectrum Dating — Opt-in "Message Request / Intro" (build spec)

**Designed 2026-07-04** by the trust-safety lens. Lets a member reach a non-match WITHOUT
breaking the consent/safety model. Owner approved the opt-in model; **re-send policy locked:
ONE directed intro per person, EVER (no re-send after decline; edit-while-pending is the
typo escape hatch).**

## Core safety insight (the whole design rests on this)
An intro NEVER creates a parallel messaging path. **Pre-accept there is NO conversation, room,
or socket between the pair — only ONE screened text row.** ACCEPT mints a real `match` +
`conversation` via the EXACT existing path (`matching.js:153-177` canonical order + UNIQUE
dedupe, `messaging.js:317-327` room join), so all existing safety (block-drops-room BE-5,
unmatch, convo cap, report, candidate exclusion) applies automatically with zero new code.

## Data model — `047_message_requests.sql` (CREATE TABLE IF NOT EXISTS; append to db.js ordered list)
```sql
CREATE TABLE IF NOT EXISTS message_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intro TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, decided_at INTEGER,
  UNIQUE(sender_id, recipient_id)          -- one directed intro per pair, EVER (never deleted)
);
CREATE INDEX IF NOT EXISTS idx_msgreq_recipient ON message_requests(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_msgreq_sender ON message_requests(sender_id, status);
```
`UNIQUE(sender,recipient)` + never-delete = the one-shot backbone (mirrors swipes one-shot).
`conversation_id ON DELETE SET NULL` = intro text survives convo delete (mod trail, per 043/044).

## Send — `POST /messaging/requests` {recipientId, intro}. Guard ORDER matters (indistinguishable responses)
1. requireAuth + new `introRequestLimiter` (own bucket). 2. self → 400. 3. recipient missing →
**generic 201 {ok:true}, insert nothing** (no existence leak). 4. recipient suspended → generic
success, nothing. 5. **block either dir** (`isBlocked` messaging.js:64) → **generic success,
nothing** (blocked prober learns nothing). 6. already matched (either dir) → generic success,
nothing. 7. **existing row either dir** (any status sender→recip, or pending recip→sender) →
generic success, nothing (enforces no-re-spam AND hides decline). 8. intro trim, 1..**300** chars.
9. `containsSlur` → hard 400 (own text, safe to surface). 10. `hasSafetySignal` (links/contact/
money) → **block first-contact** with calm copy + auto-flag to mods (STRICTER than in-chat, where
it's only informational — unsolicited off-platform/money is the #1 grooming/scam opener).
**Rate limits:** `introRequestLimiter` 5/hr + 15/24h; durable DB pending cap ≤10 (survives Railway
restart). `PATCH /messaging/requests/:id` (sender, pending-only) edits intro, re-runs 8-10.

## Recipient — `GET /messaging/requests` (inbound pending only)
Returns id, intro, coarse `createdAt` (coarseLabel, never raw ms), + sender's **Discover-level
projection ONLY** (coarse city; NEVER context_card/helps_me/hard_for_me — those are post-match).
Separate "Requests" area in `MessagingApp.jsx` (NOT the inbox). **Quiet count only** — no push,
no red dot, no "N want to talk," no urgency (calm-by-design hard rule). No push on new intro
(intros are quieter than matches — contrast matching.js:184-194).
- **Accept** `POST /messaging/requests/:id/accept`: re-check block → if blocked, silently set
  declined, no convo. Enforce recipient `activeConvoCount` cap 5 (messaging.js:70-79) → 422 if full,
  stays pending. In ONE txn: insert `matches` canonical-order + UNIQUE dedupe (reuse
  matching.js:153-177), create conversation + `joinConversationRoom`, set accepted + conversation_id
  + decided_at. Optionally seed intro as sender's first message. Return {conversationId}.
- **Decline** `POST .../decline` → declined + decided_at. **Ignore = do nothing** (leave pending).
  Both **silent to sender**.
- **Sender contract:** optional `GET /messaging/requests/sent` shows ONLY pending + accepted. A
  `declined` request is INVISIBLE to the sender — no decided/seen/read field EVER returned.
  Sender cannot distinguish declined vs ignored vs unread (anti-retaliation core).

## Compose with existing safety
- **Block/report live ON the pending request card** (before accept) — reuse `/block`, `/report`.
- `POST /block` also nukes pending intros BOTH directions (→ withdrawn/declined). Zero pending
  between a blocked pair.
- `/report` carries requestId; snapshot intro into `reports.reported_message` (durability, per
  messaging.js:657-678). Report does NOT auto-accept/decline.
- Admin suspend (`admin.js`) also nukes the suspended user's pending outbound intros (+ mod log).
- **Swipe-match dedupe:** if the pair mutually matches via `/swipe` while an intro is pending,
  resolve the stale request (accepted w/ that convo, or withdrawn). Accept-path match insert
  dedupes on UNIQUE(user_a,user_b) so a swipe-races-accept can't dup a match.
- `candidates.js` UNCHANGED pre-accept (a pending intro must NOT hide the pair from Discover).

## Entry point (frontend)
Send-intro action on the **Discover profile view** (`SuggestionScreen.jsx` — the canonical
non-match profile surface, already hosts ReportModal + swipe) alongside like/skip → a calm compose
sheet (≤300 chars, plain). Requests sub-view in `MessagingApp.jsx` (sibling of MatchesListScreen):
each card = sender Discover profile + intro + Accept/Ignore/Decline + Block/Report (reuse
`BlockReportScreen`). Minimal Sent view (pending/accepted only).

## Build plan / phasing
- **Phase 1 (safety-complete MVP):** table + send (all guards) + GET requests + accept/decline +
  block/report on card + block-nuke + suspend-nuke + swipe stale-resolve. Backend branch-only →
  coordinator reviews the silent-failure indistinguishability + accept-txn dedupe + block-nuke
  before Railway deploy → frontend.
- **Phase 2 (later):** sender outbox, edit-in-place, recipient "pause incoming intros" (brigade
  defense).

## Safety-critical tests (must pass before deploy)
Blocked-pair send returns BYTE-IDENTICAL response to a real send (no probe leak); declined-sender
re-send is an undetectable no-op; suspended recipient rejected; slur + off-platform intro rejected;
rate-limit + pending-cap enforced; block nukes pending both ways; accept dedupes match + respects
cap; swipe-races-accept can't dup; sender API NEVER exposes declined.

## Biggest risks
1. **Accept transaction** — must reuse the exact canonical-order + UNIQUE-dedupe + joinRoom paths,
   never reimplement; test swipe-races-accept + cap-full. 2. **Silent-failure indistinguishability**
   — every "insert nothing" branch (steps 3-7) must be byte-identical to a real send; assert in tests.
