# Audio Prompt Answers — Trust, Safety & Moderation Design

**Author:** trust-safety-specialist (read-only advisory; no product code changed)
**Date:** 2026-07-05
**Status:** Build-ready spec. This is the safety model the `frontend-feature-builder`
+ coordinator follow. It reuses the existing photo-review pipeline; it does not
reinvent it.

> **One-line thesis.** Audio is a NEW user-generated media surface aimed at a
> population that is disproportionately targeted by groomers and scammers. It must
> ship exactly like profile photos already do: **nothing is visible to anyone but
> its owner until a human moderator approves it**, every clip carries a **free,
> readable transcript** (the a11y floor AND the moderator's fastest read), and the
> whole thing is **reportable, deletable, exportable, and gated to Companion for
> RECORDING only — never for being seen or matched.**

---

## 0. Sandbox reality (state this plainly in any handoff)

- The admin console and its queues are **admin-gated**; QA/automated accounts get
  **403** on `/admin/*`. The moderation queue **cannot be exercised live** in this
  sandbox — `scripts/qa/harness.mjs` seeds member accounts, not admins.
- Chromium here has **no internet egress**; R2 presigned uploads and audio
  playback from the real bucket cannot be driven end-to-end locally. socket.io is
  stubbed 503. So the builder verifies the member-side record/transcript UI and the
  gating on the **local build**, and the admin-queue rendering by **code + unit
  tests on the server** (vitest in `server/`), not by a live admin walkthrough.
- Any claim that "the moderation queue was tested" is false unless run against a
  real admin session on the deployed backend. Say so.

---

## 1. What already exists (reuse verbatim — do NOT rebuild)

The photo pipeline is the template. Every audio decision below mirrors a line
already in the codebase:

| Concern | Existing implementation | Audio reuses it by… |
|---|---|---|
| Review gate `pending_review→approved/rejected` | `profile_photos.review_status` (migration `036_profile_photo_review.sql`) | a new `profile_audio.review_status`, identical states + backfill guard |
| "Serve only approved to non-owners" | `listPublicPhotos` / `listPhotos({includePending})` — `server/src/routes/photos.js:21-51` | a `listPublicAudio` built on the same approved-only default |
| Presigned upload to R2 | `getPresignedUploadUrl` — `server/src/storage/r2.js:24`; `POST /photos/profile-upload-url` — `photos.js:108` | a new `audio/*` MIME allowlist + `profile-audio/{userId}/{id}.{ext}` keyspace |
| Merged review queue (UI) | `MergedPhotoQueue` — `src/AdminScreen.jsx:3105`; source `Segmented` filter | add a third source, "Audio" (see §3) |
| Pending-media review endpoints | `GET /admin/profile-photos/pending` + `POST /admin/profile-photos/:id/review` — `server/src/routes/admin.js:998-1080` | near-identical `…/profile-audio/*` handlers |
| Queue depth + oldest-pending SLA | `/admin/stats` + `/admin/queue-counts` — `admin.js:730,823` (`pendingProfilePhotos`) | add `pendingProfileAudio` + `oldestPendingProfileAudioAt` |
| Report → durable evidence snapshot | `reports.reported_message` (migration `044`); reports FKs `ON DELETE SET NULL` so evidence survives account deletion (migration `030`) | snapshot the transcript + reference the audio object on the report (§3.4) |
| Moderation audit log | `logMod()` — `admin.js:33`; append-only `moderation_log` | log `approve_profile_audio` / `reject_profile_audio` the same way |
| Hard-delete own media + R2 cleanup | `DELETE /photos/profile-photos/:id` — `photos.js:206`; `deleteUserRows` collects R2 keys — `server/src/data/deleteUser.js:15` | add `profile_audio` keys to both paths |
| Data export bundles media | `GET /export/archive` — `server/src/routes/export.js:402` (photos into ZIP) | add an `audio/` folder + transcripts to the ZIP (§4) |
| Off-platform / money detectors | `server/src/utils/safetySignals.js` (`classifySafetySignal`); observe-only `chat_safety_signals` (migration `048`) | run over the **transcript** at submit time (§2, §3.3) |
| Paid gating | `requirePaid` (402 `upgrade_required`) + `isCompanion` — `server/src/billing/entitlements.js:151` | gate RECORD/upload endpoints only (§5) |

**Nothing here needs a new storage vendor, a new auth model, or a new queue
paradigm. It is the photo model with an `<audio>` tag and a text field.**

---

## 2. The free transcript layer — REQUIRED, and it's the MVP's keystone

**Decision: member-typed transcript, required at record time. Recommended, and it
IS the calm path.** Rationale:

1. **It's the a11y floor, not a nice-to-have.** An un-captioned clip fails our own
   bar for Deaf/HoH members and for autistic members who process text far better
   than audio (this is the *entire reason* audio exists per `PROFILE_REDESIGN.md`
   feature #7 — "people who communicate better than they photograph"). A clip with
   no transcript must **never** be servable. The transcript is shown to **all**
   viewers, free, alongside playback — a free viewer always gets the text even
   though only Companion members can record.
2. **It makes moderation actually possible.** Audio hides abuse that text detectors
   miss. A required transcript gives the moderator a **readable** artifact to scan
   in seconds and lets `classifySafetySignal()` run over the words at submit time
   (§3.3) — zero vendor, works offline, works today.
3. **It's zero-vendor and can't silently fail.** No API key, no per-minute cost, no
   latency, no third-party PII processor to add to the privacy policy.
4. **It doubles as consent friction.** Typing out what you said is a calm moment to
   reflect before posting — on-brand.

Storage: a `transcript` column on `profile_audio` (see §3.1), `NOT NULL`, non-empty
after trim. **Server rejects a confirm with an empty/whitespace transcript** — a
clip literally cannot enter the review queue without one.

**Moderator honesty rule:** the transcript is member-authored and therefore
**untrusted** — it may not match the audio. The reviewer UI must say so ("Transcript
is member-provided; listen to confirm it matches") and the moderator MUST listen,
not just read. The transcript speeds triage; it does not replace the listen.

**ASR vendor = DEFERRED (§6).** An automatic-speech-recognition option (e.g. to
pre-fill or verify the transcript) is a later slice: it's vendor-dependent, needs a
key, adds a data processor, and its output is still only advisory. Flag it for a
`backend-security-auditor` pass when/if it lands. Do not build it for the MVP.

---

## 3. Human-review-before-serve (the core requirement)

### 3.1 Data model — new table `profile_audio`

Mirror `profile_photos` + `036`. New migration (next number, e.g.
`058_profile_audio.sql`):

```sql
CREATE TABLE IF NOT EXISTS profile_audio (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_key     TEXT NOT NULL,          -- which prompt this answers (catalog key)
  storage_key    TEXT NOT NULL,          -- R2 object key: profile-audio/{userId}/{id}.{ext}
  url            TEXT NOT NULL DEFAULT '',-- public R2 URL (mirrors profile_photos.url)
  transcript     TEXT NOT NULL,          -- REQUIRED, non-empty; shown to all viewers
  duration_ms    INTEGER,                -- client-declared; capped server-side
  mime_type      TEXT NOT NULL,
  review_status  TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review|approved|rejected
  reviewed_at    INTEGER,
  reviewed_by    TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_audio_user   ON profile_audio(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_audio_review ON profile_audio(review_status);
```

- One audio answer per prompt (enforce in the route: reject a second active clip for
  the same `(user_id, prompt_key)`, or replace-and-re-review). Keep it small: cap the
  **number of audio answers per profile** (recommend the same ceiling as prompts, and
  at most ~3 for the MVP).
- **No backfill subtlety needed** (unlike `036`, which had to approve existing rows):
  the table is brand-new and empty, so every row legitimately starts
  `pending_review`. Do NOT copy `036`'s blanket `UPDATE … SET 'approved'`.

### 3.2 Storage + endpoints (member side)

New router `server/src/routes/audio.js` (or extend `photos.js`), all
`requireAuth` + `requirePaid` + `mutationLimiter`:

- `POST /audio/profile-upload-url` — body `{ mimeType, fileSizeBytes, durationMs }`.
  - **MIME allowlist:** `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg` (map to
    `.webm/.m4a/.mp3/.ogg`). Reject anything else (mirrors `ALLOWED_MIME` in
    `photos.js:9`).
  - **Size cap:** enforce a strict integer `fileSizeBytes` check server-side BEFORE
    presigning (mirror `photos.js:252`). Recommend **≤ 5 MB**. Bake `ContentType`
    into the presign (as `r2.js:33` does); do NOT sign ContentLength (same rationale
    as photos); set an object-size ceiling on the R2 bucket for defense-in-depth.
  - **Duration cap:** reject `durationMs > 60_000` (short answer = calm; also caps
    reviewer time and storage). Duration is client-declared and advisory — treat it
    as untrusted; the size cap is the real ceiling.
  - Key: `profile-audio/${userId}/${newId()}.${ext}` — and, exactly like
    `photos.js:76`, the confirm handler MUST verify the key starts with
    `profile-audio/${userId}/` so a caller can't claim someone else's object.
- `POST /audio/profile-confirm` — body `{ key, promptKey, transcript, durationMs }`.
  - Validate `transcript` is a non-empty string (trim; cap length, e.g. 2000 chars).
    **Empty transcript → 400, no row created** (§2).
  - Run `classifySafetySignal(transcript)` (§3.3).
  - INSERT with `review_status='pending_review'`. **Do NOT mirror to any
    publicly-served field** — an audio answer becomes visible to others only when a
    moderator approves it (mirrors the `photos.js:91` comment + `syncPrimaryPhotoUrl`
    discipline: pending media never surfaces).
- `DELETE /audio/:id` — owner-only; hard-delete the row + best-effort
  `deleteObject(storage_key)` (mirror `photos.js:206-233`).
- **Viewer read (FREE):** `listPublicAudio(db, userId)` returns approved-only
  `{ promptKey, url, transcript, durationMs }` for a viewer; built on an approved-only
  default exactly like `listPublicPhotos` (`photos.js:42`). Wire it into whatever
  payload serves a profile to a match/Discover viewer. **`requireAuth` only — never
  `requirePaid`** on the read path (§5).

### 3.3 Submit-time safety screening (transcript)

Run `classifySafetySignal(transcript)` (server copy,
`server/src/utils/safetySignals.js`) at `profile-confirm`:

- On a hit, **append one `chat_safety_signals`-style row attributed to the uploader**
  (reuse the table from migration `048`, or add an analogous `signal_kind` +
  `context='profile_audio'`; simplest is to reuse `chat_safety_signals` with the
  audio id as `message_id`). This makes a member who keeps trying to route people
  off-platform via voice accrue the **same repeat-offender grooming signal** the
  moderation console already surfaces (`admin.js` `chatSignalCount` on report cards,
  member history).
- **Observe-only, calm-by-design:** do NOT auto-block the clip on a transcript hit —
  it still goes to the human queue like every other clip (matching the app's law that
  the chat detector never blocks a message, only friction + logs). The signal simply
  **flags the clip for the moderator's attention** and feeds the offender count.
- A transcript can lie, so the detector is a **triage aid layered on top of** the
  mandatory human listen — never the gate.

### 3.4 Plugging into the v2 merged review queue

- **Backend:** two new admin handlers, copy of `admin.js:998` / `admin.js:1031`:
  - `GET /admin/profile-audio/pending` → rows with owner context (`user_id`, owner
    email/display name, `url`, `transcript`, `duration_ms`, `prompt_key`,
    `created_at`), newest first.
  - `POST /admin/profile-audio/:id/review` — body `{ decision: 'approve'|'reject',
    note }`. **A reject REQUIRES a note** (mirror `admin.js:1046`, the B-E rule).
    Terminal guard: only act on `review_status='pending_review'`, else 409 (mirror
    `admin.js:1054`). On approve → mark approved + `reviewed_at/by`. On reject → mark
    rejected (never served thereafter) + best-effort `deleteObject`. Write
    `logMod(..., 'approve_profile_audio' | 'reject_profile_audio', id, note)`.
  - Add `pendingProfileAudio` + `oldestPendingProfileAudioAt` to BOTH `/admin/stats`
    (`admin.js:730`) and `/admin/queue-counts` (`admin.js:823`) so the dashboard's
    "Needs attention" tiles and the 60s live-count poll include audio backlog. Without
    this, an audio backlog is **invisible** and clips sit unreviewed = a false "all
    clear" (a moderation-ops gap of the kind we most want to avoid).
- **Frontend (`src/AdminScreen.jsx`):**
  - Extend `PHOTO_SOURCE_OPTIONS` → add `{ value: "audio", label: "Audio" }` and
    render an `AudioReviewQueue` inside `MergedPhotoQueue` (`AdminScreen.jsx:3105`)
    under an "Audio answers" subheading when source is "All". Consider renaming the
    sub-view label from "Photo review" to **"Media review"** (`QUEUE_VIEWS`,
    `AdminScreen.jsx:3050`) since it's no longer photos-only.
  - **`AudioReviewCard`:** owner name/email · the prompt being answered · a native
    `<audio controls preload="none">` pointed at `item.url` · the **transcript
    rendered as text** · a clear "Transcript is member-provided — listen to confirm"
    caption · Approve / Reject-with-required-note (reuse the shared reject panel at
    `AdminScreen.jsx:1048`). `preload="none"` so opening the queue doesn't autoload
    every clip.
  - **Calm-admin note (our moderators are autistic too):** never autoplay. One clip
    plays at a time. No waveform animation in the MVP. Keep the card visually identical
    to the photo card rhythm.

**Rejected/pending audio is NEVER served** — the approved-only `listPublicAudio`
default guarantees it, exactly as `listPublicPhotos` does for photos.

---

## 4. Abuse vectors unique to audio (the core value) + mitigations

| # | Vector | Why text tooling misses it | Mitigation (this spec) |
|---|---|---|---|
| A | **Grooming / scam script in voice** ("let's talk on Telegram", "send a gift card") | The chat off-platform/money detector never sees profile audio | Required transcript → `classifySafetySignal()` at submit (§3.3) logs an offender signal + flags the clip; **mandatory human listen** before serve; report-an-audio (row F) routes any that slip through into the queue as evidence |
| B | **Voice/segment reveals identity, precise location, or contact info** ("I live at…", "my number is…", "meet me at 5 Elm St") | Coarse-location + contact-hiding rules are enforced on *typed* profile fields, not on spoken words | Human review listens for it and rejects; transcript detector catches spelled-out numbers/handles; **the off-platform-contact rule and coarse-only-location rule apply to audio identically** — reviewer guidance says "reject clips that state a precise address, phone, handle, or full name of a third party" |
| C | **Recording a third party without consent** (a partner, a child, a stranger, ambient private conversation) | Impossible to detect automatically | Record-time consent copy states "only record yourself; don't record other people"; reviewer rejects clips that are clearly not the member speaking about themselves; report reason "This isn't them / records someone else" |
| D | **Sexual / explicit audio** (moans, explicit talk) | No audio NSFW classifier exists (there isn't even one for photos here) | Human listen is the gate; reject reason "explicit/sexual content"; same standard as the photo NSFW screen, applied by ear |
| E | **Weaponized audio** (slurs, threats, targeted harassment aimed at whoever views the profile) | A slur spoken but mis-transcribed passes a text-only check | Mandatory listen; reject + `warn`/`ban` via the existing enforcement ladder (`admin.js` `/reports/:id/action`); the clip is preserved as report evidence (row F) |
| F | **A clip that clears review is later abused / a viewer needs to report it** | Approval isn't permanent innocence | **Report-an-audio path:** extend the report flow so a viewer can report a specific approved clip. Add a nullable `reported_audio_id` (+ snapshot `reported_audio_transcript`) to `reports` (ADD COLUMN only — never rebuild `reports`; follow migration `044`'s pattern). Filing pulls the clip into the moderation queue as evidence and lets the moderator re-listen and reject/enforce. The clip's transcript is **snapshotted onto the report** so the evidence **survives even if the uploader deletes their account or the clip** — mirroring `reports.reported_message` + the `ON DELETE SET NULL` guarantee (migration `030`). Consider *soft*-holding a reported clip (stop serving it pending re-review) rather than leaving it live. |
| G | **Storage-key / URL guessing to reach pending (un-approved) audio** | Pending objects sit at a public R2 URL (same as pending photos today) | Keys are unguessable `newId()` values and only the owner + admin ever receive the URL. **Flag for `backend-security-auditor`:** consider presigned, expiring GET URLs for *pending* media instead of a public URL — voice carries more inherent PII than a photo. Not an MVP blocker (it's the exact same posture photos ship with today), but worth the pass. |

**Coarse-timestamp + privacy rules still apply:** any timestamp shown on an audio
answer uses `coarseLabel()` (`server/src/utils/time.js`) like everything else — no
precise "recorded at 9:43pm". No duration-based "online now" inference. No read/less
metadata.

---

## 5. Gating correctness (no pay-to-be-seen)

- **RECORD / POST is Companion.** `requirePaid` on `POST /audio/profile-upload-url`,
  `POST /audio/profile-confirm`, `DELETE /audio/:id` (delete may stay free — you can
  always remove your own content; simplest is `requirePaid` off the delete so a
  downgraded member can still clean up). A non-Companion caller gets `402
  upgrade_required` (`entitlements.js:151`).
- **VIEW (playback + transcript) is FREE.** `listPublicAudio` and the profile payload
  that carries it are `requireAuth` only. A **free** member viewing a Companion
  member's profile hears the clip and reads the transcript at no cost. The transcript
  is never gated (it's the a11y floor, §2).
- **Being matched / seen is NEVER gated on audio.** Audio is additive expression. A
  free member's text-only profile must rank and surface **identically** — the
  compatibility score (`server/src/matching/score.js`) must not read audio presence.
  Do not add "profiles with audio get more matches" anywhere.
- **No pressure framing.** No "add audio to get more matches", no "profiles with a
  voice answer get 3× replies" (that's a fabricated metric — banned by product law and
  `MONETIZATION_STRATEGY.md` §7). The Companion upsell copy stays "express yourself in
  your own voice", never "be seen more". Follows the `PROFILE_REDESIGN.md` free-vs-
  Companion rule: *expression + being matched on your merits is FREE; Companion only
  adds a higher ceiling, never the floor.*

---

## 6. Consent, deletion, portability

- **Recording consent UX (record-time):** before the mic turns on, a calm, plain-
  language panel: what recording is for (answering a prompt in your voice), that
  **only they should be recorded** ("please don't record other people"), that the clip
  is **human-reviewed before anyone sees it** (set expectation → no anxiety about
  instant exposure), that a **written transcript is required** and shown to viewers,
  and that they can **delete it anytime**. Explicit mic-permission is the browser's,
  but the app asks first and explains. No countdown, no urgency, no "recording…" red
  panic dot beyond a simple, dismissible state.
- **Delete own audio:** `DELETE /audio/:id` hard-deletes the row + R2 object
  (`deleteObject`), mirroring photo delete (`photos.js:206`). Confirm-once, calm, no
  shaming.
- **Account deletion cascade:** **`server/src/data/deleteUser.js:15` `deleteUserRows`
  MUST be extended** to collect `profile_audio.storage_key` for the user (same pattern
  as `photoKeys`/`attachmentKeys`) so the R2 objects are purged on account delete. The
  `ON DELETE CASCADE` FK removes the DB rows; the storage-key collection is what
  actually deletes the audio bytes from R2. **This is a required change — without it,
  deleting your account leaves your voice recordings in the bucket.** (The report-
  evidence snapshot in row F is the deliberate exception: transcript text on a report
  survives, mirroring how `reported_message` survives — that's evidence, not the
  member's live content.)
- **Data export (GDPR Art. 20, FREE — never gated):** extend
  `GET /export/archive` (`server/src/routes/export.js:402`). Today it bundles the
  owner's full photo gallery (including pending/rejected — it's their own data). Add:
  the owner's **audio files** into an `audio/` folder in the ZIP (fetch bytes via
  `getObjectBytes`, best-effort skip like photos at `export.js:444`), and render each
  **transcript** into `index.html` under a new "Your voice answers" section + include
  it in `data.json`. Include **all** of the owner's own clips regardless of
  review_status (their own data), consistent with the photo manifest.

---

## 7. Smallest safe first slice (MVP) vs later

**MVP — safe to ship (all of the following, none optional):**

1. `profile_audio` table + migration (§3.1), brand-new (no risky backfill).
2. Companion-gated presigned upload to R2 (`audio/*` allowlist, ≤5 MB, ≤60 s) +
   confirm (§3.2).
3. **Member-typed transcript required** — no row without it (§2).
4. **Human-review-before-serve** — `pending_review` default, approved-only
   `listPublicAudio`, new admin pending/review endpoints, added to `MergedPhotoQueue`
   with an audio player + transcript (§3.4).
5. Submit-time `classifySafetySignal(transcript)` → offender signal (§3.3).
6. **Report-an-audio** with transcript snapshot as durable evidence (§4 row F).
7. Free viewer playback + transcript; matching never reads audio (§5).
8. Delete-own-audio + account-delete cascade + export addition (§6).
9. Queue-depth + oldest-pending counts wired into stats/queue-counts (§3.4).

**Defer (explicitly out of MVP):**

- **ASR / transcription vendor** (auto-transcribe or transcript-vs-audio
  verification) — vendor-dependent, needs a key, new data processor. → security pass.
- **Waveform / scrubber UI, playback-speed, captions-synced-to-playback.**
- **Short video** (`MONETIZATION_STRATEGY.md` §5 #2 pairs audio+video) — video is a
  strictly larger review + storage + abuse surface (faces, backgrounds, third parties
  on camera); design it separately, later, on top of this same review spine.
- **Automated audio content classification (NSFW/abuse ML).** None exists for photos
  either; human review is the gate for both.

**Flag for `backend-security-auditor` before/at build:** (a) presigned-GET vs public
URL for *pending* audio objects (§4 row G); (b) the `profile-confirm` key-ownership
check (`startsWith profile-audio/${userId}/`); (c) per-user audio count + rate limits
so the queue can't be flooded; (d) the report-an-audio authorization (a reporter may
only reference a clip they can actually see — an approved clip on a profile they can
view), mirroring the existing pin-message ownership checks in `messaging.js:777`.

---

## 8. Build-ready requirements checklist

- [ ] Migration `058_profile_audio.sql` — table per §3.1 (no blanket-approve backfill).
- [ ] Migration: `ALTER TABLE reports ADD COLUMN reported_audio_id TEXT;` +
      `reported_audio_transcript TEXT;` (ADD COLUMN only; never rebuild `reports`).
- [ ] `server/src/routes/audio.js`: `profile-upload-url`, `profile-confirm`,
      `DELETE /:id`, all `requireAuth`+`requirePaid`(+`mutationLimiter`); `audio/*`
      MIME allowlist; ≤5 MB size gate before presign; ≤60 s duration reject;
      key-ownership check; **empty transcript → 400**.
- [ ] `listPublicAudio` (approved-only) wired into the profile-view payload,
      `requireAuth` only (FREE); matching/score never reads audio.
- [ ] `classifySafetySignal(transcript)` on confirm → offender signal row.
- [ ] Admin: `GET /admin/profile-audio/pending` + `POST /admin/profile-audio/:id/review`
      (reject requires note; terminal 409 guard; `logMod`; reject → `deleteObject`).
- [ ] `pendingProfileAudio` + `oldestPendingProfileAudioAt` in `/admin/stats` and
      `/admin/queue-counts`.
- [ ] `src/AdminScreen.jsx`: `PHOTO_SOURCE_OPTIONS` gains "Audio"; `AudioReviewQueue`
      + `AudioReviewCard` (native `<audio controls preload="none">` + transcript +
      "member-provided, listen to confirm" caption + reuse reject panel); rename the
      sub-view to "Media review".
- [ ] Report-an-audio: extend the report flow + card to reference/snapshot a clip;
      soft-hold reported clips; evidence survives account/clip deletion.
- [ ] `deleteUser.js` `deleteUserRows`: collect `profile_audio.storage_key` for R2
      purge. **Required.**
- [ ] `export.js`: `audio/` folder + transcripts in ZIP HTML + `data.json` (FREE).
- [ ] Member record UI: consent panel, required transcript field, delete control,
      "reviewed before anyone sees it" expectation-setting; no urgency/countdown;
      Companion-gated with a calm (non-pressuring) upsell.
- [ ] Server vitest coverage for: gating (402 for free), empty-transcript reject,
      approved-only serving, review terminal guard, cascade-purge of audio keys.

---

## Executive summary (relay this)

Audio prompt answers are a new user-generated media surface for a highly-targeted
population, so they must ship on the **exact photo-safety spine we already have**:
every clip sits `pending_review` and is invisible to everyone but its owner until a
human moderator listens and approves it (approved-only serving, just like
`listPublicPhotos`), it plugs into the existing merged media-review queue as a third
source with an audio player, and its backlog shows up in the dashboard's "needs
attention" counts so nothing rots unreviewed. The non-negotiable keystone is a
**member-typed transcript, required at record time and free to every viewer** — it's
our accessibility floor for Deaf/HoH and text-preferring autistic members, it's what
the moderator reads to triage, and it lets our existing off-platform/scam detector run
over the words and flag repeat groomers. Audio-specific abuse (spoken scam scripts,
identity/location/contact reveals, third-party or explicit recordings, weaponized
slurs) is handled by mandatory human listening plus a report-an-audio path whose
transcript snapshot survives account deletion as evidence. Recording is Companion-
gated; **playback, transcript, matching, and being seen stay free — never pay-to-be-
seen**. The MVP is member-typed-transcript + human-review + R2 + report-an-audio +
delete/export/cascade, all Companion-gated; ASR vendors, waveforms, and short video
defer. Sandbox caveat: the admin queue can't be exercised live here (admin 403, no
browser egress), so verify member-side + gating on the local build and the queue via
server unit tests — never imply the moderation console was walked live.
