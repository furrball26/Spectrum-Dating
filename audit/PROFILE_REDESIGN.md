# Spectrum Dating — Complete Profile Redesign Proposal

**Date:** 2026-07-04 · **Status:** Awaiting user sign-off before build. Synthesized from a
3-strand research panel: competitor/visual teardown (`audit/redesign/PROFILE_COMPETITORS.md`),
feature-gap analysis, and Membership-placement — plus the design review of the current
3-group layout. Ground-up; ignores the current structure per the brief.

## The diagnosis (all three strands agree)
The profile **does not "feel basic" because it lacks data** — it has one of the richest data
models in the codebase. It feels basic because:
1. It's **edit-only, a long stack of look-alike form cards** — no confident "view mode," no
   photo hero, no media, prose interests instead of visual chips.
2. **The one thing no other app has — our communication/sensory "how to connect with me"
   moat — is scattered across four separate cards**, so it reads as generic form-filling
   instead of the differentiator it is.
3. Rich data already stored is **invisible** (e.g. photo descriptions exist but only as
   screen-reader alt-text; the "How others see you" preview exists but isn't prominent).

**So the redesign is mostly PRESENTATION over data we already store — largely frontend-only,
largely free, and it violates no product law.**

## Do NOT rebuild (already exist and are good)
- **"How others see you" preview** (`ProfilePreviewModal`) — promote it, don't rebuild it.
- **Calm profile-strength meter** (`ProfileCompletenessNudge`) — keep.
- Verification badge + self-serve flow; expanded identity; F28 facets; special interests;
  suggested-interest picker; billing/Membership screen.

## Recommended new structure (view + edit)
**Make a "View / Preview" mode first-class** — a prominent toggle at the top ("Editing" ↔
"How others see you"), reusing the existing preview. This single change does the most to make
the profile feel like a real product rather than a settings form.

Edit layout, top → bottom:
```
[ Editing  |  How others see you ]      ← prominent mode toggle (promotes existing preview)

PHOTOS         hero + grid, with VISIBLE captions (data already stored)
▸ About me     bio · prompts as cards · interests as visual CHIPS · "could talk for hours"
▸ How to connect with me   ← NEW consolidated module (the moat, near top, prominent):
                 commNote + comm style + sensory + helps-me/hard-for-me + the
                 understand_me/communicate_best prompt answers, together in one place
▸ Identity     gender · orientation · pronouns · relationship structure
▸ Looking for  relationship goal · seeking · age · distance · deal-breakers
▸ Membership   ← its own peer section (out of Account), collapsed, Hinge-style destination
▸ Account      verification · notifications
Save · footer hub
```

## Visual richness (presentation, calm-compatible)
- **Interests → visual chips**, not prose (adopt Bumble/Tinder chip pattern).
- **Prompts → card-per-idea** layout (adopt Hinge's most-copied pattern).
- **Photo hero + visible captions** (surface the stored `description` sightedly; keep alt-text).
- **Promote the "How others see you" preview** to a top-level mode toggle.
- Reserve the spectrum-ramp accent for one confident moment per screen (design-review finding);
  neutral hairlines for sub-dividers; widen the header/sub-header size step.

## Membership as its own section (per your ask)
Its **own peer collapsible group directly above Account**, styled identically to the others so
it's first-class — the **Hinge model** (a labelled destination), never the **Tinder model** (a
banner hijacking the top). Collapsed by default; the header summary quietly shows
"Spectrum (Free)" / "Spectrum Companion." Free members: lead with "everything you use daily is
free forever," then a calm "what Companion adds" card + one honest **"See what Companion adds"**
door → the existing Membership screen. Companion members: status + badge + "Manage membership."
No auto-open, no dot/NEW nag, no urgency, no blurred teasers.

## Feature additions (ranked; free unless noted)
1. **Visible photo captions** — data exists, alt-text only today. FREE · frontend-only · S.
2. **"How to connect with me" module** — consolidate the scattered moat. FREE · frontend · M.
3. **Interests as chips + larger/categorized library** — FREE · frontend · S–M.
4. **Prompts as cards + expand catalog 12 → ~40** — FREE · mostly data · XS–S.
5. **Promote "How others see you" preview** (+ optional pre-match/matched toggle) — FREE · S.
6. **Typed low-pressure prompt** (poll / "this or that") — FREE · backend (prompt schema `type`
   column) · M–L. Guardrail: shows a choice, NEVER a vote tally/percentage/counter.
7. **Audio prompt answers** (express-yourself media) — **Companion** · backend (audio storage +
   moderation pipeline + a FREE transcript layer for a11y) · L. Second wave.

**Free vs Companion rule (governs all of the above):** *expression + being matched on your
merits is FREE; Companion only ever adds convenience, assistance, and a higher ceiling — never
the floor.* A Companion member's richer profile must never out-rank or "beat" a free profile,
and we never message it that way (no pay-to-be-seen).

## Reject (product-law / dark patterns)
Profile view counts / "who viewed you" · poll vote tallies / "X% agree" / profile-update streaks
· "3× more matches"-style fabricated stats · Spotify/Instagram/social embeds (external calls) ·
timed/rotating upsell banners · blurred teaser previews with unlock overlays · height/vitals
stat row as a redesign driver.

## Suggested phasing
- **Phase 1 — presentation overhaul (FREE, frontend-only, no backend): the bulk of "basic →
  rich."** New IA + mode toggle + "How to connect with me" module + interests-as-chips + prompt
  cards + visible photo captions + Membership as its own section + the design-review polish.
  Ships through the normal pipeline; one meaty builder (possibly two passes).
- **Phase 2 — content depth (FREE, low effort):** expand prompt catalog + interest library.
- **Phase 3 — rich media (bigger, backend):** typed low-pressure prompts, then audio answers
  (Companion) with its free transcript layer.

## Profile Hub (Hinge-pattern) — APPROVED direction, next profile pass
Customer shared Hinge references and likes its profile *home* pattern. Adopt the structure,
reject the dark patterns. User confirmed the top bar = **Preferences + Settings**.

**Profile home layout (the new default profile tab):**
- **Top bar:** wordmark left; top-right two icon buttons — **Preferences** (sliders icon) →
  opens the "Looking for" preferences (seeking, age, distance, deal-breakers) + the Companion
  advanced filters as a focused sheet; **Settings** (gear icon) → opens the existing Settings
  screen.
- **Circular avatar hero** (primary photo) with a **pencil button** overlaid → opens full
  profile **Edit** (the current About me / "How to connect with me" content).
- **Name + verified badge** directly under the avatar.
- **Calm hub content below** (a hub, NOT an upsell funnel): a "How others see you" preview
  entry · **Membership** as its own calm card (the "See what Companion adds" door) · **Top
  Picks** (Companion) entry · Safety Center entry.

**REJECT (dark patterns visible in the Hinge reference — banned by our product law):** the
HingeX "get seen sooner / 3× as many dates" banner (fabricated metric), "Boost — 11× more
people" (pay-to-be-seen auction), Roses/consumables, and Hinge's "Show Last Active Status"
toggle (we ban last-active). Our Membership card stays calm and honest — no multipliers, no
urgency.

**Restructure note:** the current edit-form ProfileScreen becomes the **Edit** destination
(reached via the pencil). A new lightweight **Profile Hub** becomes the default profile tab.
Preferences sheet = the "Looking for" group extracted; Settings already exists. Keep all field
save-logic, the completeness meter, and hooks-before-return intact. This is a navigation
restructure — sequence it as its own builder pass (after the current moderation work).

## Open decisions for the user
1. Approve the presentation-led direction + the new IA above?
2. Is **Phase 1 (frontend-only)** the right first build, or do you want a specific feature
   (e.g. the "How to connect with me" module, or the view/preview mode) first?
3. Prompt catalog: OK to expand 12 → ~40 (I'll draft calm, autism-friendly prompts)?
4. Any competitor profile you want us to lean toward stylistically (Hinge's card-per-idea is
   the closest fit for "rich but calm")?
