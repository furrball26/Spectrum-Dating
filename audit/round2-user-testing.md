# Round 2 — User Testing Log (Customer Use-Cases)

## Run: 2026-06-30 (live browser, Claude-in-Chrome) — as sample user **Mira K.** (`mira.k.1`)

**🔴 CRITICAL: none.** No completely-failed core goal. All 6 new personas could reach the
*core* of their goal; the failures are at the edges (replace a photo, withdraw a report,
understand-why), which is where this round was deliberately aimed.

Browser arrived already authenticated as Mira K. (the designated sample user) — no sign-in
needed. API base in prod is `https://spectrum-dating-server-production.up.railway.app`
(Vercel frontend, separate backend host). Read tools `read_page`/`list_connected_browsers`
were permission-denied again (as R1); worked around with screenshots + page JS + source review.

> Personas this round are all NEW angles per the PM brief and do **not** repeat R1
> (evaluate-before-signup, shared-interest match, set comm/sensory prefs, report/block,
> pause/delete, catch-up, privacy-check).

---

## Use cases this run

| # | Persona · Goal | Result | What happened |
|---|----------------|--------|---------------|
| 1 | User who needs to **edit / replace a profile photo** | **PARTIAL** | Photo manager has Add / Set-as-main / per-photo alt-text / confirm-before-Remove — all solid. But there is **no "Replace" affordance** (must Remove then Add), and **no guard or warning when removing your only photo** — the confirm dialog shows just "Remove / Cancel" with no caution text, and the backend then sets `photo_url=''`. A photoless profile is **still shown in Discover** (candidates require name+bio+1 interest, *not* a photo). A user "swapping" their single photo can strand themselves photoless-but-discoverable. NEW this round. |
| 2 | User **managing multiple conversations** | **PARTIAL** | List has name filter + a "1 / 5" cap indicator + Archived section (good). But each row shows only name + "Today" — **no last-message snippet and no who-spoke-last cue**, so a user juggling threads can't tell at a glance where they left off or whether they owe a reply (this is wayfinding, *not* an unread-count urgency signal, so not a calm-by-design exclusion). No sort/pin and no private note-to-self (backlog F13). NEW this round. |
| 3 | User **revisiting / withdrawing a report** | **PARTIAL** | Revisit works well: Safety Center → "Your reports" shows the real existing report (Ana Beltran · Inappropriate · Reported Jun 29 · **Reviewed**). But there is **no way to withdraw / cancel a report** — the card has zero action buttons and no withdraw endpoint exists. A user who reported in error (very plausible for an impulsive/overwhelmed report) is stuck; the false report sits in the mod queue forever. NEW this round. |
| 4 | User **exploring search radius / distance** | **PARTIAL** | Radius control exists & is well-labelled (Anywhere / 25 / 50 / 100 / 250 mi) with help text, plus a "Where are you based?" free-text field. But distance only resolves for **~7 hard-coded US metros** (Phoenix, Seattle, Portland, Austin, Chicago, Boston, Denver + Tucson). For *any* other location the coords are `null` and the radius filter **silently no-ops** — the user picks "Within 25 miles", still sees far-away people, and gets no explanation. The city field has no validation/autocomplete. Cards also never show an actual distance, only "Near {city}". NEW this round. |
| 5 | **Returning user whose match unmatched them** | **PARTIAL** | When the other person unmatches, the match **and the entire conversation are hard-deleted on both sides** (`DELETE FROM conversations WHERE match_id`). The thread just **vanishes** from Matches & Messages with **no notification, no tombstone, no "X is no longer available"** — you only find out (if the thread was open) when a send fails: "This conversation is no longer available." For a returning user this is an unexplained silent disappearance — poor for an audience that values predictability. NEW this round. (Not triggered live — would irreversibly destroy Mira's only match.) |
| 6 | User trying to **understand WHY they have no matches** | **PARTIAL** | The exhausted state ("You're all caught up / You've seen everyone who matches your search") *does* include good guidance — "Widening your **search radius**, **age range**, or who you're seeking can help" + an "Adjust your search" button. But the **same screen is shown whether you've genuinely seen everyone OR had zero candidates from the start** (`atEnd = index >= queue.length`, so 0 ≥ 0 is true). A user whose filters are too tight (or who's the only person in their area, or has `seeking` empty) is told "You've seen everyone" when they've seen *no one*, and nothing tells them which filter is excluding people. NEW this round. |

**Tally: 0 PASS clean / 6 PARTIAL / 0 FAIL.** (Every core goal was *reachable*; each had a real edge-case gap — which is exactly the territory this round was asked to probe.)

