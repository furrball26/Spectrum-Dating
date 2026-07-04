# Profile Page — Competitor & Visual Research

**For:** Spectrum Dating profile redesign (ground-up).
**Scope:** How successful dating apps design both the *view-my-profile* and *edit-profile* experiences, what makes a profile feel polished/premium (not "basic"), and where Membership is surfaced.
**Method:** WebSearch + WebFetch, July 2026. All URLs cited with access date **2026-07-04**. Claims taken from app help-centre/newsroom pages are treated as reliable; third-party blog claims (VIDA, Roast, ProfileCritiques, etc.) and pricing are marked **[unverified]** because apps A/B-test aggressively and third parties are marketing SEO.
**Read-only research task.** No product code was changed. Current-state note is grounding only (see final section).

---

## 1. Competitor teardown table

| App | Structure & IA (view vs edit; About vs Preferences vs Account vs Membership) | Visual design language | Standout "rich" profile features | Membership placement |
|---|---|---|---|---|
| **Hinge** | Edit Profile is one scrolling screen reached from the photo/gear icon; content is **modular cards** — Photos, Written Prompts (pick **3**, 150-char cap), Voice Prompt, Video Prompts, Prompt Polls, then "Vitals/Virtues/Vices" tag fields. **Preferences** (who you see) and **Account/Subscription** are separated under the gear (Settings), *not* mixed into the profile content. | **Card-per-answer** is the whole identity. A prompt is a discrete card layered over/under a photo; profiles read as an alternating photo→prompt→photo stack. Generous whitespace, one idea per card, serif-ish editorial tone. This "one card at a time" browsing is the pattern the whole industry copied. | Voice Prompts (30s audio), **Video Prompts** (30s in-app video, appears beneath main photo), **Prompt Polls** (3-choice interactive poll), AI "Prompt Feedback" coaching nudges. Hinge claims video profiles get "+62% likes / 3.4x conversations" **[unverified vendor stat]**. | Under **gear → Settings → Subscription** (Hinge+ / HingeX). Kept OUT of the profile-content edit flow; upsell surfaces contextually (e.g. "see everyone who liked you"). |
| **Bumble** | Profile page has a **"Complete my profile" progress button** under your photo. Edit splits into **"My basics"** (Basic Info badges) and **"More about me"** (Interest badges + prompts). Preferences/filters are separate. | **Badge/chip system.** Two badge tiers: Basic Info badges (work, education, height, star sign, drinking, smoking, kids, politics, religion, "looking for") and up to **5 Interest badges** from ~200 across 12 categories. Visual, icon-led chips rather than prose. | Interest badges as a visual vocabulary; you can now **filter matches by shared interest badges**; "self-care" interest badges + prompts; culturally-refreshed badges (memes, houseplants, mocktails). | Premium (Boost/Premium) surfaced separately; profile itself pushes **profile-completeness %** rather than a hard paywall on the profile screen. |
| **Tinder** | 2023 redesign moved Tinder "beyond photo swiping": profile now carries **Prompts**, a **Quiz**, and **Info Tags** in addition to photos. Edit is tabbed/sectioned; dark mode added. | Shifted from photo-only to a **tag + prompt** layout to give conversation hooks. Info Tags cover interests, pets, drinking, zodiac. 2026 roadmap: "Visual Interests," Photo Enhance, richer profile home to push completion. | Profile Prompts ("Two truths and a lie", "The key to my heart is"), self-authored **Quizzes**, Info Tags. **Report-specific-content** built into the new sections (safety). | Gold/Platinum upsell lives outside the profile edit; surfaced at feature-gates, not as a profile section. |
| **Coffee Meets Bagel (CMB)** | Edit is a clean **3-tab switcher at the top: Prompts / Photos / Details** — arguably the cleanest IA of the set. "Details" holds structured preferences (ethnicity, relationship goal, family plans). Done button top-right. | Prompt-answer driven ("I am", "I like", "I appreciate when my date…") replacing a long bio. Up to **9 photos with 140-char captions**. Tab model keeps cognitive load low — you're only ever editing one facet. | Photo **captions** (context per image), curated prompt set, structured Details enums, verification. | Premium is a separate flow; profile edit stays focused on self-expression. |
| **Match (Match.com)** | Classic web-heritage IA: long profile with **"About Me"** essay + **"What You're Looking For"**, and the ability to mark a preference as a **"Must-Have."** More form-like/verbose than the app-native set. | Essay + structured Q&A; less card/chip, more list/section. Reads "mature/dense" vs the Gen-Z apps. | Must-Have preferences, long-form essays; Premium adds **Zen Mode** (only matching profiles can contact you) and **Boost Mode** (more prominent placement). | Subscription packages (1/3/6/12 mo) are a distinct area; premium modes advertised on a dedicated `/premium` page, not woven into the profile essay. |
| **OkCupid** | **9 profile sections**, each picks 1 of ~5–6 prompts (e.g. "My self-summary", "What I'm doing with my life"); plus **10 free-text Profile Questions** and the famous **Match Questions** (answer without typing; add public explanations). | Section-per-topic prose + a huge structured **Match Questions** engine that powers a compatibility %. Identity-forward (extensive gender/orientation/relationship options). | Match Questions → compatibility scoring; deep identity fields; long-form self-expression. The differentiator is *values/compatibility data*, not media. | Premium (A-List) gates advanced filters/see-likes; not a profile-content section. |
| **Feeld** | Edit sections: photos, Feeld name, gender, sexuality, **About**, a separate **hidden/private bio**, **Desires** (intimacy/connection tags, ≤10 from a curated ~30+), **Interests** (hobbies, custom allowed), privacy. | **Curated-tag system with in-app glossary cards** explaining every Desire/identity term — a strong accessibility/plain-language pattern. **Shared desires auto-highlight** on others' profiles. Private bio + private photos separate the public/intimate layers. | Glossary cards (define every option in-app), shared-desire highlighting, **incognito mode, private photos, screenshot protection** (2025 privacy set). | Majestic (paid) unlocks full desire filtering + "Who Likes Me" by desire. Surfaced at the filter, not shoved onto the profile. |
| **The League** | Profile setup: age, occupation, height, gender, "what you're looking for" prompts, **Opening Video** intro, connect Instagram/LinkedIn, 3+ photos. Heavy on **status signalling** (education, career, "League score"). | Premium/aspirational visual tone; **profile stats/analytics** ("track and see your profile stats") are a paid perk. | **Opening Video** intro; profile analytics; Instagram/LinkedIn integration. | **Membership is central and loud** — tiered (Member / Investor / VIP) with steep pricing **[unverified: ~$99/wk to ~$2,499/mo]**, "additional profile customization" and stats gated behind it. This is the *dark-pattern end* of membership prominence — a caution, not a model. |

