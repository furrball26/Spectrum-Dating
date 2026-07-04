# Profile screen — decluttered information architecture

**Status:** proposal for sign-off (no code changed). Read-only audit + design.
**Scope:** `src/ProfileScreen.jsx` layout/IA only. No backend changes, no field
logic changes, no new fields. Every existing field keeps its `id`, its state, and
its save path — we only regroup the containers.
**Date:** 2026-07-04.

---

## Executive summary (relay this to the user)

Today the profile screen stacks **9 separate collapsible sections** on top of an
always-visible "About you" card, plus a completeness meter, a pause card, an
expand/collapse-all control, and a footer of account links. That is the clutter.
The user's instinct — "collapse the sections into About me" — is right for the
**content** sections, but flattening *everything* into one accordion would blend
three different concerns that should stay apart: **what other people see**
(profile content), **who you want matched to you** (preferences/filters), and
**your account** (notifications, profile review, membership, data, sign-out).
Every successful app we researched keeps those three apart — Hinge most
explicitly (profile edit vs. a separate Preferences screen). So the recommendation
is: keep photos + name + tagline + bio always visible at the top, then collapse
the remaining eight sections into **three** clearly-labelled groups — **About me**
(all the content sub-sections, including the F28 facets, interests, comms and
sensory expression, lifestyle and identity), **Looking for** (seeking, age,
distance, deal-breakers), and **Account** (profile review, notifications,
membership). Inside each group we use plain non-collapsing sub-headings in one
calm scroll — never accordions inside accordions — so nothing is double-hidden,
which matters for an autistic audience where "hidden" reads as unpredictable. Net
effect: the resting screen goes from ~10 headers to **4 photos/bio fields + 3
group headers**, while every field stays exactly where its save logic and the
completeness-nudge jump buttons expect it. This is mostly re-parenting existing
JSX; it ships in one frontend slice with no backend work.

---

## 1. Current-state inventory (read from the code)

Source: `src/ProfileScreen.jsx`. Render order top→bottom. `COLLAPSIBLE_SECTIONS`
(line ~59) lists the 9 collapsible ids; note its array order differs slightly from
the on-screen render order (below is render order).

### Always-visible top area (not collapsible)
- Header row: `Done` button; `<h1>Your profile</h1>` + verified badge; **Preview my card** button.
- **Profile-completeness nudge** — tile meter + missing-field chips (8 fields). Jump buttons call `jumpToField`.
- **Take a break / pause** card (`paused`) — saves on its own, instant.
- **Expand all / Collapse all** toggle (`ExpandAllToggle`).
- **Card 1 "About you"** (always open, plain `<h2>`), containing:
  - Photos gallery (`PhotoGallery`, up to 6, primary/alt-text/pending) — id `add-photo-tile`
  - `display-name` (**required**, the only hard-required field besides ≥1 interest)
  - `tagline`
  - `bio`
  - `communication-style` free-text note (`commNote`, ≤120)

### The 9 collapsible sections (each a `CollapsibleSection`)
| id | Title shown | Fields inside | Concern |
|----|-------------|---------------|---------|
| `prompts` | Prompts | up to 3 prompt Q&A (`PromptSlot`/`PromptChooser`) | **Content** |
| `about` | About me | F28 facets: `occupation`, `languages`, `helpsMe[]`, `hardForMe[]` | **Content** |
| `interests` | Your interests | `interests[]` tags (suggested + custom, ≥1 required) + `specialInterests[]` ("Could talk for hours about") | **Content** |
| `search` | About your search | `relationshipGoal`; identity: `gender`/`orientation`/`relationshipStructure`/`pronouns`; **`seeking`** (who to meet); **age range** (`prefAgeMin/Max`); **`distanceCity`**; **`searchRadiusMiles`** | **Mixed** — identity + goal are content; seeking/age/distance are filters |
| `lifestyle` | Lifestyle | `wantsChildren`, `smoking`, `drinking` (content) + deal-breakers `dbWantsChildren`/`dbNonSmoker`/`dbMustBeLocal` (filters) | **Mixed** |
| `communicate` | How you communicate | `commDirectness`, `commLiteral`, `commCadence`, `contextCard` ("How to talk to me", ≤300) | **Content** |
| `sensory` | Sensory & environment | `sensoryEnvironment`, `sensoryLighting`, `socialDuration` | **Content** |
| `notifications` | Notifications | push toggle + `notificationTier` radios | **Account/settings** |
| `verification` | Profile review | request team review (`requestVerification`) | **Account/settings** |

