// Hinge-style structured profile prompts: a fixed catalog the user picks from
// and answers in their own words. Scaffolding beats a blank bio — especially
// for autistic users — so prompts are concrete, literal, and low-ambiguity.
//
// Keys are STABLE: never rename or reuse a key. Removing a key is fine — answers
// whose key is no longer in the catalog are simply skipped when serialized
// (see listPrompts in routes/profile.js), so dropping a prompt won't crash
// existing rows.

export const PROMPTS = [
  { key: 'a_perfect_day',   text: 'A perfect day for me looks like…' },
  { key: 'talk_for_hours',  text: 'Something I could talk about for hours…' },
  { key: 'comfortable_when', text: 'I feel most comfortable when…' },
  { key: 'small_joy',       text: 'A small thing that makes me really happy…' },
  { key: 'recharge',        text: 'My favourite way to recharge is…' },
  { key: 'looking_for',     text: "Something I'm hoping to find in a person…" },
  { key: 'communicate_best', text: 'I communicate best when…' },
  { key: 'green_flag',      text: 'A green flag for me is…' },
  { key: 'weekend',         text: "You'll usually find me on a weekend…" },
  { key: 'passionate',      text: 'I get really passionate about…' },
  { key: 'good_first_meet', text: 'A good first meet-up for me would be…' },
  { key: 'understand_me',   text: 'Something that helps people understand me…' },
  // ── Richer-prompts pass (profile redesign § feature #4). APPEND-ONLY: these
  //    are new, unique keys — no existing key above was renamed or removed.
  //    Calm, concrete, literal, low-ambiguity prompts (no wit/irony required).
  { key: 'routine_i_love',      text: 'A routine I love…' },
  { key: 'learning_now',        text: "Something I'm learning right now…" },
  { key: 'message_lights_me_up', text: 'The kind of message that makes me light up…' },
  { key: 'feel_myself_place',   text: 'A place I feel completely myself…' },
  { key: 'partner_understand',  text: "Something I'd love a partner to understand about me…" },
  { key: 'low_key_evening',     text: 'My idea of a low-key perfect evening…' },
  { key: 'comfort_meal',        text: 'A meal I could happily eat every week…' },
  { key: 'calming_sound',       text: 'A sound I find calming…' },
  { key: 'happily_return_to',   text: 'A book, show, or game I happily return to…' },
  { key: 'makes_me_laugh',      text: 'Something that reliably makes me laugh…' },
  { key: 'quietly_good_at',     text: "A small thing I'm quietly good at…" },
  { key: 'calm_sunday',         text: 'A calm Sunday for me looks like…' },
  { key: 'easiest_to_start',    text: 'The easiest way to start a conversation with me…' },
  { key: 'proud_of',            text: "Something I've made or done that I'm proud of…" },
  { key: 'cozy_setup',          text: 'My idea of a cozy setup is…' },
  { key: 'care_about',          text: 'A topic I care about and like to talk about gently…' },
  { key: 'dating_pace',         text: 'The pace of dating that feels right to me…' },
  { key: 'like_knowing_plan',   text: 'Why I like knowing the plan ahead of time…' },
  { key: 'animal_i_adore',      text: 'An animal or pet I adore…' },
  { key: 'collect_or_organise', text: 'Something I like to collect or organise…' },
  { key: 'on_repeat',           text: "Music I've had on repeat lately…" },
  { key: 'hands_busy',          text: 'A quiet hobby that keeps my hands busy…' },
  { key: 'favourite_season',    text: 'The season I feel most at home in…' },
  { key: 'simple_pleasure',     text: 'A simple pleasure I never get tired of…' },
  { key: 'show_i_care',         text: 'How I show someone I care…' },
  { key: 'good_date_feels',     text: 'A good date for me feels like…' },
  { key: 'ask_me_about',        text: 'Ask me about…' },
  { key: 'safe_and_settled',    text: 'Something that helps me feel safe and settled…' },
];

