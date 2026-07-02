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
];

// Fast membership check for validation and catalog-text lookups.
export const PROMPT_KEYS = new Set(PROMPTS.map((p) => p.key));

// key -> text lookup, used when serializing stored answers.
export const PROMPT_TEXT_BY_KEY = new Map(PROMPTS.map((p) => [p.key, p.text]));