---

## Functionality gaps & errors

### G1. [FEATURE-GAP] No "Replace photo" + no last-photo guard → photoless-but-discoverable 🟠 (NEW)
- **Where:** Profile → "About you" photo manager; backend `DELETE /photos/profile-photos/:id`.
- **Repro:** With a single photo, click Remove → confirm shows only "Remove / Cancel", no warning. Confirm → `photo_url` set to `''`. Profile stays in Discover.
- **Expected:** A "Replace this photo" action (upload-in-place), and a warning/block when removing your *last* photo ("You'll have no photo and may be hidden / harder to match").
- **Actual:** No replace path; no last-photo guard; photoless profiles still surface in Discover.
- **file:line:** `Spectrum-Dating-Server/src/routes/photos.js:153-183` (delete sets `photo_url=''`, no last-photo check); `Spectrum-Dating-Server/src/matching/candidates.js:50-67` (candidate filter requires name+bio+interest, **not** a photo); `Spectrum-Dating/src/ProfileScreen.jsx:284-488` (`PhotoCell` — confirm step at :422-464 has no warning copy).
- **Severity:** 🟠 (self-inflicted invisibility / blank-card matching; mis-step is easy and unguided).

### G2. [FEATURE-GAP] No way to withdraw / cancel a filed report 🟠 (NEW)
- **Where:** Safety Center → "Your reports"; backend `messaging.js`.
- **Repro:** Open Safety Center, scroll to "Your reports". Cards are read-only — zero action buttons (verified in DOM). No withdraw endpoint exists (`/messaging/report` create + `/messaging/my-reports` read only).
- **Expected:** A "Withdraw / This was a mistake" action on an *open* report (and ideally a confirm). Especially important for a cohort that may report impulsively when overwhelmed and later regret it.
- **Actual:** Reports are permanent and one-directional; the reporter can never retract.
- **file:line:** `Spectrum-Dating-Server/src/routes/messaging.js:466-534` (report create + my-reports read; no delete/withdraw); `Spectrum-Dating/src/SafetyScreen.jsx:662-700` ("Your reports" card, no action).
- **Severity:** 🟠 (trust/agency for a vulnerable audience; pollutes the mod queue with un-retractable false reports).

### G3. [FEATURE-GAP] Reported outcome is opaque — status only, no plain-language result 🟡 (NEW · confirms backlog F9)
- **Where:** "Your reports" card shows a status pill ("Reviewed") and nothing else.
- **Repro:** The Ana Beltran report shows "Reviewed" with no detail about what happened (actioned? dismissed?). No tap-through, `moderator_note` is intentionally hidden.
- **Expected:** A plain-language outcome ("We reviewed this and took action" / "We reviewed this and didn't find a violation") so a vulnerable reporter knows reporting *did something*.
- **Actual:** Bare status word; reporter left uncertain.
- **file:line:** `Spectrum-Dating-Server/src/routes/messaging.js:507-534` (returns `status` only).
- **Severity:** 🟡 (reassurance gap). Matches backlog **F9**.

### G4. [FEATURE-GAP / latent ERROR] Search radius silently no-ops outside ~7 hard-coded metros 🟠 (NEW)
- **Where:** Profile search radius; backend distance filter.
- **Repro:** Set "Where are you based?" to any city not in the curated metro map (e.g. "Cleveland, OH", "Miami, FL", anywhere outside the US) and pick "Within 25 miles". `distanceMiles` returns `null` → candidate is *not* excluded → you still see distant people, with no indication the radius isn't applying.
- **Expected:** Either real geocoding, or honest UI feedback when a location can't be resolved ("We couldn't pin your location, so distance isn't being used"), and/or validated city input.
- **Actual:** Free-text city, no validation; radius appears active but silently does nothing for most real inputs.
- **file:line:** `Spectrum-Dating-Server/src/utils/metros.js:68-112` (only ~7 metros + Tucson have coords; `distanceMiles` returns `null` otherwise); `Spectrum-Dating-Server/src/matching/candidates.js:93-99` ("unknown distance always passes"); `Spectrum-Dating/src/ProfileScreen.jsx:2855-2901` (free-text city + radius select, help text says "Set your location above for this to apply" but doesn't warn when it can't resolve).
- **Severity:** 🟠 (a control that looks functional but silently fails for the majority of locations).

