# Spectrum Dating — Differentiation Backlog ("state of the art, not bland")

From a 4-lens panel (product-strategy, user-journey, visual/brand, identity/inclusivity)
run 2026-07-03 against the live app + code, triggered by the customer's read: *"appears
fairly bland, not much sets it apart… only three genders."*

## The diagnosis (all four lenses agree)
Spectrum is **not** missing a moat — it has a real one (comms/sensory **compatibility
scoring** with plain-language "why you match" reasons, autism-aware **conversation
scaffolding**, calm safety framing) and a genuinely **ownable brand** (the 6-tile spectrum
ramp + Newsreader/Atkinson type). The problem is presentation:
1. **The moat is presented moat-LAST** — buried below the Discover fold, behind toggles,
   default-collapsed, and the key onboarding step is framed "optional — skip for now," so
   the killer match reasons rarely even fire.
2. **The identity model is genuinely behind** — 3 genders (+ a dead-end "Other"), no
   sexual orientation at all, no relationship structure. Worst gap for a neurodivergent ×
   heavily-LGBTQ+ audience.
3. **The brand is deployed timidly** — the ramp survives only at 4–10px in corners; the
   default `dim` theme is near-monochrome and the warm clay/sand half never appears in-app.

Fix = **surface + amplify what exists**, then **close the identity gap**. Mostly frontend;
identity is the main backend content gap. Everything below fits calm-by-design (no
gamification/urgency/streaks/read-receipts).

---

## Wave A — Surface the moat + amplify the brand (FRONTEND-ONLY, Vercel, zero backend risk)
Highest leverage, lowest risk — moves the "feels generic" needle immediately.

> **A-1 (D-1..D-5) SHIPPED TO PROD — master `d9e948e`, live-verified.** Flipped Discover
> card ("Why you fit" + comms/sensory chips above the bio), ✓ reserved for true mutual
> signals, "What to expect" open on new threads + "Conversation helpers" relabel,
> onboarding Step 5 reframed, landing compatibility-promise hero + arrival beat. Gates:
> eslint 0, smoke 11/11, deep_messaging 30/30, flows_mobile 35/35. (Deferred post-ship:
> contrast-fills/a11y-fe4-7/deep_onboarding — 429-cooldown-gated. Design review in flight.)
>
> **A-2 (D-6..D-9 brand amplification) SHIPPED TO PROD — live-verified.** Warmed
> the default `dim` theme (low-saturation warm-taupe `surfaceAlt` so the ramp's
> warm end is present in-app, D-6); de-genericized avatars (monogram two-tone
> now steps the brand ramp IN ORDER + a soft ramp-arc signature at the base of
> the ring, luminance-picked legible ink, D-7); gave the tile motif one confident
> moment per surface (spectrum ramp rule under the `Your profile` / `Your matches`
> / `Likes` H1s via `SectionRule`, and the profile-completeness meter now reads
> as the ramp filling left→right, D-8); filled desktop dead space with the
> landing's soft static atmosphere wash behind the app shell (D-9). Also fixed
> design-review #1 — the duplicated candidate comms note on the Discover card
> (the `About talking:` echo is filtered out of `whyReasons` so the standalone
> note below the bio is its single home). D-10 (illustration warmth) deferred as
> optional. Gates: eslint 0 errors, smoke 11/11, contrast-fills 20/20 (AA held),
> a11y-fe4-7 37/37, deep_messaging 30/30; no pageerrors in dim/light/navy/trans
> captures at 390px + desktop.

