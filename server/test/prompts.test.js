import { describe, it, expect } from 'vitest';
import {
  PROMPTS,
  PROMPT_KEYS,
  PROMPT_TEXT_BY_KEY,
  CHOICE_PROMPTS,
  ALL_PROMPTS,
  ALL_PROMPT_KEYS,
  PROMPT_TYPE_BY_KEY,
  PROMPT_OPTIONS_BY_KEY,
} from '../src/data/prompts.js';

// The original 12 keys are a STABLE CONTRACT (see prompts.js header): existing
// answers are keyed to them, so they must never be renamed, reused, or removed.
const ORIGINAL_KEYS = [
  'a_perfect_day', 'talk_for_hours', 'comfortable_when', 'small_joy',
  'recharge', 'looking_for', 'communicate_best', 'green_flag', 'weekend',
  'passionate', 'good_first_meet', 'understand_me',
];

describe('prompt catalog (richer-prompts pass)', () => {
  it('has ~40 prompts after the expansion', () => {
    // Expanded 12 → ~40. Assert a healthy floor so an accidental truncation
    // (or a bad merge dropping the append block) fails loudly.
    expect(PROMPTS.length).toBeGreaterThanOrEqual(38);
    expect(PROMPTS.length).toBeLessThanOrEqual(48);
  });

  it('has all-unique stable keys', () => {
    const keys = PROMPTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    // PROMPT_KEYS (the Set used for validation) must agree with the array.
    expect(PROMPT_KEYS.size).toBe(keys.length);
  });

  it('every entry has a snake_case key and non-empty text', () => {
    for (const p of PROMPTS) {
      expect(p.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof p.text).toBe('string');
      expect(p.text.trim().length).toBeGreaterThan(0);
      expect(PROMPT_TEXT_BY_KEY.get(p.key)).toBe(p.text);
    }
  });

  it('still contains every one of the original 12 keys', () => {
    for (const key of ORIGINAL_KEYS) {
      expect(PROMPT_KEYS.has(key)).toBe(true);
    }
  });
});

describe('typed choice prompts (§3b)', () => {
  it('has a healthy set (8–12) of choice prompts', () => {
    expect(CHOICE_PROMPTS.length).toBeGreaterThanOrEqual(8);
    expect(CHOICE_PROMPTS.length).toBeLessThanOrEqual(12);
  });

  it('every choice prompt is well-formed (stable key, text, 2–4 options)', () => {
    for (const p of CHOICE_PROMPTS) {
      expect(p.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(p.type).toBe('choice');
      expect(typeof p.text).toBe('string');
      expect(p.text.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(p.options)).toBe(true);
      expect(p.options.length).toBeGreaterThanOrEqual(2);
      expect(p.options.length).toBeLessThanOrEqual(4);
      // Options are non-empty, unique strings within the prompt.
      const opts = p.options;
      expect(new Set(opts).size).toBe(opts.length);
      for (const o of opts) {
        expect(typeof o).toBe('string');
        expect(o.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('choice keys are disjoint from text keys, and the combined key set unions both', () => {
    for (const p of CHOICE_PROMPTS) expect(PROMPT_KEYS.has(p.key)).toBe(false);
    expect(ALL_PROMPTS.length).toBe(PROMPTS.length + CHOICE_PROMPTS.length);
    expect(ALL_PROMPT_KEYS.size).toBe(ALL_PROMPTS.length); // all-unique across text + choice
    for (const p of PROMPTS) expect(ALL_PROMPT_KEYS.has(p.key)).toBe(true);
    for (const p of CHOICE_PROMPTS) expect(ALL_PROMPT_KEYS.has(p.key)).toBe(true);
  });

  it('type + text + options lookups agree with the catalog', () => {
    for (const p of PROMPTS) {
      expect(PROMPT_TYPE_BY_KEY.get(p.key)).toBe('text');
      expect(PROMPT_OPTIONS_BY_KEY.has(p.key)).toBe(false); // text keys carry no options
    }
    for (const p of CHOICE_PROMPTS) {
      expect(PROMPT_TYPE_BY_KEY.get(p.key)).toBe('choice');
      expect(PROMPT_TEXT_BY_KEY.get(p.key)).toBe(p.text);
      expect(PROMPT_OPTIONS_BY_KEY.get(p.key)).toEqual(p.options);
    }
  });
});
