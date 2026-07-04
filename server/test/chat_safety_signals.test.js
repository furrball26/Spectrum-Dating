import { describe, it, expect } from 'vitest';
import { classifySafetySignal, hasSafetySignal } from '../src/utils/safetySignals.js';

// Needed #4 — the classifier that drives the observe-only chat_safety_signals
// moderation trail. The send path (messaging.js) inserts one row attributed to
// the sender when this returns non-null; it NEVER blocks the message.
describe('classifySafetySignal', () => {
  it('classifies off-platform contact as off_platform (checked before money)', () => {
    expect(classifySafetySignal('add me on whatsapp')).toBe('off_platform');
    expect(classifySafetySignal('here is my email: me@example.com')).toBe('off_platform');
    expect(classifySafetySignal('text me 555-123-4567')).toBe('off_platform');
    expect(classifySafetySignal("let's move this to telegram")).toBe('off_platform');
  });

  it('classifies money/scam language as money', () => {
    expect(classifySafetySignal('send me money on venmo')).toBe('money');
    expect(classifySafetySignal('can you buy me a gift card')).toBe('money');
    expect(classifySafetySignal('invest in bitcoin with me')).toBe('money');
  });

  it('returns null for benign messages', () => {
    expect(classifySafetySignal('want to grab coffee this weekend?')).toBeNull();
    expect(classifySafetySignal('i love hiking too!')).toBeNull();
    expect(classifySafetySignal('')).toBeNull();
    expect(classifySafetySignal(null)).toBeNull();
    expect(classifySafetySignal(undefined)).toBeNull();
  });

  it('hasSafetySignal stays behavior-identical (delegates to the classifier)', () => {
    expect(hasSafetySignal('add me on whatsapp')).toBe(true);
    expect(hasSafetySignal('send me money on venmo')).toBe(true);
    expect(hasSafetySignal('want to grab coffee?')).toBe(false);
  });
});