// ── Typed low-pressure "choice" prompts (profile redesign § feature #3b) ───────
// A non-writing way to self-express: the member picks ONE of a small, fixed set
// of calm options. The chosen option is stored (in profile_prompts.answer) and
// shown exactly like a text prompt answer — "here's my pick", full stop.
//
// HARD PRODUCT-LAW GUARDRAIL: a choice prompt shows the member's OWN pick as
// self-expression ONLY. It is NEVER a poll — there is no vote tally, no "X%
// chose this", no counts, no "most popular", no comparison to others. If any
// aggregate/vote surface ever creeps in, that's gamification (a product-law
// violation). Keep it a calm, personal disclosure.
//
// STABLE-KEY contract (same as PROMPTS above): keys are append-only — never
// rename, reuse, or remove a key. Options are a small fixed array of 2–4 calm,
// concrete, literal strings; the stored answer must be an EXACT match of one of
// them (see PUT /profile/prompts validation). An "either/depends" option is
// included wherever it lowers the pressure to pick a side.
export const CHOICE_PROMPTS = [
  { key: 'ch_time_of_day',     text: 'Mornings or evenings?',                          type: 'choice', options: ['Mornings', 'Evenings', 'Depends on the day'] },
  { key: 'ch_night_in_or_out', text: 'Quiet night in or out and about?',               type: 'choice', options: ['Quiet night in', 'Out and about', 'A bit of both'] },
  { key: 'ch_text_or_call',    text: 'Texting or calling?',                            type: 'choice', options: ['Texting', 'Calling', 'Either is fine'] },
  { key: 'ch_plan_or_spontan', text: 'Plans or spontaneity?',                          type: 'choice', options: ['I like a plan', 'Happy to be spontaneous', 'Depends'] },
  { key: 'ch_group_size',      text: 'Small groups or big gatherings?',                type: 'choice', options: ['Small and quiet', 'Big and lively', 'Depends on my mood'] },
  { key: 'ch_early_or_late',   text: 'Early bird or night owl?',                       type: 'choice', options: ['Early bird', 'Night owl', 'Somewhere in between'] },
  { key: 'ch_coffee_or_tea',   text: 'Coffee or tea?',                                 type: 'choice', options: ['Coffee', 'Tea', 'Neither, really'] },
  { key: 'ch_sweet_or_savoury', text: 'Sweet or savoury?',                             type: 'choice', options: ['Sweet', 'Savoury', 'Both, honestly'] },
  { key: 'ch_books_or_screens', text: 'Books or screens to unwind?',                   type: 'choice', options: ['A good book', 'Something on a screen', 'A bit of both'] },
  { key: 'ch_indoors_outdoors', text: 'Cosy indoors or fresh outdoors?',               type: 'choice', options: ['Cosy indoors', 'Fresh outdoors', 'Depends on the weather'] },
  { key: 'ch_reply_pace',      text: 'Slow, thoughtful replies or quick back-and-forth?', type: 'choice', options: ['Slow and thoughtful', 'Quick back-and-forth', 'Whatever feels right'] },
  { key: 'ch_week_planning',   text: 'Plan the week ahead or take each day as it comes?', type: 'choice', options: ['Plan the week ahead', 'Take each day as it comes', 'A little of both'] },
];

// Fast membership check for validation and catalog-text lookups. TEXT-ONLY (the
// original stable contract) — the combined set below covers text + choice.
export const PROMPT_KEYS = new Set(PROMPTS.map((p) => p.key));

// The full catalog the frontend + validation use: text prompts carry an explicit
// type: 'text' so every entry is uniformly shaped ({ key, text, type, options? }).
export const ALL_PROMPTS = [
  ...PROMPTS.map((p) => ({ ...p, type: 'text' })),
  ...CHOICE_PROMPTS,
];

// Combined membership set (text + choice) — the authority for "is this a valid
// prompt key?" in PUT /profile/prompts.
export const ALL_PROMPT_KEYS = new Set(ALL_PROMPTS.map((p) => p.key));

// key -> text lookup, used when serializing stored answers. Covers BOTH text and
// choice prompts (a stored choice answer still needs its prompt text to render).
export const PROMPT_TEXT_BY_KEY = new Map(ALL_PROMPTS.map((p) => [p.key, p.text]));

// key -> 'text' | 'choice'. Authoritative prompt type (derived from the catalog,
// not the stored row) so display always matches the current catalog shape.
export const PROMPT_TYPE_BY_KEY = new Map(ALL_PROMPTS.map((p) => [p.key, p.type || 'text']));

// key -> options[] for choice prompts (used to validate a submitted pick and to
// render the selectable controls). Text keys are absent (→ undefined).
export const PROMPT_OPTIONS_BY_KEY = new Map(CHOICE_PROMPTS.map((p) => [p.key, p.options]));
