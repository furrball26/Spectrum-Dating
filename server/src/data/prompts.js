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

// Fast membership check for validation and catalog-text lookups.
export const PROMPT_KEYS = new Set(PROMPTS.map((p) => p.key));

// key -> text lookup, used when serializing stored answers.
export const PROMPT_TEXT_BY_KEY = new Map(PROMPTS.map((p) => [p.key, p.text]));