- **D-1 (S) Flip the Discover card — moat above the fold.** Put the top "why you match"
  reasons + 2–3 comms/sensory chips ABOVE the bio, under the name; make the spectrum ramp a
  deliberate framing element (ramp spine/underline, not a 4px top strip) and color-code the
  ✓ compatibility rows with the ramp so it *means* fit. `SuggestionScreen.jsx` (data already
  fetched). [strategy#1, journey#3, visual#2] — **single highest-leverage change.**
- **D-2 (S) Fix the ✓ dilution.** Reserve the green ✓ "you both…" for real mutual signals;
  render one-sided context (their comm note) as a quieter "About them" line. `score.js`
  reason typing + `SuggestionScreen` render. [journey#4]
- **D-3 (S) Un-bury the conversation moat.** Default the "What to expect" card expanded on
  new threads; make the helper-phrases tray a legible feature (ramp treatment), not a bare
  "Word prompts" button. `ConversationScreen.jsx`. [strategy#4, journey, visual#7]
- **D-4 (S) Promote + reframe onboarding Step 5 (the moat step).** Move earlier; frame as
  "this is how we match you differently" (not "optional — skip"); tappable plain cards
  instead of "Prefer not to say" dropdowns; soften the repeated "Prefer not to say" empty
  states. `OnboardingScreen.jsx`. [strategy, journey#2/#6]
- **D-5 (S–M) Reframe the landing + add a "made for me" beat.** Lead with the compatibility
  promise ("matched on how you communicate and what your senses need — not just photos");
  keep "no typing dots / no rush" as proof points; add one framed moment in onboarding/
  arrival naming the promise. `LandingScreen.jsx`. [strategy#5, journey#5]
- **D-6 (S) Warm up the default `dim` theme.** Let the warm clay/sand half of the ramp back
  in as low-saturation secondary surface / section eyebrows so a warm ramp color appears on
  every screen. `index.html` dim palette (~190-207). [visual#1]
- **D-7 (S) De-genericize avatars.** Derive the monogram two-tone from the ramp *in order* +
  one quiet spectrum signature (tile-notch / soft ramp arc). `Avatar.jsx`. [visual#3]
- **D-8 (S) Give the tile motif one confident moment per surface** — a ramp rule under the
  section H1s ("Your matches"/"Likes"/"Your profile"); let the completeness meter be a
  centerpiece. [visual#4]
- **D-9 (S) Fill desktop dead space** with the landing's static atmosphere gradient or a calm
  right-hand context panel ("why you're seeing this person" / safety reassurance). [visual#5]
- **D-10 (S, polish) Wire the illustration language + restrained ramp cues into populated
  screens** (thread day-dividers, section heads). `illustrations.jsx` is only in empty
  states today. [visual#6/#7]

## Wave B — Identity / inclusivity expansion (BACKEND, one Railway deploy — the real content gap)
Directly answers the customer's gender example + the biggest competitive gap.
**Safe architecture (do not break matching):** keep the current 3-token matchable gender
CORE driving `candidates.js`; layer an expanded **display-only** identity set + orientation on
top via a derived `gender_group` (woman|man|nonbinary|'') mapping. Orientation/pronouns are
additive by construction and *cannot* break the mutual filter.

> **B-1 (D-11..D-13) SHIPPED TO PROD — master `93a66ad`.** Expanded gender with a
> matchable `gender_group` core, self-describe free text, and display-only orientation.
>
> **B-2 (D-14..D-16) DONE — on branch `claude/production-bugs-backlog-okvown`, pending
> coordinator review + Railway/Vercel deploy (NOT yet on master).** Migration `041`
> adds `relationship_structure TEXT NOT NULL DEFAULT ''` (display-only, validated in
> `PUT /profile/me`, returned on GET /me + public profile; NEVER read by
> `candidates.js`). Pronouns now render in the conversation header
> (`ConversationScreen.jsx`), Match Moment (`MatchMoment.jsx`), and the Likes /
> matches lists (`LikedYouSection.jsx`, `MatchesListScreen.jsx`) — the messaging
> serializers (`messaging.js` conversation list/detail/archived) were extended to
> carry `pronouns`; matching's matches/likes payloads already did. An explicit calm
> "Open to everyone" affordance (= empty-seeking semantics) was added to the seeking
> UI in `OnboardingScreen`, `ProfileScreen`, and `DiscoverFilters`. New identity field
> components (`RelationshipStructureField`) live in the shared `IdentityFields.jsx`.
> Also folded in **3 A-2 design nits**: (#1) `SectionRule` now renders a theme-constant
> literal-hex ramp (not the `--mark-*` tiles that went white under the `trans` theme);
> (#2) `COMPLETENESS_RAMP` luminance rises monotonically green→sand so the meter no
> longer dips at the old deep-teal mid-tile; (#3) desktop `DESKTOP_ATMOSPHERE` cool-corner
> alphas lifted 0.09→0.12 so the wash isn't lopsided-warm. Gates: backend lint 0 errors
> + 95 tests pass (adds `identity_wave_b2.test.js`: relationship_structure round-trips +
> does NOT affect candidates; pronouns present on the conversation/matches payloads);
> migration 041 boots clean; frontend eslint 0 errors, build OK, smoke 11/11,
> contrast-fills 20/20, a11y-fe4-7 37/37.

- **D-11 (S — same-day win) Expose "Other" + free-text self-describe for gender.** SHIPPED (B-1).
  Backend already accepts `'other'` (`VALID_GENDERS`), the UI just never showed it. Added `gender_custom`.
- **D-12 (M) Expanded gender set (opt-in) with matchable-core mapping.** SHIPPED (B-1). agender,
  genderfluid, genderqueer, trans-man, trans-woman, two-spirit, bigender, intersex,
  questioning; `gender_group` drives matching (trans-woman→woman, etc.) so `candidates.js`
  is untouched (a real fix over today's "other" dead-end); gender chip on cards.
- **D-13 (M) Sexual orientation field (new), DISPLAY-ONLY.** SHIPPED (B-1). straight/gay/lesbian/bi/pan/
  ace/demi/queer/questioning, comma-joined like `seeking`; not wired into filtering (can't
  break matching). Biggest state-of-art parity win for this audience.
- **D-14 (S–M) Relationship-structure axis** (monogamous/open/polyamorous/queerplatonic/
  figuring-it-out), display-only — separate from the existing relationship *goal*. DONE (B-2,
  branch). Feeld parity, unusually on-brand for a take-your-time literal-communication audience.
- **D-15 (S) Pronouns everywhere a name appears** — added to the chat header, match moment,
  likes (rendered on the Discover card today but vanished in chat). DONE (B-2, branch);
  messaging serializer extended to include `pronouns`.
- **D-16 (S) Explicit "Everyone / open to all" seeking option** (was an unlabeled
  empty state). DONE (B-2, branch).

## Wave C — Moat depth (later)
- **D-17 (S–M) Neurodivergent "special interests"** — elevate the `talk_for_hours` prompt /
  a matchable deep-dive-topic field; reframe the generic hobby cloud. [strategy#6, journey]
- **D-18 (S) Make safety a visible identity** — one calm trust affordance at first contact
  referencing the protections already running (anti-scam signals, human photo review).
  Reassuring, never alarming. [strategy#8]
- **D-19 (S) Honest "Sent"/"Delivered" reassurance** — verify the existing F4 micro-state is
  own-side-only (never "seen by them"). [strategy#7]

---

## Recommended build order
1. **Wave A frontend re-surfacing** — ship this week via Vercel, near-zero risk, biggest
   perceived-distinctiveness gain. Start with **D-1 (flip the card)**, then D-2/D-3/D-4,
   then the brand-amplification set D-6/D-7/D-8.
2. **Wave B identity** — start with **D-11 (same-day "other"+self-describe)**, then the
   expanded gender set + orientation as one careful backend pass + Railway deploy
   (matchable-core mapping is the load-bearing safety constraint).
3. **Wave C depth** — special interests, visible safety, Sent reassurance.

**Protect (already distinctive — do not touch):** the landing manifesto, the serif/hyperlegible
type pairing, the 7-theme picker incl. Pride/trans identity themes, and MatchMoment's
ramp-as-connecting-thread (the model for "the ramp should carry meaning, calmly").
