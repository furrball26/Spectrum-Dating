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

  it('does NOT false-positive on legitimate names/words', () => {
    for (const name of ['Alex', 'Sam', 'María', 'Anna', 'Scunthorpe', 'Cassandra', 'Assata', 'Jordan']) {
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