**Autism-/accessibility-forward patterns worth noting** (from neurodivergent-app coverage and sensory-design guidance): calm, uncluttered layouts with ample whitespace; predictable behaviour and no surprise pop-ups; **guided/explicit prompts that make literal language acceptable** and reduce guessing about intent; user-controllable notifications and "browse without a timer"; ability to state communication style and sensory limits up front; **in-app glossaries that define every term** (Feeld's pattern); adjustable font size/contrast. Mindful-dating apps cap daily profiles (7–9) to reduce overload. Sources: accessibility.com, tiimoapp, atypikoo, heyasd (see Sources).

---

## 2. What actually makes a profile feel RICH vs "basic"

Cross-app, the difference between "premium" and "basic" is **not more form fields** — it's these, in rough order of impact:

1. **Media variety beyond photos** — voice prompt, video prompt. This is the single biggest "alive vs. flat" lever (Hinge's whole differentiation).
2. **Card-per-idea layout** — each answer is a discrete, well-spaced card, not a wall of labelled inputs. One idea per card = feels designed, reads calm.
3. **Prompt variety + interactivity** — written prompts, polls, "two truths", quizzes give personality *and* conversation hooks. Interactivity (polls) invites a reply.
4. **Visual chips/badges for interests & vitals** — icon-led tags (Bumble, Tinder) instead of comma lists read instantly and feel modern.
5. **A real "view as others see you" preview** — the app treats your profile as a *presented object*, not just a settings form. Its absence is the #1 reason a profile feels "basic and unintuitive."
6. **Verification & identity badges shown with visual weight** — a verified check, pronoun/identity tags displayed proudly.
7. **Glossary / plain-language scaffolding** (Feeld) — every option explained in-app; especially strong for our audience.
8. **Completeness guidance framed as help, not a score** — Bumble's % works but edges into gamification; the *helpful* version is "add a voice note to help people picture you," not "34% — keep going!"

**What makes profiles feel basic:** an edit-only screen that is a stack of labelled `<select>`/`<textarea>` fields with no hero, no preview, no media, and prose interests. (This is close to our current state.)

---

## 3. Where Membership belongs on the profile (without dark patterns)

- **Hinge / Tinder / Bumble / Feeld** keep subscription in **Settings/Account**, and upsell *contextually* at the feature gate ("see who likes you"). Clean, low-pressure — but the user's brief is that Membership should be its **own prominent section, not buried**, so pure "hide it in settings" under-serves the ask.
- **The League** makes membership loud and central — but via **status pressure, stats, and steep tiers**: the dark-pattern end. Reject the pressure; keep only the "give membership a clear home" idea.
- **Match** dedicates a whole `/premium` page describing Zen/Boost modes calmly — a decent model for an honest, described tier.

**Synthesis for us:** Membership gets its **own top-level, clearly-labelled section on the profile** (satisfying the brief), presented as an *honest description of what's included* — plain language, no countdown, no "limited time," no fabricated "3x more matches," no locked-content teasing on the profile itself. Show current plan status ("You're on the free plan") and a calm "See what's included" link. This is the opposite of The League's stat-shaming and pricing pressure.

---

## 4. Recommended new profile structure & visual direction for Spectrum Dating

**Reconciling "rich / intuitive / not-basic" with calm-by-design.** The tension resolves cleanly: *rich* comes from **media + card layout + a preview mode**, none of which require gamification, urgency, or sensory overload. We adopt the *presentation* patterns and reject the *pressure* patterns.

### 4a. ADOPT / ADAPT / REJECT

**ADOPT (as-is, on-brand):**
- **Card-per-idea layout** (Hinge/CMB) — each prompt, each facet is a calm card.
- **A dedicated "View my profile" preview mode** ("see how others see you") — the biggest fix for "unintuitive/basic."
- **CMB's 3-tab edit IA** (Prompts / Photos / Details) as a mental model — one facet at a time = low cognitive load.
- **Feeld's in-app glossary cards** — define every option/identity term inline. Perfect for our audience.
- **Visual interest chips** instead of prose lists (we already have `interests` + `specialInterests` data).
- **Verification + identity badges shown with visual weight** (we already have `VerifiedBadge`).
- **Voice Prompt** as our one "rich media" differentiator (see slice plan).

**ADAPT (de-pressurize):**
- **Completeness guidance** → keep as gentle, itemised *suggestions* ("Add a voice note so people can picture a first chat — optional"), **never a % score or streak**. No "profile strength" gauge.
- **Membership section** → present, prominent, but described honestly with plan status; no upsell dark patterns.
- **Prompt polls / interactivity** → allow, but framed as low-pressure and optional; no "boost your likes" nudges.
- **Photo hero** → a calm hero (main photo + name + pronouns + verified), but with our reduced-sensory fallback (default gradient avatar already exists) and no autoplay/motion.

**REJECT (dark patterns / overstimulating):**
- Profile-strength **percentages, streaks, "X% done," achievement badges** (gamification — banned by CLAUDE.md).
- The League–style **profile stats/analytics, "score,"** and pressure pricing.
- **Video prompts with autoplay**, animated match screens, urgency/limited-time membership copy.
- Any "you'll get 3x more matches" **fabricated metrics** on the profile.
- Online/last-seen, typing indicators (already banned).

### 4b. Section-by-section layout sketch (top → bottom)

The redesign splits the current single edit-form into **two modes** with a clear toggle at top: **View** (default landing — "how others see you") and **Edit**.

**VIEW MODE (the fix for "basic"):**
```
┌──────────────────────────────────────────────┐
│  [ View ]  Edit            ⚙ (settings)       │  ← mode toggle + gear
├──────────────────────────────────────────────┤
│  HERO                                          │
│   ▢ main photo (4:5, calm, no motion)          │
│   Name · age    ✓ Verified                     │
│   pronouns · coarse city                        │
├──────────────────────────────────────────────┤
│  ▶ Voice intro (optional)  [ play ]  30s        │  ← rich media, tap-to-play only
├──────────────────────────────────────────────┤
│  PROMPT CARD  "Could talk for hours about…"    │  ← card-per-idea
│   your answer, calm serif                       │
│  PHOTO                                          │
│  PROMPT CARD  …                                 │
├──────────────────────────────────────────────┤
│  About me   (chips + plain facets)              │
│   [interest] [interest] [special interest]      │
│   Occupation · Languages                        │
│   Communication style · Sensory preferences     │
├──────────────────────────────────────────────┤
│  Looking for  (calm summary, not filters)       │
├──────────────────────────────────────────────┤
│  "This is how your profile appears to others."  │  ← reassurance line
└──────────────────────────────────────────────┘
```

**EDIT MODE (organised, low-load):** keep our existing 3 calm groups but re-skin as clear facet-cards, mirroring the CMB tab model and Hinge card model:

1. **Photos** — hero + gallery (we already have a good gallery + alt-text; keep).
2. **Prompts & voice** — written prompt cards (3, with our starter scaffolding — a genuine autism-forward asset already built) + **one voice prompt** slot.
3. **About me** — interest chips, special interests, occupation/languages, "things that help me / are hard for me" facets (already exist — surface as chips, not raw lists).
4. **Communication & sensory** — our moat fields, presented with glossary tooltips (Feeld-style plain definitions).
5. **Looking for** — relationship goal/structure, seeking, age range, distance, deal-breakers (display-only framing kept calm).
6. **Membership** *(NEW top-level section)* — plan status + honest "what's included," calm, no pressure.
7. **Account & privacy** — verification, notifications tier, pause, export, sign out.

### 4c. Smallest-valuable-slice vs later-polish

**Smallest valuable slice (ships the "not basic" feeling fast):**
1. **Add a View/Preview mode** ("how others see you") rendering existing data as a calm card stack + hero. *Highest impact, mostly presentational — no new backend.*
2. **Re-skin interests/special-interests as visual chips** (data already exists).
3. **Promote Membership to its own top-level section** with honest plan-status copy (satisfies the explicit brief; likely low backend need if a plan flag exists).
4. **Card-per-prompt visual treatment** in both modes.

**Later polish:**
- **Voice prompt** (needs upload/storage/playback + moderation — real backend work; our one "rich media" differentiator, worth doing second).
- Optional **prompt poll** (interactive, de-pressurized).
- **Glossary tooltip cards** on communication/sensory/identity options (Feeld-style).
- Gentle, itemised completeness *suggestions* (never a score).

---

## Executive summary (relay to user)

Across the market, what separates a "premium" profile from a "basic" one is **not more fields — it's presentation and media**: Hinge's card-per-idea layout plus voice/video prompts, Bumble/Tinder's visual interest chips, CMB's ultra-clean three-tab edit, Feeld's in-app glossary that defines every option, and above all a real **"view how others see you" mode** — the thing our current edit-only, form-heavy screen lacks, which is exactly why it reads as basic. For Spectrum Dating I recommend a ground-up split into a **View mode** (calm photo hero → tap-to-play voice intro → alternating prompt/photo cards → interest chips → looking-for summary) and an **organised Edit mode** grouped as Photos / Prompts+Voice / About / Communication+Sensory / Looking-for / **Membership (its own prominent, honestly-described top-level section)** / Account. We **adopt** card layout, chips, preview mode, and Feeld-style glossaries; **adapt** completeness into gentle optional suggestions and membership into a no-pressure described tier; and **reject** every gamification/urgency/stats pattern (profile-strength %, streaks, The League's scores, autoplay video, fabricated "3x matches" claims). Smallest valuable slice: add the preview mode, chip-ify interests, and give Membership its own section — all mostly presentational over existing data; voice prompt and glossary tooltips follow as second-phase polish.

---

## Sources (accessed 2026-07-04)

- Hinge — Voice Prompts: https://hinge.co/newsroom/voiceprompts
- Hinge — Video Prompts & Prompt Polls: https://hinge.co/newsroom/video-prompts-prompt-polls
- Hinge — Prompt Feedback (AI coaching): https://hinge.co/newsroom/prompt-feedback
- Hinge — Subscribing to Hinge+/HingeX: https://help.hinge.co/hc/en-us/articles/36311070196243-Subscribing-to-Hinge-or-HingeX
- Hinge — Subscription & Purchase Benefits: https://help.hinge.co/hc/en-us/articles/38014282744595-Subscription-and-Purchase-Benefits
- Bumble — Profile setup & editing (support): https://support.bumble.com/hc/en-us/sections/28055400878877-Profile-setup-and-editing
- Bumble — Basic Info & Interest Badges: https://bumble.com/en/the-buzz/bumble-badges
- Bumble — Adding your interests: https://support.bumble.com/hc/en-us/articles/28530297182365-Adding-your-interests
- Tinder — profile redesign (TechCrunch, 2023-11-20): https://techcrunch.com/2023/11/20/tinder-redesigns-profile-pages-with-prompts-info-tags-and-quiz/
- Tinder — Interests (help): https://www.help.tinder.com/hc/en-us/articles/360046122691-Interests
- Tinder — Sparks 2026 keynote (roadmap): https://www.tinderpressroom.com/2026-03-12-Tinder-Debuts-Inaugural-Product-Keynote-Tinder-Sparks-2026-Start-Something-New
- Coffee Meets Bagel — Profile & Account (support): https://coffeemeetsbagel.zendesk.com/hc/en-us/sections/360003117693-Profile-and-Account
- Coffee Meets Bagel — How do I edit my profile: https://coffeemeetsbagel.zendesk.com/hc/en-us/articles/360020974453-How-do-I-edit-my-profile
- Match — Edit Your Profile (help): https://help.match.com/hc/en-us/articles/12625991507867-Edit-Your-Profile
- Match — Premium benefits: https://www.match.com/premium
- OkCupid — Profile (support): https://okcupid-app.zendesk.com/hc/en-us/sections/22707390701211-Profile
- OkCupid — Edit My Profile: https://okcupid-app.zendesk.com/hc/en-us/articles/22743514651803-Edit-My-Profile
- Feeld — Edit your profile details (help): https://support.feeld.co/hc/en-gb/articles/9406784112028-Edit-your-profile-details
- Feeld — Desires, Relationship Types, Sexualities, Genders explained: https://support.feeld.co/hc/en-gb/articles/18822038569884-Desires-Relationship-Types-Sexualities-and-Genders-on-Feeld-Profiles-Explained
- Feeld — What are Interests and Desires: https://feeld.co/ask-feeld/how-to/what-are-interests-and-desires-on-feeld
- The League — Membership / Member Perks: https://www.theleague.com/membership/
- The League — membership tiers/pricing (Roast, third-party) **[unverified]**: https://roast.dating/blog/the-league-memberships
- Completeness-meter design pattern (UI-Patterns): https://ui-patterns.com/patterns/CompletenessMeter
- Sensory-friendly design (accessibility.com): https://www.accessibility.com/blog/sensory-friendly-design-creating-digital-spaces-that-support-autistic-users
- Sensory design for ADHD/Autism (Tiimo): https://www.tiimoapp.com/resource-hub/sensory-design-neurodivergent-accessibility
- Neurodivergent dating apps compared (Atypikoo): https://www.atypikoo.com/page/neurodivergent-dating-apps-comparison/
- Best autism dating apps (HeyASD): https://www.heyasd.com/blogs/autism/autism-dating-services

---

### Current-state grounding (not part of competitor research)
Our `src/ProfileScreen.jsx` is a single **edit-only** screen: three collapsible groups (`aboutMe` / `lookingFor` / `account`) rendered as a long stack of labelled inputs, selects, and toggles. It already has genuinely good, autism-forward assets — Hinge-style prompt cards with **plain-language starter scaffolding**, photo alt-text, a moat of communication/sensory fields, verification, and (per the section list) a membership block. What it lacks is exactly what makes competitors feel non-basic: **a "view how others see you" mode, a photo hero, media (voice), and visual chips instead of form fields.** The redesign should reuse the existing data and validation and focus effort on *presentation + a preview mode*, not net-new fields.
