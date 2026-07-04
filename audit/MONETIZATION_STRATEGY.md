# Spectrum Dating — Monetization Strategy

**Author:** growth-monetization-strategist (read-only advisory)
**Date:** 2026-07-04
**Status:** Decision-ready memo. No code was changed. Coordinator to review + commit.

> **The one-line thesis.** Our members are autistic adults who are structurally
> over-charged by dating apps engineered for compulsion — and by the one app
> built *for them* (Hiki), which paywalls "who liked you", charges ~£23–28 for
> 30 minutes of visibility, and has been publicly called *"financially harmful"*
> to a community where only ~3 in 10 working-age autistic adults are employed
> ([NeuroHub, 2024](https://neurohubcommunity.org/2024/08/30/the-dating-app-for-autistic-people-that-could-be-financially-harmful/)).
> That is our opening. **We monetize comfort, capability, and convenience —
> never anxiety, scarcity, safety, or visibility.** The generosity of our free
> tier *is* the marketing.

---

## 0. Ground truth: where monetization stands today

There is **no billing, payments, subscription, boost, or premium code anywhere**
in the repo (grep for `stripe|billing|payment|premium|subscription|boost` across
`src/` and `server/src/` returns only push *subscriptions* and unrelated strings).
Monetization is **greenfield** — nothing to unwind, and no dark patterns already
baked in. That is a rare, clean starting position; we get to set the norm.

Critically, several things mainstream apps **charge for, we already give away free**:
- **"Liked You" / see-who-liked-you** — `src/LikedYouSection.jsx`, fully free, no
  counter, no urgency. (Tinder Gold, Bumble Premium, CMB Premium, and Hiki all
  paywall this.)
- **Advanced Discover filters** (age range, radius, who-you-seek) — `DiscoverFilters.jsx`,
  free. (Tinder Gold / Hinge+ / Bumble Premium paywall filters.)
- **Data export / portability** — `server/src/routes/export.js`, free.
- **Identity verification** — admin-reviewed, `profiles.identity_verified`, free.
  (Hiki charges €5/wk–€40/3mo for a verified badge.)
- **The compatibility moat** — comms/sensory "why you match" scoring
  (`server/src/matching/score.js`), conversation scaffolding, safety center.

**Implication:** our free tier is *already* more generous than most competitors'
paid tiers. Monetization must add genuinely new comfort/capability on top — it
must never claw back what is free today.

---

## 1. Current feature inventory (code-verified)

Legend: **CORE-FREE** = never chargeable (all safety + accessibility + the moat) ·
**CHARGEABLE-CANDIDATE** = exists, could ethically sit behind a paid tier ·
**TO-BUILD** = not built yet, potentially chargeable.

### Safety & trust — CORE-FREE (never paywall; hard rule #1)
| Feature | Where | Tag |
|---|---|---|
| Block / report / decoupled report+block | `ReportModal.jsx`, `messaging.js` | CORE-FREE |
| Safety Center + check-in timer + crisis-line routing | `SafetyScreen.jsx`, `7bcb740` | CORE-FREE |
| "Share my location" with a trusted contact (on-device) | `5ead2f5` | CORE-FREE |
| Traveler / at-risk-region hide-profile offer | `331ae2e`, `regionSafety.js` | CORE-FREE |
| Human photo review before serving; NSFW/name screening | `photos.js`, `nameScreen.js` | CORE-FREE |
| In-chat anti-grooming / off-platform / money-ask friction | `safetySignals.js` | CORE-FREE |
| Enforcement ladder, evidence-on-report, due-process | `6ed697f`, `6da160c` | CORE-FREE |
| Coarse-location-only privacy | `coarseCity`, `utils/time.js` | CORE-FREE |
| Identity verification (admin-reviewed badge) | `profile.js`, `VerifiedBadge.jsx` | CORE-FREE |

### Accessibility & calm UX — CORE-FREE (never paywall; hard rule #2)
| Feature | Where | Tag |
|---|---|---|
| 7 themes incl. `dim` default + Pride/Trans identity themes | `a11yPrefs.js`, `SettingsScreen.jsx` | CORE-FREE |
| Reduced-sensory / reduced-motion fallbacks | throughout, `useViewport` | CORE-FREE |
| Plain-language mode / calm microcopy | `plainLanguage` props | CORE-FREE |
| Calm pacing (no typing dots, no read receipts, no online status) | product law | CORE-FREE |
| Screen-reader / keyboard support (focus ring, a11y buttons) | `useFocusable.js` | CORE-FREE |

### The compatibility moat — CORE-FREE (this is why people come; giving it away is the strategy)
| Feature | Where | Tag |
|---|---|---|
| Comms/sensory compatibility scoring + "why you match" reasons | `score.js`, `discoverReasons.js` | CORE-FREE |
| Structured "about me" facets (occupation, languages, helps/hard-for-me) | migration 038, `ProfileScreen` | CORE-FREE |
| "Could talk for hours about" special-interests (soft-scored) | migration 042, `FeaturedInterest.jsx` | CORE-FREE |
| Expanded identity (gender set, orientation, pronouns, relationship structure) | Wave B, `IdentityFields.jsx` | CORE-FREE |
| Conversation scaffolding: "what to expect", helper-phrase tray, pre-send nudges | `ConversationScreen.jsx`, `0984a1b` | CORE-FREE |

### Matching / discovery — mostly CORE-FREE; edges chargeable
| Feature | Where | Tag |
|---|---|---|
| Discover deck, swipe-free like/skip, un-like undo, pause | `SuggestionScreen.jsx` | CORE-FREE |
| "Liked You" (act at your pace, no counter) | `LikedYouSection.jsx` | CORE-FREE |
| Advanced filters: age/radius/seeking | `DiscoverFilters.jsx` | CORE-FREE (basics stay free) |
| Photo gallery (viewer-side, cap 6) | `PhotoCarousel.jsx`, `PROD-6` | CORE-FREE (base); **cap raise = CHARGEABLE-CANDIDATE** |
| Message-requests / intro (one-shot, screened) | `messageRequests.js` | CORE-FREE |
| Data export / portability | `export.js` | CORE-FREE (GDPR right — never paywall) |

### Not built — potential paid capability (see §5)
Conversation-prep / draft-assist · expanded media (audio/video prompt answers,
higher photo cap) · saved / advanced compatibility filter sets · "considered
selection" quiet shortlist · genuine relocation matching · optional human calm-
support add-on · profile-writing assistance. All **TO-BUILD**.

---

## 2. Competitor tier research (cited)

All prices US unless noted; **access date 2026-07-04**. Dating apps use **dynamic
pricing by age/region/device/test-cohort** — treat every number as *approximate,
as-reported by third-party reviewers*, not an official rate card. Figures from
review aggregators are marked accordingly; **UNVERIFIED** = could not confirm from
a live first-party source.

| App / Tier | Approx price (2026) | Key paid features | Psychological mechanism |
|---|---|---|---|
| **Tinder Plus** | ~$24.99/mo (varies) | Unlimited likes, rewinds, Passport, no ads, Incognito | Remove friction the free tier deliberately imposes |
| **Tinder Gold** | ~$39.99/mo | + See who liked you, 10 daily Top Picks, advanced filters, 1 Boost/mo | Curiosity gap ("who?") + scarcity (daily picks) + visibility auction |
| **Tinder Platinum** | ~$49.99/mo | + Message-before-match, Priority Likes | Pay to jump the queue / buy attention |
| **Tinder Select** | ~$499/mo, invite-only (UNVERIFIED exact) | Elite/priority access | Status / exclusivity |
| **Hinge+** | ~$29.99–32.99/mo | Unlimited likes, see all likes, advanced filters, sort likes | Remove throttle + control |
| **HingeX** | ~$49.99/mo | + "Skip the Line" always-on boost, Priority Likes (7-day pin), enhanced recs | Persistent visibility auction + algorithmic favoritism |
| **Bumble Boost** | ~$40/mo (varies) | Unlimited likes, 5 SuperSwipes/wk, 1 Spotlight/wk, rematch, backtrack | Consumable "power-ups" (SuperSwipe/Spotlight) = spend-to-be-noticed |
| **Bumble Premium** | ~$60/mo | + See who liked you, instant match from queue, advanced filters, Incognito, Travel | Curiosity gap + privacy-as-paywall + location unlock |
| **Bumble Premium+** | ~$80/mo | + Photo insights, "fast-track"/priority in feeds, 2 Notes/10 SuperSwipes/2 Spotlights/wk | Fabricated-metric feedback ("which photos people love") + visibility auction |
| **Match.com** | ~$5.46–17.99/mo (by term); 12-mo Platinum ~$239.88 | Messaging, profile views, boosts | Legacy access-gating; long-term lock-in pricing |
| **eHarmony** | ~$12–60/mo (Light/Plus/Unlimited; UNVERIFIED tier splits) | See photos, message, unlimited views | Gate the basics (photos/messaging) behind the wall |
| **OkCupid** | from ~$7.95/mo (UNVERIFIED current tiers) | Likes-you, boosts, advanced filters, ad-free | Access-gating + boosts |
| **Coffee Meets Bagel Premium** | ~$20–35/mo | Full "Likes You", 8 Flowers/mo, 48-hr Boost, Activity Reports, **Read Receipts**, advanced filters | Consumables (Flowers) + surveillance metrics (read receipts, activity reports) |
| **CMB Platinum** | > Premium (UNVERIFIED price) | + Priority likes, Infinite Boost, Incognito | Visibility auction + privacy paywall |
| **Hiki** (autism/ND, our closest peer) | Badge €5/wk–€40/3mo; **Boost €27.99/30 min**; sub £18.99/wk–£41.99/mo–~£275/yr; Sparks ~£4.66 ea | Verified badge, see who liked you, Boosts, Sparks, other-city browsing, video prompts | **Micro-transaction pressure on a low-income, socially isolated group** — publicly criticized as *"financially harmful"* |

**Sources (accessed 2026-07-04):**
Tinder — [G2A](https://www.g2a.com/news/features/how-much-is-tinder-gold-tinder-plus-vs-gold-vs-platinum-prices-features-and-which-is-worth-it/),
[VIDA Select](https://www.vidaselect.com/tinder-plus-vs-tinder-gold),
[tinder.com/feature/subscription-tiers](https://tinder.com/feature/subscription-tiers/) ·
Hinge — [help.hinge.co (benefits)](https://help.hinge.co/hc/en-us/articles/38014282744595-Subscription-and-Purchase-Benefits),
[VIDA Select](https://www.vidaselect.com/hinge-plus-vs-hingex) ·
Bumble — [support.bumble.com (pricing)](https://support.bumble.com/hc/en-us/articles/30614091973149-Pricing-information-for-paid-features),
[support.bumble.com (features)](https://support.bumble.com/hc/en-us/articles/32668790872733-Understanding-Bumble-s-paid-features-and-subscription-plans) ·
Match/eHarmony — [innerbody](https://www.innerbody.com/eharmony-vs-match),
[eharmony.com/tour/eharmony-cost](https://www.eharmony.com/tour/eharmony-cost/) ·
OkCupid/CMB — [VIDA Select CMB](https://www.vidaselect.com/coffee-meets-bagel-premium),
[beyondages](https://beyondages.com/coffee-meets-bagel-cost/) ·
Hiki — [hikiapp.com](https://www.hikiapp.com/), [NeuroHub critique](https://neurohubcommunity.org/2024/08/30/the-dating-app-for-autistic-people-that-could-be-financially-harmful/),
[Atypikoo comparison](https://www.atypikoo.com/page/neurodivergent-dating-apps-comparison/) ·
Privacy-as-paywall context — [Family Office Exchange](https://www.familyoffice.com/insights/navigating-dating-apps-guide-protecting-your-privacy).

---

## 3. Adopt / adapt / reject — the core verdicts

For each competitor mechanism: does it sell **comfort/capability/convenience**
(adopt), or does it sell **anxiety/scarcity/visibility** and need de-pressurizing
(adapt), or is it a **banned dark pattern** (reject)?

| Mechanism | Verdict | Reasoning |
|---|---|---|
| **See who liked you** | **ADOPT — but keep it FREE** | Already free here and must stay so. It's calm curiosity, not urgency. Paywalling it is Hiki's central failure; keeping it free is a *marketing weapon*, not a lost revenue line. Never add a counter/timer to it. |
| **Advanced filters (attributes)** | **ADAPT** | Base filters (age/radius/seeking) stay free. *Extra* compatibility filters (sensory needs, comm style, special interests, saved filter sets) can sit in a paid tier — as capability, never as a gate on being able to match at all. |
| **Ad-free** | **N/A** | We run no ads (privacy-first, cookieless per `711d4b4`). Nothing to sell. |
| **Passport / Travel Mode** | **ADAPT** | As genuine **relocation matching** (you're actually moving) — calm and useful. Reject the Tinder framing of teleporting to "be seen" elsewhere for a hookup-visibility hit. No "appear in another city" auction. |
| **Incognito / browse privately** | **ADAPT — lean toward FREE** | Privacy-as-a-paywall is an ethics red flag ([Family Office Exchange](https://www.familyoffice.com/insights/navigating-dating-apps-guide-protecting-your-privacy)). A calm "browse without appearing" control fits our audience's need for control and should mostly be **free**; at most, a "who I'm visible to" refinement is a soft paid convenience. Never sell basic privacy. |
| **Unlimited likes (uncap the throttle)** | **ADAPT / mostly reject** | We don't manufacture a like-throttle to sell its removal. If any daily like guidance exists it's a *calm pacing* nudge, not a scarcity lever — do not convert it into a paywalled counter. |
| **Boosts / Spotlight / Skip-the-Line / Priority Likes** | **REJECT** | Pure visibility auction — punishes non-payers, makes free users invisible. Violates hard rule #4 and product law (no pay-to-be-seen). This is the entire model we exist to reject. Hiki's €28/30-min Boost is the cautionary tale. |
| **SuperSwipe / Flowers / Sparks / Notes (consumables)** | **REJECT** | Manufactured scarcity + spend-to-be-noticed pressure. Micro-transactions are what got Hiki labeled financially harmful. No consumable currencies, ever. |
| **Message-before-match** | **REJECT (as a paid lever)** | Buying the right to reach someone who hasn't opted in = pressure + safety risk. Our screened one-shot intro (`messageRequests.js`) already handles first contact *safely and free*. |
| **Top Picks / daily curated stack (with expiry)** | **ADAPT (carefully)** | A quiet "considered selection" of higher-fit people is genuinely valuable to an audience overwhelmed by an open deck — **but only** with no expiry, no countdown, no "act before it's gone." Reject the moment it grows a timer or counter. |
| **Read receipts / Activity Reports / Photo insights** | **REJECT** | Read receipts and online-activity surveillance are explicitly banned by product law. "Photo insights" is a fabricated-metric feedback loop. Non-starter. |
| **Paid verification badge** | **REJECT (as paid)** | Hiki charges for the verified badge; that makes *safety/trust* a paywall — hard rule #1. Verification stays free. We may *assist* verification as a convenience, but never gate the badge. |
| **Priority / algorithmic favoritism (HingeX enhanced recs)** | **REJECT** | Paying to bias the algorithm degrades everyone else's match quality — an invisible pay-to-win. Our compatibility scoring must be honest for everyone. |
| **Long-term lock-in pricing (12-mo up front)** | **ADAPT** | Offer an *optional* discounted annual, but with honest per-month display, easy cancel, and no "your price expires" pressure. Match's 12-month-only value framing is a soft dark pattern; we make the monthly genuinely fair so annual is a choice, not a trap. |
| **Dynamic pricing by age/location/device** | **REJECT** | Tinder's age-based pricing has drawn legal/ethical fire. We publish **one honest price**. This is a stated brand promise. |

---

## 4. Proposed Spectrum Dating tiers

**Recommendation: Free (fully usable forever) + exactly ONE paid subscription,
plus one optional à-la-carte human-support add-on.** Not two paid tiers.

*Why one paid tier, not two or three?* Decision overload is itself an
accessibility barrier for our audience. Tinder runs four tiers precisely to
exploit comparison anxiety and upsell laddering — the opposite of calm. One
clear "everything extra is in here" tier is honest, low-cognitive-load, and
on-brand. The human-support add-on is separated only because it has a real
marginal cost (a person's time) and shouldn't inflate the base price for people
who don't want it.

### Tier 1 — **Spectrum (Free)** — *free forever, and genuinely enough to date*
Everything a person needs to meet someone safely and calmly:
- All safety + accessibility features (the entire §1 CORE-FREE list).
- Full compatibility matching + "why you match" reasons.
- **See who liked you** (no counter, no urgency).
- Messaging, screened intros, conversation scaffolding + helper phrases.
- Base Discover filters (age, radius, seeking).
- Up to 6 photos, verification, data export.

> **Free-forever floor (stated publicly, never walked back):** safety, accessibility,
> the ability to *match, message, and see who likes you*, verification, and data
> portability are free **because charging a vulnerable group for safety or for the
> core act of connecting is a line we don't cross.** If we ever can't make money
> without crossing it, we've built the wrong business.

### Tier 2 — **Spectrum Companion** — ~**$8.99/mo**, or **$54/yr** (~$4.50/mo)
*Calm, plain name; "Companion" = it helps you, it doesn't rank you.* Pure
comfort/capability/convenience — **nothing here gates matching or safety**:
- **Conversation companion** — autism-aware draft help + "how might I reply"
  suggestions + gentle tone check (opt-in, disclosed, never auto-sent). *(§5 #1)*
- **Express-yourself media** — higher photo cap (e.g. 6→10) + audio/short-video
  answers to prompts (for people who communicate better than they photograph). *(§5 #2)*
- **Deeper compatibility filters + saved filter sets** — filter/sort on sensory
  needs, comm style, special interests, relationship structure; save more than one. *(§5 #3)*
- **A considered selection** — a small, calm shortlist of higher-fit people,
  refreshed on your schedule, **no expiry / no countdown / no counter**. *(§5 #4)*
- **Relocation matching** — set a place you're genuinely moving to and match there. *(§5 #6)*

**Price rationale.** Mainstream paid tiers run ~$25–80/mo; Hiki effectively ~£42/mo
+ boosts. At **$8.99/mo (or ~$4.50/mo annually)** we undercut every competitor by
a wide margin — deliberately, because our audience is disproportionately low-income
([NeuroHub/Buckland: ~3 in 10 employed](https://neurohubcommunity.org/2024/08/30/the-dating-app-for-autistic-people-that-could-be-financially-harmful/)).
The price says "this is a fair fee for genuine extras," not "pay or stay invisible."
One honest published price — no dynamic pricing, no "expires in 10:00", one-tap
cancel. **Offer a quiet "pay-what-you-can / reduced rate" path** (e.g. self-select
concession pricing, no invasive proof) — a concrete, ownable answer to the Hiki
critique and a trust signal advocates will amplify.

### Optional add-on — **Calm Support** (à-la-carte, not a recurring tier)
A **human** help option: a real person to help set up a profile, prep for a first
date, or talk through app anxieties — sold as a one-off session or a light
retainer, priced to cover the human's time. Kept *out* of the subscription so the
base price stays low and nobody pays for capacity they don't use. This is the
"concierge" idea done ethically: help, not status. Reject any version that becomes
"pay a human to get you matched/boosted."

---

## 5. Missing features worth building — ranked by (member value × brand fit ÷ effort)

Each includes the **smallest valuable slice** and **backend dependency**. Ranked
best-first. Every item was pressure-tested: *does it still work if we remove all
urgency/scarcity?* If no, it's rejected below.

**#1 — Conversation companion (draft/reply assistance).** *Highest leverage.*
Member value: very high (initiating/replying is the #1 documented friction for
autistic daters; scaffolding is *already our moat*). Brand fit: very high (direct
extension of the existing "what to expect" + helper-phrase tray). Effort: medium.
- *Smallest slice:* expand the existing helper-phrase / sentence-starter bank and
  add a static "ways you might respond to this" panel — **zero new backend, no LLM.**
- *Next slice:* opt-in LLM draft-assist ("help me phrase this", "is my tone okay?").
  *Backend dependency:* an LLM endpoint on the server (moderation-wrapped), disclosed
  to the user, **never auto-sends**, never fabricates read/typing signals, never
  impersonates. See §7 for the ethics guardrails.

**#2 — Express-yourself media (audio/video prompt answers + higher photo cap).**
Value: high (many autistic users present far better in voice/text than in photos;
this reduces photo-first pressure). Brand fit: high. Effort: low–medium — the
photo storage + **human review pipeline already exists** (`photos.js`, migration
036); audio/video reuses it.
- *Smallest slice:* raise the photo cap for Companion (6→10) — trivial config +
  the gallery already supports it. *Backend:* cap constant + moderation queue
  extension for new media types.

**#3 — Deeper compatibility filters + saved filter sets.** Value: medium–high.
Brand fit: high (the facets already exist — occupation, languages, sensory,
special interests, relationship structure). Effort: low.
- *Smallest slice:* let Companion filter/sort Discover on 2–3 existing facets and
  save one extra filter set. *Backend:* query params on `getCandidates` (careful —
  see `E20` scaling note; keep filters as *post-score refinements*, never a hard
  wall that empties the deck). **Base filters stay free.**

**#4 — "A considered selection" (quiet shortlist).** Value: medium–high (an open
deck overwhelms; a curated few is calmer). Brand fit: medium — *conditional*.
Effort: medium (reuse `score.js`).
- *Smallest slice:* a "Your best fits this week" list of ~5 highest-scoring
  candidates. **Hard constraints:** no expiry, no countdown, no "act now", no
  counter, no "X people saw you". *Backend:* a scored, de-duplicated query; no new
  tables. **Reject the instant it grows a timer** — that's Top Picks, which we ban.

**#5 — Profile-writing assistance.** Value: medium. Brand fit: high. Effort:
low–medium (shares infra with #1). *Smallest slice:* prompt-by-prompt "example
answers / help me start" (static). *Backend:* none for the static slice; LLM later.

**#6 — Relocation matching.** Value: medium. Brand fit: medium (useful, must avoid
the Passport "be seen elsewhere" auction). Effort: medium (coarse-geo already
exists; needs a "future city" field + candidate query change). *Smallest slice:*
one declared relocation city with an honest "moving here" label on the profile.

**#7 — Verified-badge *assistance* (NOT paid verification).** Value: medium
(verification anxiety is real). Brand fit: high *only if the badge stays free*.
Effort: low. *Smallest slice:* a calmer guided verification flow — **free**. Do
**not** charge for the badge (that's Hiki's red line). At most, bundle "priority
manual review turnaround" as a soft Companion convenience — and even that is
borderline; default to keeping all verification free.

**#8 — Data export / portability.** **Build as a free feature only.** Already
exists (`export.js`) and is a **GDPR right** (Art. 20). Charging for it is both a
trust violation and legally fraught. Listed here only to mark it **explicitly
off-limits as a paid feature.**

**Rejected on pressure-test (do not build even for a paid tier):** boosts /
spotlight / skip-the-line / priority likes (visibility auction), consumable
currencies (SuperSwipe/Flowers/Sparks), paid message-before-match, read receipts /
activity reports / photo insights (banned surveillance/fabricated metrics), paid
algorithmic favoritism, paywalled basic privacy/incognito.

---

## 6. Marketing / positioning angle

**Core message: "The calm dating app that never charges you to be safe, to be
seen, or to see who likes you."** Ethical monetization isn't a constraint to
apologize for — it's the headline product claim, and it lands unusually hard with
a neurodivergent audience and the advocates/clinicians/parents who recommend apps
to them.

Concrete messaging:
- **"Free forever means free forever."** Safety, accessibility, matching, messaging,
  *and seeing who likes you* are free — with a public, dated promise we don't walk
  back. Put the free-forever floor on the pricing page in plain language.
- **The honest-pricing pledge (make it a page):** one price for everyone (no
  age/location/device pricing), no fake discounts, no countdown timers, cancel in
  one tap, and a **pay-what-you-can concession rate**. Every clause is a direct
  contrast to a named competitor behavior — that contrast *is* the ad.
- **Name the harm we're fixing (carefully, factually).** The community already
  knows the "financially harmful" critique of the incumbent ND app. We don't need
  to name-and-shame; we demonstrate the opposite: "No €28-for-30-minutes. No paying
  to find out who likes you. No pressure to spend money you don't have to find
  connection." Advocates will make the comparison for us.
- **"We monetize help, not anxiety."** Companion is framed as *support that helps
  you connect* (conversation help, express-yourself media, calmer discovery) — never
  as buying visibility or beating other users. The subscription copy should read
  like a helping hand, not a status upgrade.
- **Retention = outcomes, not compulsion.** Celebrate calm off-ramps: a graceful
  "we're glad you found someone — pause or export anytime" beats a re-engagement
  guilt-loop. For an audience burned by addictive apps, "you can leave easily" is a
  *reason to subscribe*, not a churn risk. Word-of-mouth in this community rewards
  trustworthiness far more than growth-hacking.

---

## 7. Risks & red lines (name them plainly, refuse them)

1. **Pressure to add boosts / "who's online" / priority to hit revenue targets.**
   The single most likely violation. **Refuse.** These break hard rule #4 + product
   law. If growth stalls, the fix is more free-tier value and word-of-mouth, not a
   visibility auction. A "see who's online now" tier is *forbidden*, not a roadmap item.

2. **Clawing back "who liked you" into the paid tier.** It's free today; competitors
   charge for it; the temptation to "capture that value" will come up. **Refuse** —
   it's our loudest differentiator and re-paywalling it would betray the promise
   publicly. Protect it in writing.

3. **Paywalling verification, privacy, or data export.** Each is a safety/trust or
   legal (GDPR) line. Hiki charges for the badge; that's the anti-pattern. **All
   three stay free.**

4. **Dynamic / age-based pricing.** Industry-standard and legally contentious.
   **Refuse** — one published price is a brand promise.

5. **The Conversation Companion (LLM) turning into deception or a dependency trap.**
   Guardrails, non-negotiable: opt-in only; clearly disclosed as assistance;
   **never auto-sends**; never impersonates the user to the other person; never
   fabricates typing/read/online signals (product law); moderation-wrapped so it
   can't be weaponized for grooming/scam scripts (must respect `safetySignals.js`);
   and framed as scaffolding that builds the user's own capability, not a permanent
   crutch. If it can't ship with these, it doesn't ship.

6. **"Considered selection" growing a timer/counter.** The moment it gains expiry or
   "X people are looking" it becomes Top Picks / scarcity. **Hard stop** at first
   sign of a countdown.

7. **Concession pricing being made humiliating.** A pay-what-you-can path must be
   frictionless and non-invasive (self-select, no proof-of-poverty gauntlet). Done
   wrong it becomes its own dark pattern.

8. **Dark-pattern billing creep** (pre-checked annual, hard cancel, drip pricing).
   Neurodivergent users are disproportionately harmed by manipulative billing
   ([context](https://www.familyoffice.com/insights/navigating-dating-apps-guide-protecting-your-privacy)).
   Clean, one-tap-cancel billing is a *feature we advertise*, not overhead.

---

*Handoffs: `product-strategist` to sequence #1 (Conversation Companion) into the
build backlog; `frontend-feature-builder` owns implementation + the ship pipeline.
This strategist decides what earns and why — not the ship mechanics. No code was
edited; no deploy was made.*
