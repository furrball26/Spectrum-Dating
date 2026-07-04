# Data Export Format — design doc

**Status:** proposal (design only — no code shipped with this doc)
**Author:** research/design pass, 2026-07-04
**Scope:** redesign the account data export (`server/src/routes/export.js`) into a
user-friendly, GDPR-Art.20-complete bundle: a **ZIP** containing a self-contained
human-readable `index.html`, a machine-readable `data.json`, the user's actual
`photos/`, and a `README.txt`.

---

## Executive summary (relay-ready)

Our current export ships a single `spectrum-export.json` with only
conversations/messages/reactions. It fails our users two ways: it **omits the full
profile and every photo** (so it is not a complete Article-20 copy), and **raw JSON
is unreadable** to a non-technical or neurodivergent user — which for an autism-first
product is an accessibility failure, not a cosmetic one. The recommendation is a
**ZIP archive** with four parts: `index.html` (one self-contained file, inline CSS,
embedded/relative photos, opens offline by double-click in any browser — the human
copy), `data.json` (structured, the machine copy for portability), a `photos/` folder
of the real image bytes, and a `README.txt` explaining the contents and the
coarse-timestamp note. This "readable HTML **and** portable JSON in one download"
pattern is exactly what Instagram/Facebook, Google Takeout, Tinder and Hinge ship,
and the EDPB/ICO explicitly bless JSON as a portability format and encourage a
human-readable copy alongside it. The one genuinely new backend cost is **fetching
photo bytes out of R2 object storage to bundle them** (they are not in the database).
Recommended first slice: **profile + conversations rendered to HTML, the same data as
JSON, and photos, zipped and streamed** — a ~1.5–2.5 day build. Data export stays
**free forever** (GDPR right; see `audit/MONETIZATION_STRATEGY.md`).

---

## 1. Why change (the two problems)

Current `GET /export/conversations` (`server/src/routes/export.js`) returns
`spectrum-export.json` containing only: `exportedAt`, `userId`, and per-conversation
`messages` (body, from me/them, coarse `timeGroup`, the requester's own reactions).

**Problem 1 — incomplete.** It does **not** include the user's own profile (name,
bio, prompts, interests, communication/sensory facets, gender/orientation/pronouns,
verification status, preferences, DOB/age, location) or **any of their photos**. A
GDPR Art. 20 copy is supposed to be the personal data the user *provided* — the
profile and photos are the largest, most personal part of that, and they are missing.

**Problem 2 — unreadable.** A single raw `.json` file frustrates non-technical users:
double-clicking it opens a text editor showing one long unformatted line, or the
browser renders raw source. For autistic adults — where clarity and low friction are
stated accessibility requirements, not nice-to-haves — that is a real barrier. Every
major consumer platform solves this by offering a **human-readable HTML** view in
addition to the machine JSON.

---

## 2. Research findings (with sources)

### 2.1 What GDPR Art. 20 actually requires — and whether HTML+JSON satisfies it