`membership` is slated to be added (per brief) — not yet in the code; it is an
**Account** concern.

### Footer (below the Save button)
- Account & settings **hub nav**: Safety, Settings, Account & security (change
  password/email, delete account live on `AccountSecurityScreen`).
- **Sign out**.
- **Download my data** (`getExportUrl()`, JSON export).

### Concern classification (the important part)
- **Profile CONTENT (others see):** photos, name, tagline, bio, commNote, prompts,
  F28 facets, interests + specialInterests, identity (gender/orientation/
  relationship-structure/pronouns), relationship goal, comms style + contextCard,
  sensory + social energy, lifestyle (children/smoking/drinking).
- **Matching PREFERENCES (filters, not shown as content):** seeking (who to meet),
  age range, distanceCity + searchRadius, the 3 deal-breaker toggles.
- **ACCOUNT / SETTINGS (not "about you"):** notifications, profile review,
  membership (future), pause, download data, safety, settings, account & security,
  sign-out.

**Smell to fix in the regroup:** the `search` section currently mixes identity
*content* (gender/orientation/pronouns — shown on your card) with *filters*
(seeking/age/distance). The `lifestyle` section likewise mixes shown attributes
with deal-breaker filters. The redesign separates them along the content-vs-filter
line.

---

## 2. What successful apps do (research)

All URLs accessed 2026-07-04. Where a claim comes from a third-party blog rather
than the app or its official help centre, it is marked **UNVERIFIED**.