### G5. [FEATURE-GAP] Unmatch makes the conversation vanish with no notice or tombstone 🟠 (NEW)
- **Where:** Matches / Messages; backend `DELETE /matching/matches/:id`.
- **Repro:** When the *other* user unmatches, the match + conversation are hard-deleted for both. The thread disappears from your list on next load with no message; if you had it open, you learn only on a failed send ("This conversation is no longer available").
- **Expected:** A gentle, predictable acknowledgement — a tombstone or a one-line "This conversation has ended" so the disappearance isn't silent/confusing (without naming/blaming the other person).
- **Actual:** Silent deletion; no notification; history gone.
- **file:line:** `Spectrum-Dating-Server/src/routes/matching.js:235-249` (hard-deletes conversation + match); `Spectrum-Dating/src/messaging/ConversationScreen.jsx:1527-1543` (notice only on send-failure, not proactively).
- **Severity:** 🟠 (predictability/comfort gap for the target audience; lost history with no closure).

### G6. [FEATURE-GAP] "You've seen everyone" shown even when there were zero candidates 🟡 (NEW)
- **Where:** Discover empty state.
- **Repro:** With 0 candidates returned (filters too tight, empty area, or `seeking` empty), `atEnd = index(0) >= queue.length(0)` is true → identical "You're all caught up / You've seen everyone who matches your search" screen as a genuine exhaustion.
- **Expected:** Distinguish "we couldn't find anyone matching your current filters" from "you've gone through everyone," and ideally name the active filters (seeking / radius / age) so the why-no-matches user can self-diagnose.
- **Actual:** One conflated message; user told they've "seen everyone" when they've seen no one.
- **file:line:** `Spectrum-Dating/src/SuggestionScreen.jsx:491` (`atEnd` definition), `:670-707` (single empty state). The "Adjust your search" hint at :689-690 is good and should be preserved.
- **Severity:** 🟡 (misleading copy; the goal is still partly served by the adjust hint).

### G7. [FEATURE-GAP] Conversation list lacks last-message / who-replied-last wayfinding 🟡 (NEW)
- **Where:** Messages → conversation list rows.
- **Repro:** Row shows only "{name} · {Verified} · Today" (verified in DOM: `"Eli BrennerVerifiedToday"`). No snippet, no "you / they replied last".
- **Expected:** A last-message snippet or a neutral "You replied last / They replied last" cue (not an unread *count* — that stays excluded by design) to help users managing several threads know where they left off.
- **Actual:** No content/sender cue at the list level.
- **file:line:** `Spectrum-Dating/src/messaging/MessagingApp.jsx` (conversation list rows).
- **Severity:** 🟡 (multi-conversation wayfinding; consistent with calm-by-design since it's not an urgency signal).

---

## Confirms-R1 (re-verified, still open)
- **Un-like / withdraw "I'm interested" still missing** (R1 #1 / backlog **F16**). Discover commits a like with no undo; only Skip is reversible. Re-seen live (controls: "I'm interested" / "Not right now" / "Skip"); did **not** tap it. 🟠
- "Set who you're looking for" completeness chip + "Pause buried in form" (R1 #2/#3) not re-tested this round; out of scope for these personas.

## Strengths worth preserving (not gaps)
- "Your reports" status visibility, per-photo alt text, Set-as-main, confirm-before-remove, the "1/5" cap indicator, the contextCard surfaced on the Matches card, and the empty-state "Adjust your search" guidance are all genuinely good.
- Calm-by-design correctly observed and **not** logged as gaps: no typing dots, no online/last-seen, no read receipts, no unread counts, "Nobody was told you looked at them."

## Coverage & caveats
- Personas 5 (unmatch experience) and the photoless-Discover consequence (G1) were confirmed via **source review**, not by executing the destructive action (unmatch / removing Mira's only photo would be irreversible on sample data). Everything else exercised live in the browser.
- Distance/radius outside supported metros (G4) confirmed by reading `metros.js`; not reproduced live (would require editing Mira's location and committing swipes).
- Onboarding/sign-up not exercised (instructed never to create accounts).

## Sample data touched / restored
- **No sample-data mutations this run.** No likes/skips committed (opened Discover but did not tap "I'm interested"); no photo removed (opened the Remove confirm, then **Cancelled** — photo intact); no report filed or withdrawn (only viewed the existing Ana Beltran report); no unmatch/block; no profile Save. Mira's profile, photo, match with Eli, and the existing report are all unchanged.
- Pre-existing residue (from prior testers, not this run): 4 "Message deleted" tombstones in the Eli thread; one "Reviewed" report on Ana Beltran; Mira's like on Lucia Moreno from R1.

~Leroi
