import { describe, it, expect } from 'vitest';
import { PROMPTS, PROMPT_KEYS, PROMPT_TEXT_BY_KEY } from '../src/data/prompts.js';

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