- **Hinge** is the clearest model and the closest to what we want. Its profile
  editor groups facts into three labelled buckets — **My Vitals** (name, age,
  height, location, ethnicity, family plans, pets…), **My Virtues** (job,
  education, religion, hometown, languages, **dating intentions**), **My Vices**
  (drinking, smoking, …) — alongside **Photos**, **Prompts** (max 3 shown), and an
  **Identity** block (pronouns, gender, sexuality, who you're interested in). Each
  field has a "Visible on profile" toggle so users control what shows. Crucially,
  **Preferences ("who/what you're matched with") live on a *separate* screen**, not
  in the profile editor. (help.hinge.co "Adjust My Profile", "How do I edit my
  Profile?", "How do I change my Preferences?"). This validates: content grouped
  into a few named buckets + prompts + identity, and **preferences kept out of the
  profile edit surface**.
- **Bumble** splits **"About you"** (work, education, gender, location, hometown)
  from **"More about you"** (height, star sign, family plans), keeps **Interests**
  as its own capped list (choose up to a few; ≥1 required to show), and puts
  match **Filters** (age, distance, verified, languages, interests) behind a
  separate preferences/filters surface. (support.bumble.com "Adding information
  about you", "Using filters to set your preferences".) Same content/preferences
  split as Hinge.
- **OkCupid** uses **~9 prompted content sections** ("My self-summary", "What I'm
  doing with my life", …), each a single scrollable list you add to from a menu —
  detail-heavy but organised as one scroll of named sections, not nested
  accordions. Match questions/preferences are a distinct surface.
  (tinderprofile.ai OkCupid guide; profilecritiques.com — the section *count* is
  **UNVERIFIED** from a live OkCupid source.)
- **Tinder** is the opposite pole: a deliberately **condensed** single "Edit info"
  scroll — short bio + a small set of chips/prompts — reflecting a photo-first
  product. Useful as the "don't over-build" counterpoint. (Comparisons via
  tinderprofile.ai / vidaselect — **UNVERIFIED** from a live Tinder source.)
- **Match / Coffee Meets Bagel:** couldn't confirm current edit-screen structure
  from a live first-party source in this pass — **UNVERIFIED**; not relied on.
- **Accordions vs. single scroll (general UX):** accordions help users control
  disclosure but the classic failure is users "get lost in the middle" and lose
  track of which section they're in; they work best with **fewer than ~10
  sections** and when **multiple can stay open**. A **single scroll with light
  headings** lowers cognitive load because it avoids repeated
  click-to-reopen. Progressive disclosure reduces load *only if discoverability is
  preserved* — hiding something users then can't find is the anti-pattern.
  (eleken.co "Accordion UI"; uxpin.com and ixdf.org "Progressive Disclosure".)
- **Neurodivergent / autism-focused design:** the recurring guidance is a **calm,
  uncluttered interface with straightforward navigation** — explicitly avoid
  "complex navigation trees" and "dense visual layouts" that add cognitive load;
  provide **structured conversation starters**; reduce decision fatigue. Apps cited
  as doing this well (Mattr, Hiki) lean on clean layouts and minimal distraction.
  (tiimoapp.com sensory design; datingapps.com neurodiversity; atypikoo.com
  comparison; stephaniewalter.design cognitive-accessibility resources.)

**Design takeaways for us:**
1. Three top-level concerns (content / preferences / account) is the industry
   norm — don't flatten them together.
2. "About me" content can be **one grouped scroll of named sub-sections** (Hinge
   buckets, OkCupid sections) rather than many independent accordions.
3. Fewer top-level disclosures is better; ≤~5 top-level items, multi-open allowed.
4. For our audience specifically: **do not double-hide** (accordion inside
   accordion) and keep the order **fixed and predictable**.

---

## 3. Proposed layout (before → after)

### Before → after section map

| Before (10 top-level blocks) | After |
|---|---|
| Card 1 "About you": photos, name*, tagline, bio, commNote | **Stays always-visible at top** (photos, name*, tagline, bio). commNote folds into About me → "How I communicate". |
| `prompts` | **About me** → sub-heading *Prompts* |
| `about` (F28) | **About me** → sub-heading *More about you* |
| `interests` | **About me** → sub-heading *Interests* |
| `search` — identity + goal | **About me** → sub-heading *Identity* (gender/orientation/structure/pronouns) and *What I'm looking for* label for relationship goal (see note) |
| `search` — seeking/age/distance | **Looking for** |
| `lifestyle` — children/smoking/drinking | **About me** → sub-heading *Lifestyle* |
| `lifestyle` — deal-breakers | **Looking for** → *Deal-breakers* |
| `communicate` | **About me** → sub-heading *How I communicate* (incl. contextCard + commNote) |
| `sensory` | **About me** → sub-heading *Sensory & social* |
| `notifications` | **Account** |
| `verification` (Profile review) | **Account** |
| `membership` (future) | **Account** |
| Footer hub (Safety/Settings/Account&security/Download/Sign-out) | **Stays in footer** (unchanged) |

**9 collapsible sections → 3 collapsible groups.** Resting screen = photos + 3
core fields + 3 group headers.

### Recommended top-level structure

```
┌ Your profile (h1) · Preview my card · Done
├ Profile completeness nudge   (unchanged; jump targets remapped — see §4)
├ Take a break / pause card     (unchanged)
├ ── Core (always visible) ──
│   Photos · Display name* · Tagline · Bio
├ [▸ About me]        ← collapsible group (default OPEN first-time)
│     Prompts
│     Interests            (interests + "Could talk for hours about")
│     More about you       (occupation, languages, helps-me, hard-for-me)
│     Identity             (gender, orientation, relationship structure, pronouns)
│     How I communicate    (directness, style, reply pace, "How to talk to me", comm note)
│     Sensory & social     (setting, lighting, social energy)
│     Lifestyle            (children, smoking, drinking)
├ [▸ Looking for]     ← collapsible group (default collapsed)
│     What I'm looking for (relationship goal)
│     Who I want to meet   (seeking + "open to everyone")
│     Age range
│     Location & distance  (based-in city + search radius)
│     Deal-breakers        (3 toggles)
├ [▸ Account]         ← collapsible group (default collapsed)
│     Profile review (verification)
│     Notifications
│     Membership (when it lands)
├ Save changes  (unchanged)
└ Footer hub: Safety · Settings · Account & security · Download my data · Sign out
```

**Note on relationship goal:** it is displayed on the card (content) *and* answers
"what are you looking for". Hinge files "dating intentions" under profile content
(My Virtues). We recommend placing it as the first item in **Looking for** because
that matches the user's mental model ("looking for") and keeps the group's opening
line meaningful; it still saves and displays exactly as today. This is the one
genuinely-ambiguous field — flag it for the user to confirm which group they'd
expect it in. Everything else classifies cleanly.

### Why this reconciles the user's "collapse into About me" with good IA
- The user's real complaint is **too many top-level sections**. This cuts them
  from ~10 to ~6 visible blocks. All the *content* sub-sections genuinely do
  collapse into one **About me** — exactly the ask.
- But **Looking for** (filters) and **Account** (settings) are not "about you";
  putting notification style or a membership upsell inside "About me" would be
  confusing and is the opposite of every researched app. Keeping them as two more
  small groups is still a big declutter and preserves correct mental models.

---

## 4. Accordion vs. scroll — the recommendation for THIS audience

**Recommended: a hybrid — 3 top-level accordions, single calm scroll inside each.**

- **Top level = 3 collapsible groups** (multi-open allowed, as today). Rationale:
  well under the ~10-section threshold where accordions get lost; a short,
  predictable resting list is calmer than a long scroll of every field; and it
  directly delivers the requested declutter.
- **Inside each group = plain `<h3>` sub-headings in one scroll**, separated by the
  existing `SectionRule` divider. **No nested accordions.** Rationale: research
  flags double-disclosure as the anti-pattern; for autistic users "hidden inside
  hidden" is unpredictable and anxiety-inducing. Once you open **About me**,
  everything in it is visible in a known, fixed order — nothing is a surprise.
- **Keep the summary line on each group header** (the existing `summary` /
  `hasContent` ✓ affordance in `CollapsibleSection`) so a collapsed group still
  tells you what's filled — preserves discoverability.
- **Keep Expand all / Collapse all**, now controlling 3 groups instead of 9.
- **Default state:** About me **open** on first visit (`!hasEverSaved`) so new
  users see the content prompts; **Looking for** and **Account** collapsed. On
  return, honour persisted state. (Photos/name/tagline/bio are always visible
  regardless, so the required field is never hidden.)

**Risk to watch:** the About me panel becomes tall when open (7 sub-sections).
Mitigations already in the design: fixed order + `SectionRule` dividers + `<h3>`
headings make it scannable, and the panel only renders when open. A future polish
(deferred) could add a small anchor-chip row at the top of About me to jump between
sub-sections — but that reintroduces some visual density, so ship without it first.

---

## 5. Completeness nudge + jump buttons (must keep working)

The nudge (`computeCompleteness`, 8 fields) and its per-chip jump
(`jumpToField` → `COMPLETENESS_TARGETS`) navigate by **opening a section id then
focusing a field id**. The field ids are stable and **do not change**
(`add-photo-tile`, `tagline`, `bio`, `pronouns`, `seek-woman`, `comm-directness`,
`sensory-environment`, and prompts). Only the **section** each field lives in
changes, so the remap is mechanical:

| completeness field | old `section` | new `section` (group id) | `focusId` (unchanged) |
|---|---|---|---|
| photo | `null` (top) | `null` (still always-visible) | `add-photo-tile` |
| tagline | `null` | `null` | `tagline` |
| bio | `null` | `null` | `bio` |
| pronouns | `search` | `aboutMe` | `pronouns` |
| seeking | `search` | `lookingFor` | `seek-woman` |
| commStyle | `communicate` | `aboutMe` | `comm-directness` |
| sensory | `sensory` | `aboutMe` | `sensory-environment` |
| prompt | `prompts` | `aboutMe` | *(first control)* |

`jumpToField` already: opens the target group, polls with `requestAnimationFrame`
until the panel is un-`hidden`, then focuses `focusId` (falling back to first
control, then header) and scrolls it into view. Because it scrolls to the specific
**field id**, landing deep inside a large About me group still works — the user is
taken straight to `pronouns`/`comm-directness`/etc., not just to the group top. **No
logic change needed beyond editing the `COMPLETENESS_TARGETS` section values.**

---

## 6. Implementation sketch for `frontend-feature-builder`

This is a **re-parenting** change: keep every field's JSX, `id`, state var, and
`handleSave` payload; only change which container wraps them and the headings.

### Structure
```jsx
// Always-visible core (was Card 1) — unchanged except commNote moves out.
<div style={card}>
  <h2 style={h2Style}>About you</h2>
  <PhotoGallery .../>
  {/* display-name*, tagline, bio */}
</div>

// Group 1
<CollapsibleSection id="aboutMe" title="About me" summary={aboutMeSummary}
    hasContent={aboutMeHasContent} open={!!sectionOpen.aboutMe}
    onToggle={() => toggleSection("aboutMe")} headerStyle={h2Style} cardStyle={card}>
  <SubHeading>Prompts</SubHeading>            {/* existing prompts JSX */}
  <SectionRule/>
  <SubHeading>Interests</SubHeading>          {/* interests + specialInterests JSX */}
  <SectionRule/>
  <SubHeading>More about you</SubHeading>     {/* F28 facets JSX */}
  <SectionRule/>
  <SubHeading>Identity</SubHeading>           {/* gender/orientation/structure/pronouns JSX */}
  <SectionRule/>
  <SubHeading>How I communicate</SubHeading>  {/* comm selects + contextCard + commNote JSX */}
  <SectionRule/>
  <SubHeading>Sensory &amp; social</SubHeading> {/* sensory + socialDuration JSX */}
  <SectionRule/>
  <SubHeading>Lifestyle</SubHeading>          {/* children/smoking/drinking JSX */}
</CollapsibleSection>

// Group 2
<CollapsibleSection id="lookingFor" title="Looking for" ...>
  {/* relationship goal · seeking · age range · distanceCity+radius · deal-breakers */}
</CollapsibleSection>

// Group 3
<CollapsibleSection id="account" title="Account" ...>
  {/* verification · notifications · (membership when present) */}
</CollapsibleSection>
```

`SubHeading` is a tiny presentational component (`<h3>` styled like the existing
sub-heads such as "Deal-breakers"/"Could talk for hours about") — **no hooks**, so
it's safe anywhere including near maps. Do **not** introduce `useFocusable` inside
any `.map()` body (React #310 house rule) — the existing extracted-button pattern
(`StarterButton`, `FacetRow`, `CompletenessChipButton`) already covers every list;
regrouping doesn't add new loops.

### Config edits
- `COLLAPSIBLE_SECTIONS = ["aboutMe", "lookingFor", "account"]` (was the 9 ids).
  This automatically fixes `allExpanded` / Expand-all.
- `COMPLETENESS_TARGETS`: change `section` values per the table in §5 (focusIds
  untouched).
- Group header `summary`/`hasContent`: derive each group's summary by OR-ing the
  old per-section `hasContent` flags (e.g. `aboutMeHasContent = promptsHasContent
  || aboutHasContent || interestsHasContent || communicateHasContent ||
  sensoryHasContent || <lifestyle/identity flags>`). The per-field summary
  builders already exist; just recombine.

### Smallest valuable slice (ship first)
1. Wrap existing JSX into the 3 groups + `SubHeading`s (pure move).
2. Update `COLLAPSIBLE_SECTIONS`, `COMPLETENESS_TARGETS`, group summaries.
3. Bump the storage key (see risks) and set default-open for About me.
   → This alone delivers the full declutter. No backend, no field changes.

### Later polish (separate, optional)
- Merge the redundant top-level **commNote** ("Communication style") with the
  **contextCard** ("How to talk to me") — two free-text comms fields is itself
  clutter. (Field/data change — do deliberately, not in the layout slice.)
- Per-sub-heading ✓ "done" ticks; anchor-chip jump row inside About me.
- Consider moving **Looking for** entirely onto a separate Filters/Preferences
  screen (the Hinge/Bumble model) if the profile page still feels long — but that
  is a navigation change beyond this IA pass; note it and defer.

---

## 7. Migration risks

- **`SECTIONS_STORAGE_KEY` (`spectrum_profile_sections`)** persists the **old** ids
  (`prompts`, `about`, …). New group ids (`aboutMe`/`lookingFor`/`account`) won't
  collide, so stale entries are harmless but dead. **Recommend bumping to
  `spectrum_profile_sections_v2`** so returning users start on the intended default
  (About me open) instead of an empty/again-collapsed state, and the old key can be
  ignored/left to expire. Low risk either way.
- **Section ids referenced by the jump logic** — the only code coupling is
  `COMPLETENESS_TARGETS.section` and `sectionOpen[key]`; both are updated in the
  same change. `focusId`s are stable, so deep-jump still lands on the right field.
- **`allExpanded` / Expand-all** derives from `COLLAPSIBLE_SECTIONS`; updating that
  array is sufficient.
- **Hooks invariant** — no new hooks in loops; `SubHeading` is hookless. Safe.
- **Tall open panel** — About me is long when expanded; mitigated by fixed order +
  dividers + render-only-when-open (see §4).
- **No backend impact** — payload shape, field names, and save endpoints are
  untouched; this is presentation only.

---

## 8. Recommended layout (crisp)

Always-visible core (photos, name*, tagline, bio) → **3 collapsible groups**:
**About me** (prompts, interests + deep interests, more-about-you facets, identity,
how-I-communicate, sensory & social, lifestyle), **Looking for** (relationship
goal, who I want to meet, age range, location & distance, deal-breakers), **Account**
(profile review, notifications, membership). Plain `<h3>` sub-headings in one calm
scroll inside each group — no nested accordions, fixed predictable order. Keep the
completeness nudge, pause card, save button, and footer hub as-is; remap the nudge's
three section-jump targets to the new group ids (field ids unchanged). Ships as one
frontend re-parenting slice, no backend changes.

---

### Sources (accessed 2026-07-04)
- Hinge — [Adjust My Profile](https://help.hinge.co/hc/en-us/sections/36232232474771-Adjust-My-Profile), [How do I edit my profile?](https://help.hinge.co/hc/en-us/articles/360011053094-How-do-I-edit-my-profile), [How do I change my Preferences?](https://help.hinge.co/hc/en-us/articles/360011063294-How-do-I-change-my-Preferences), [How do I edit my Prompts?](https://help.hinge.co/hc/en-us/articles/36311352171539-How-do-I-edit-my-Prompts)
- Bumble — [Adding information about you](https://support.bumble.com/hc/en-us/articles/28530815473949-Adding-information-about-you), [Using filters to set your preferences](https://support.bumble.com/hc/en-us/articles/28423691289629-Using-filters-to-set-your-preferences), [Profile setup and editing](https://support.bumble.com/hc/en-us/sections/28055400878877-Profile-setup-and-editing)
- OkCupid (structure, section count UNVERIFIED from first-party) — [OkCupid profile guide](https://profilecritiques.com/blog/okcupid-profile-guide-ai), [OkCupid tips](https://tinderprofile.ai/blog/okcupid-profile-tips-for-men/)
- Accordion vs. scroll / progressive disclosure — [Eleken: Accordion UI](https://www.eleken.co/blog-posts/accordion-ui), [UXPin: Progressive Disclosure](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/), [IxDF: Progressive Disclosure](https://ixdf.org/literature/topics/progressive-disclosure)
- Neurodivergent / autism-friendly design — [Tiimo: sensory design](https://www.tiimoapp.com/resource-hub/sensory-design-neurodivergent-accessibility), [DatingApps.com: neurodiversity](https://www.datingapps.com/blog/neurodiversity-and-dating-apps/), [Atypikoo: neurodivergent apps compared](https://www.atypikoo.com/page/neurodivergent-dating-apps-comparison/), [Stéphanie Walter: cognitive accessibility](https://stephaniewalter.design/blog/neurodiversity-and-ux-essential-resources-for-cognitive-accessibility/)
