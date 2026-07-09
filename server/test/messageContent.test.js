// Message-content screening unit tests (hide-inappropriate-by-default).
import { describe, it, expect } from 'vitest';
import { classifyInappropriate } from '../src/utils/messageContent.js';

describe('classifyInappropriate', () => {
  it('flags hard slurs (including suffixed / leeted forms)', () => {
    expect(classifyInappropriate('you are a faggot')).toBe(true);
    expect(classifyInappropriate('what a retard')).toBe(true);
    expect(classifyInappropriate('n1gg3r')).toBe(true);
    expect(classifyInappropriate('trannies')).toBe(true);
  });

  it('flags hard profanity used in a sentence (stem match)', () => {
    expect(classifyInappropriate("you're a fucking creep")).toBe(true);
    expect(classifyInappropriate('that is such bullshit')).toBe(true);
    expect(classifyInappropriate('what a bitch')).toBe(true);
    expect(classifyInappropriate('shut up asshole')).toBe(true);
    expect(classifyInappropriate('f u c k this')).toBe(true);
  });

  it('flags explicit sexual content / solicitation', () => {
    expect(classifyInappropriate('send me nudes')).toBe(true);
    expect(classifyInappropriate('wanna see a dick pic?')).toBe(true);
    expect(classifyInappropriate('you make me so horny')).toBe(true);
    expect(classifyInappropriate('i want to fuck you')).toBe(true);
  });

  it('does NOT flag clean, ordinary messages', () => {
    for (const msg of [
      'Hi! I loved your profile, especially the hiking photos.',
      'Would you like to grab coffee sometime this week?',
      'I ordered a cocktail at the new place downtown.',
      'We studied Emily Dickinson in my poetry class.',
      'The cockpit of the plane was fascinating.',
      'I passed my exam and the whole class celebrated!',
      'That analysis was really thorough, thank you.',
      'My cat is a total peacock about attention.',
      'Assata is a lovely name — where is it from?',
    ]) {
      expect(classifyInappropriate(msg)).toBe(false);
    }
  });

  it('tolerates empty / nullish input', () => {
    expect(classifyInappropriate('')).toBe(false);
    expect(classifyInappropriate(null)).toBe(false);
    expect(classifyInappropriate(undefined)).toBe(false);
  });
});
