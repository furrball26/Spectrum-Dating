// JRN-1 — display-name screening unit tests.
import { describe, it, expect } from 'vitest';
import { containsSlur, isNameAllowed } from '../src/utils/nameScreen.js';

describe('nameScreen.containsSlur (JRN-1)', () => {
  it('flags an unambiguous slur used as a name', () => {
    expect(containsSlur('faggot')).toBe(true);
    expect(containsSlur('a nigger name')).toBe(true);
    expect(isNameAllowed('faggot')).toBe(false);
  });

  it('catches trivial leetspeak / obfuscation', () => {
    expect(containsSlur('f@ggot')).toBe(true);
    expect(containsSlur('n1gg3r')).toBe(true);
    expect(containsSlur('f.a.g')).toBe(true);
  });

  it('flags hard profanity that is never a real name/pronoun (troll cases)', () => {
    expect(containsSlur('Dipshit')).toBe(true);
    expect(containsSlur('bitch')).toBe(true);
    // The reported troll pronoun string — the first token trips it.
    expect(containsSlur('Shit/shat/shart')).toBe(true);
    expect(isNameAllowed('Dipshit')).toBe(false);
  });

  it('does NOT false-positive on legitimate names/words', () => {
    // Dick (Richard), Bishop, Twain etc. must stay allowed — the added profanity
    // terms were chosen to have no real-name collision under whole-word matching.
    for (const name of ['Alex', 'Sam', 'María', 'Anna', 'Scunthorpe', 'Cassandra', 'Assata', 'Jordan', 'Dick', 'Bishop', 'Twain', 'they/them', 'she/her', 'ze/zir']) {
      expect(containsSlur(name)).toBe(false);
      expect(isNameAllowed(name)).toBe(true);
    }
  });

  it('tolerates empty / nullish input', () => {
    expect(containsSlur('')).toBe(false);
    expect(containsSlur(null)).toBe(false);
    expect(containsSlur(undefined)).toBe(false);
  });
});