- Art. 20(1) grants the right to receive personal data the subject *provided* "in a
  **structured, commonly used and machine-readable format**." Only *provided* +
  *observed* data is in scope; *inferred/derived* data (e.g. match scores) is not
  required. [EDPB/WP29 WP242; GDPR-Text](https://gdpr-text.com/read/article-20/)
  (accessed 2026-07-04).
- **JSON is explicitly named as compliant.** WP242 rev.01: where no industry format
  is in common use, controllers "should provide personal data using commonly used
  **open formats (e.g. XML, JSON, CSV, …) along with useful metadata** at the best
  possible level of granularity." So `data.json` is a first-class, guideline-endorsed
  portability format.
  [WP242 (gtclawgroup PDF)](https://gtclawgroup.com/wp-content/uploads/2017/03/WP242_Guidelines-on-the-right-to-data-portability.pdf)
  (accessed 2026-07-04).
- A **scanned/print PDF is NOT machine-readable** and does not satisfy Art. 20 — this
  is why we do not choose PDF as the portability artifact.
  [EDPB endorsed WP29 guidelines](https://www.edpb.europa.eu/our-work-tools/general-guidance/endorsed-wp29-guidelines_en)
  (accessed 2026-07-04).
- **UK GDPR / ICO** mirrors this: the copy must be structured, commonly used and
  machine-readable, and CSV/JSON-type formats are named as appropriate;
  interoperability is *encouraged* but not mandatory. A DSAR (Art. 15 "right of
  access") is a broader adjacent right; a good export doubles as a strong DSAR
  response.
  [ICO — right to data portability](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-data-portability/)
  (accessed 2026-07-04).
- **Does a dual HTML + JSON bundle satisfy Art. 20?** Yes. The `data.json` file
  satisfies the machine-readable/portability leg on its own; the `index.html` is an
  *additional* human-readable rendering (regulators encourage giving the subject a
  form they can actually read/understand). Shipping both — as Instagram/Facebook do —
  is a superset of the legal minimum. **(Verified against EDPB + ICO guidance above;
  not a formal legal opinion — flag for counsel sign-off before public claims.)**

### 2.2 How major platforms structure exports

- **Instagram / Facebook "Download Your Information"** — the user **chooses HTML *or*
  JSON**; both contain the same data. HTML is described as "the comfortable choice
  when you just want to read," JSON "when you want to [machine-]process." Delivered as
  a **ZIP** with a folder tree (e.g. `connections/…`, media folders) and per-section
  files.
  [JSON vs HTML explainer](https://fans.walter-labs.com/blog/instagram-data-export-json-vs-html/),
  [PIRG how-to](https://pirg.org/resources/how-to-request-and-download-instagram-data/)
  (accessed 2026-07-04).
- **Google Takeout** — a **ZIP/TGZ** containing folders of media with **JSON sidecar
  files** carrying each item's metadata, plus an `archive_browser.html` index. Large
  exports split into multiple ~2 GB archives.
  [Google Takeout JSON explained](https://metadatafixer.com/learn/google-takeout-json-files-explained)
  (accessed 2026-07-04).
- **Tinder** — export is **structured JSON** plus profile photo files; includes email,
  phone, photos, messages, preferences. Explicitly **omits data that would affect
  another person's privacy/safety.**
  [Tinder — request your data](https://www.help.tinder.com/hc/en-us/articles/115005626726-How-do-I-request-a-copy-of-my-personal-data)
  (accessed 2026-07-04).
- **Hinge** — delivers a **`.zip`** with files for matches, profile, photos and
  prompts (JSON + image files), and **excludes personal info about other members.**
  [Hinge — request your data](https://help.hinge.co/hc/en-us/articles/360011235813-How-do-I-request-a-copy-of-my-personal-data)
  (accessed 2026-07-04).
- **Bumble** — human-reviewed SAR; notably, to get *both sides* of a conversation both
  parties must request separately (i.e. each user only gets their own contributed
  side). All of the above are **free.**
  [Bumble — requesting your data](https://support.bumble.com/hc/en-us/articles/28783199493917-Requesting-your-data)
  (accessed 2026-07-04).

**Convergent pattern:** ZIP container · JSON as the machine format · real media files
bundled in a folder · an HTML index/reader for humans · other members' private data
withheld. Our proposal matches this pattern.

### 2.3 Accessibility of the readable format (HTML vs PDF vs CSV)

- A **self-contained single HTML file** — all CSS inline in a `<style>` block, images
  either embedded as `data:` URIs or referenced by *relative* path to the bundled
  `photos/` — "can be double-clicked from the desktop to open in the browser and work
  offline with no server," on any device, no software install.
  [Bun standalone HTML](https://bun.com/docs/bundler/standalone-html),
  ["You don't need external assets in an HTML file"](https://shkspr.mobi/blog/2021/08/you-dont-need-external-assets-in-an-html-file/)
  (accessed 2026-07-04).
- **Tradeoffs for this audience (autistic adults, low friction, calm-by-design):**
  - **HTML — chosen for the human copy.** Opens everywhere offline; reflows to any
    screen; we control typography, spacing, heading structure and contrast so it can
    inherit the app's calm visual language; screen-reader friendly via real headings/
    landmarks; can show photos inline. Downside: must be authored to be genuinely
    self-contained (no CDN fonts/styles) — a hard requirement here.
  - **PDF — rejected as the primary artifact.** Fixed-width pages reflow badly on
    phones, are harder for screen readers, heavier to generate, and a print-style PDF
    is *not* machine-readable for Art. 20. Could be a later "print to PDF" nicety the
    user does themselves from the HTML.
  - **CSV — rejected as the human copy** (kept optional for power users). Great for
    spreadsheets, poor for reading prose like a bio or a threaded conversation, and
    can't hold photos.
  - **Raw JSON alone — the current failure mode.** Correct for machines, hostile for
    humans. Keep it, but never as the *only* thing the user sees.

---

## 3. Recommended format

**Deliver a ZIP archive.** Validated against the baseline hypothesis and kept.

```
spectrum-dating-export.zip
├── index.html          # self-contained human-readable copy (inline CSS; the "front door")
├── data.json           # machine-readable, GDPR Art. 20 portability copy
├── README.txt          # plain-text: what's inside, how to open, the coarse-time note
└── photos/             # the user's actual image files (profile gallery)
    ├── profile-01.jpg
    ├── profile-02.jpg
    └── …
```

Notes:
- **`index.html` is the front door.** README + HTML both tell the user "double-click
  `index.html`." It renders the full profile and every conversation as calm,
  readable HTML, and shows the gallery inline via `<img src="photos/profile-01.jpg">`
  (relative path) — so the ZIP works offline with no embedding bloat. (Alternative:
  base64 `data:` URIs inline the images into the HTML so the single file is portable
  on its own — heavier file, but survives being copied out of the ZIP. Recommend
  **relative paths** as the default, since photos already live in `photos/`; offer
  inline-embed only if a single detached file is later requested.)
- **`data.json`** is a superset of today's payload plus the profile and a photo
  manifest (filenames + descriptions + which is primary). This file alone satisfies
  Art. 20.
- **`README.txt`** is the accessibility safety net: a few short, literal sentences —
  what each file is, that `index.html` opens in any browser offline, that times are
  shown as day-groups (not exact clock times) by design, and where to get help.
- **`photos/` filenames** are stable, human-meaningful (`profile-01.jpg`…), extension
  derived from the stored MIME/key. Both `index.html` and `data.json` reference these
  same relative paths.

---

## 4. What the export MUST now include (that it doesn't today)

### 4.1 The full profile (currently: nothing)

Source of truth is the `profiles` table plus its satellites, exactly as
`GET /profile/me` assembles them (`server/src/routes/profile.js:156`). Export **all**
of the user's own fields at full fidelity:

- **Identity / basics:** `displayName`, `tagline`, `bio`, `pronouns`, `dateOfBirth`
  (+ derived `age`), `distCity` (as stored for the owner's own copy).
- **Gender & orientation (identity fields):** `gender`, `genderCustom`, `orientation`,
  and `genderGroup` (internal matching bucket — include in `data.json` for
  completeness/transparency; it is the user's own derived value).
- **Relationship intent:** `relationshipGoal`, `relationshipStructure`,
  `wantsChildren`, `seeking`, `prefAgeMin`, `prefAgeMax`, `searchRadiusMiles`.
- **Lifestyle:** `smoking`, `drinking`.
- **Communication & sensory facets (our differentiators):** `commNote`,
  `commDirectness`, `commLiteral`, `commCadence`, `sensoryEnvironment`,
  `sensoryLighting`, `socialDuration`, `contextCard`.
- **"About me" facets (F28/D-17):** `occupation`, `languages`, `helpsMe[]`,
  `hardForMe[]`, `specialInterests[]`.
- **Interests:** `interests[]` (from `user_interests`).
- **Prompts:** `prompts[]` — `{ promptKey, promptText, answer }` via `listPrompts()`.
- **Preferences/flags:** `notificationTier`, `weeklyDigest`, dealbreaker flags
  (`dbWantsChildren`, `dbNonSmoker`, `dbMustBeLocal`), `paused`.
- **Account/verification:** `email` + `emailVerified` (from `users`), `verified`
  (`profiles.identity_verified`), and current `verificationRequested` state; `tier`
  (billing entitlement). These are the user's own account facts.

Reuse the existing `/profile/me` assembly (call the same helpers — `listPrompts`,
`parseFacetList`, `listPhotos`) so the export can never drift from the profile the
user actually sees. **Do not** re-derive fields in a second place.

### 4.2 The user's photos (currently: nothing)

- **Where they live:** photo *rows* are in `profile_photos` (`id`, `storage_key`,
  `url`, `description`, `is_primary`, `position`, `review_status`), but the **image
  bytes live in Cloudflare R2 object storage** (`server/src/storage/photos.js` /
  `server/src/storage/r2.js`), not in the database. The DB only has a `storage_key`
  and a public `url`.
- **⚠ The backend must FETCH the photo bytes to bundle them.** This is the one
  genuinely new capability. Two ways:
  1. **HTTP GET the public URL** (`getPublicUrl(key)` → `R2_PUBLIC_URL/key`). Simplest;
     works because the profile-photo bucket is public. Node can reach it.
  2. **S3 `GetObjectCommand`** against the R2 bucket (the AWS SDK client already exists
     in `r2.js`; add a `getObjectBytes(key)` helper — `GetObjectCommand` is already
     imported there). More robust/private than depending on the public CDN.
  Recommend **option 2** (add one small helper) so the export doesn't depend on public
  URL reachability and works even if the bucket is later locked down.
- **Include the owner's full gallery**, including **pending/rejected** photos —
  `listPhotos(db, userId, { includePending: true })`. It's the user's own data; the
  review gate only governs what *others* see, not what the owner can export.
- **Filename ↔ metadata:** write each object to `photos/profile-NN.<ext>` and record,
  in both `data.json` and the HTML gallery, its `description` (alt text), `isPrimary`,
  `position`, and `reviewStatus`. Preserve `description` as `alt=` on the `<img>` in
  HTML (accessibility).
- **Message attachments:** out of scope for the first slice (they belong to
  conversations and are gated/reviewed; the current export already excludes them).
  Note as a later addition; if added, apply the same member-only/approved rules.

---

## 5. Privacy constraints to preserve (non-negotiable)

- **Requester's OWN data at full fidelity; the other party stays minimized.** For
  conversations, keep today's shape: the other person is identified only by
  `withUser` (display name) and message direction (`me`/`them`) — **do not** add the
  other member's profile, photos, email, or any post-match-gated private field to the
  export. This matches Tinder/Hinge/Bumble ("we exclude info about other members") and
  our own product law. The export must not become a scrape vector for a match's data.
- **Keep the coarse-timestamp rule.** Every time shown stays a `coarseLabel()`
  day-group ("Today" / "Yesterday" / "Mon" / "Jun 15" — `server/src/utils/time.js:3`),
  never a raw clock time — in **both** `index.html` and `data.json`. `exportedAt`
  stays coarse too. This is a calm-by-design product rule the current export already
  follows; do not regress it by dumping raw `sent_at` epochs into JSON.
- **Deleted messages** stay redacted to `[deleted]` (as today).
- **Token-authenticated, `no-store` delivery, unchanged.** Keep the existing
  hardening: mint a short-lived (5-min) purpose-scoped export token via
  `POST /export/token`; the download link carries *that* token, not the session JWT;
  set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; keep the per-user
  rate limit (5 / 15 min). A ZIP is more expensive to build than the JSON, so the low
  ceiling matters more, not less.
- **No other member's photos.** Only fetch/bundle photos owned by the requester
  (`profile_photos.user_id = requester`). Never bundle a match's gallery.

---

## 6. Implementation notes for the builder

**This is a backend-only change** (`server/`), delivered through the backend's own
ship pipeline (`server/RUNBOOK.md`) — it does not touch the Vite frontend build.
The frontend change is limited to relabeling the existing "Download my data" action
if the filename/endpoint changes.

### 6.1 ZIP library — `archiver` vs zero-dependency

- **`archiver`** (npm) — streaming ZIP, battle-tested, pipes straight to the HTTP
  response so we never hold the whole archive in memory. Handles many photos and large
  message corpora with bounded memory. **Recommended.** Cost: one dependency (+ its
  small tree) in `server/package.json`.
- **Zero-dependency** — Node has no built-in ZIP writer (`zlib` only does raw
  deflate/gzip, not the ZIP central-directory container). A hand-rolled ZIP is
  fiddly (local headers, CRC-32, central directory, ZIP64 for >4 GB) and easy to get
  subtly wrong. Not worth it for a shippable slice.
- **Memory/size:** stream everything — pipe each R2 object into the archive as it
  downloads; append `data.json`/`index.html`/`README.txt` as generated strings/buffers.
  With `archiver` piping to `res`, peak memory stays roughly one photo at a time, not
  the whole ZIP. Photos are already capped (≤6 profile photos, ≤10 MB each), so a
  worst-case profile export is small; still, stream rather than buffer.

### 6.2 Streaming the download

```
POST /export/token           # unchanged — mint 5-min export token
GET  /export/archive?token=  # NEW — streams the ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      'attachment; filename="spectrum-dating-export.zip"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(indexHtml, { name: 'index.html' });
    archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });
    archive.append(readmeTxt, { name: 'README.txt' });
    for (const p of photos) archive.append(await getObjectBytes(p.storage_key),
                                            { name: `photos/${filenameFor(p)}` });
    archive.finalize();
```

- Keep the existing `GET /export/conversations` (legacy JSON) for backward compat, or
  redirect it; add the archive as a new route. Reuse the same auth resolution
  (`verifyPurposeToken(..., 'export')` + legacy fallback) and the `exportLimiter`.
- **R2 fetch:** add `getObjectBytes(key)` to `r2.js` (uses the already-imported
  `GetObjectCommand`) and stream/collect the body. If an object fetch fails, **skip
  that one photo and note it in the README/JSON** rather than failing the whole export
  (best-effort, same spirit as the delete-cascade R2 cleanup).
- **Error handling:** if the archive errors mid-stream after headers are sent, destroy
  the response (can't change status code once streaming has begun) and log — do not
  leave a half-written `.zip` masquerading as complete.

### 6.3 `index.html` must be self-contained

- One `<style>` block, no external fonts/stylesheets/scripts, no CDN — CSP-free and
  offline. Use a system font stack, generous line-height, large readable body text,
  real `<h1>/<h2>` structure and landmarks, and calm colors echoing the app's `dim`
  theme. Provide a light-on-dark and dark-on-light that reads fine when simply opened
  (no theme toggle needed).
- Photos referenced by **relative path** (`photos/profile-01.jpg`) with `alt=` from the
  stored description. (Optional inline-embed mode base64s them into the HTML if a
  single detached file is ever needed.)
- Escape all user-provided text (bio, prompts, messages, display names) — this HTML is
  opened in a browser, so treat every stored string as untrusted and HTML-escape it to
  prevent a stored-XSS-in-your-own-export footgun.
- Structure: header ("Your Spectrum Dating data, exported [coarse date]") → **Your
  profile** (all fields, grouped) → **Your photos** (gallery with alt text) →
  **Your conversations** (each as a titled section, messages as left/right rows with
  coarse day-group separators and your reactions) → footer with the coarse-time note.

---

## 7. Effort estimate & the smallest valuable slice

**Smallest valuable first slice (ship this):** ~**1.5–2.5 engineer-days**.
- Add `archiver` + `getObjectBytes()` helper (~0.25d).
- New `GET /export/archive` route: reuse profile assembly + conversation query;
  build `data.json` (profile + conversations + photo manifest); stream photos from R2;
  zip + stream (~0.75–1d).
- `index.html` generator (server-side template/string builder), self-contained,
  escaped, calm styling; `README.txt` (~0.5–1d).
- Tests (vitest in `server/`): archive contains the 4 parts; profile fields present;
  photos bundled; other member's private data absent; timestamps coarse; auth/token +
  rate-limit intact (~0.25–0.5d).

**Deliberately deferred (later niceties):**
- Optional `data.csv` / per-conversation CSV for spreadsheet users.
- Inline-base64 single-file HTML mode.
- Message attachments (images sent in chats) — needs the same review/member gating.
- User-initiated "print to PDF" guidance (no server PDF generation).
- Multi-archive splitting (only if exports ever get large — profile photos are capped,
  so unlikely near-term).

---

## 8. Recommendation

**Build the ZIP bundle** — `index.html` + `data.json` + `photos/` + `README.txt` —
as specified, starting with the first slice in §7. It closes the two real gaps
(missing profile, missing photos), makes the export genuinely readable for our
users, matches how every major platform ships exports, and satisfies GDPR Art. 20 (the
`data.json` carries the legal load; the HTML is the humane layer on top). It reuses the
existing token/`no-store`/rate-limit hardening and the existing profile/photo/
conversation assembly, so the only new moving part is **fetching photo bytes from R2**
and **zipping a stream**. Keep it **free forever** (`audit/MONETIZATION_STRATEGY.md`
lists data export as off-limits for paywalling — a GDPR right and a trust line). Get a
brief legal sign-off before making public "GDPR-compliant export" claims (marked
unverified above).

---

### Sources (all accessed 2026-07-04)
- GDPR Art. 20 text — https://gdpr-text.com/read/article-20/
- EDPB endorsed WP29 guidelines (WP242) — https://www.edpb.europa.eu/our-work-tools/general-guidance/endorsed-wp29-guidelines_en
- WP242 full text (PDF) — https://gtclawgroup.com/wp-content/uploads/2017/03/WP242_Guidelines-on-the-right-to-data-portability.pdf
- ICO — right to data portability — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-data-portability/
- Instagram JSON vs HTML export — https://fans.walter-labs.com/blog/instagram-data-export-json-vs-html/
- PIRG — request/download Instagram data — https://pirg.org/resources/how-to-request-and-download-instagram-data/
- Google Takeout JSON files explained — https://metadatafixer.com/learn/google-takeout-json-files-explained
- Tinder — request your data — https://www.help.tinder.com/hc/en-us/articles/115005626726-How-do-I-request-a-copy-of-my-personal-data
- Hinge — request your data — https://help.hinge.co/hc/en-us/articles/360011235813-How-do-I-request-a-copy-of-my-personal-data
- Bumble — requesting your data — https://support.bumble.com/hc/en-us/articles/28783199493917-Requesting-your-data
- Bun standalone (self-contained) HTML — https://bun.com/docs/bundler/standalone-html
- "You don't need external assets in an HTML file" — https://shkspr.mobi/blog/2021/08/you-dont-need-external-assets-in-an-html-file/
