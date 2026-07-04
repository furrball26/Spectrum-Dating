import { describe, it, expect } from 'vitest';
import { scoreCandidate } from '../src/matching/score.js';

// A fully-populated candidate we can selectively align/mismatch against.
function candidate(overrides = {}) {
  return {
    interests: ['hiking', 'reading', 'music'],
    relationship_goal: 'long-term',
    dist_city: 'Phoenix, AZ',
    sensory_environment: 'quiet',
    comm_cadence: 'daily',
    comm_directness: 'direct',
    comm_literal: 'literal',
    sensory_lighting: 'dim',
    social_duration: 'short',
    ...overrides,
  };
}

describe('scoreCandidate — moat-field alignment bonuses', () => {
  it('gives each aligned moat field a +2 and the goal a +3, on top of shared-interest weight', () => {
    const viewer = {
      interests: ['hiking', 'reading'], // 2 shared -> +4
      relationship_goal: 'long-term', // +3
      dist_city: 'Phoenix, AZ', // +2
      sensory_environment: 'quiet', // +2
      comm_cadence: 'daily', // +2
      comm_directness: 'direct', // +2
      comm_literal: 'literal', // +2
      sensory_lighting: 'dim', // +2
      social_duration: 'short', // +2
    };
    const { score, sharedInterests } = scoreCandidate(viewer, candidate());
    // 4 (interests) + 3 (goal) + 2*7 (city + 6 moat fields) = 21
    expect(sharedInterests).toEqual(['hiking', 'reading']);
    expect(score).toBe(21);
  });

  it('mismatched moat prefs score only the shared interests', () => {
    const viewer = {
      interests: ['hiking'], // 1 shared -> +2
      relationship_goal: 'friendship', // mismatch
      dist_city: 'Seattle, WA', // mismatch
      sensory_environment: 'lively', // mismatch
      comm_cadence: 'instant', // mismatch
      comm_directness: 'softened', // mismatch
      comm_literal: 'playful', // mismatch
      sensory_lighting: 'bright', // mismatch
      social_duration: 'long', // mismatch
    };
    const { score } = scoreCandidate(viewer, candidate());
    expect(score).toBe(2);
  });

  it("treats 'either' and empty moat prefs as no-bonus (not a match)", () => {
    const viewer = {
      interests: [],
      relationship_goal: '',
      dist_city: '',
      sensory_environment: 'either',
      comm_cadence: 'either',
      comm_directness: '',
      comm_literal: 'either',
      sensory_lighting: 'either',
      social_duration: '',
    };
    const { score } = scoreCandidate(viewer, candidate());
    expect(score).toBe(0);
  });

  it('accepts a bare interests array (back-compat) with no moat bonuses', () => {
    const { score, sharedInterests } = scoreCandidate(['hiking', 'music'], candidate());
    expect(sharedInterests).toEqual(['hiking', 'music']);
    expect(score).toBe(4); // 2 shared * 2, no viewer object so no goal/city/moat
  });
});

describe('scoreCandidate — special interests (D-17 soft-score)', () => {
  it('adds +3 per shared special interest (case-insensitive) and a "talk for hours" why-reason', () => {
    const viewer = {
      interests: [],
      special_interests: JSON.stringify(['Trains', 'Astronomy']),
    };
    // Candidate shares "trains" (different casing); "Astronomy" is not on their list.
    const cand = candidate({ interests: [], special_interests: JSON.stringify(['trains']) });
    const { score, sharedSpecialInterests, whyReasons } = scoreCandidate(viewer, cand);
    // 1 shared special interest * 3, no other alignment (viewer has no goal/city/moat).
    expect(score).toBe(3);
    expect(sharedSpecialInterests).toEqual(['trains']);
    // Why-reason keeps the candidate's casing.
    expect(whyReasons).toContain('You could both talk for hours about trains');
  });

  it('ZERO special-interest overlap never drops the candidate — still returned, just no bonus', () => {
    const viewer = { interests: ['hiking'], special_interests: JSON.stringify(['Trains']) };
    const cand = candidate({ interests: ['hiking'], special_interests: JSON.stringify(['Knitting']) });
    const { score, sharedInterests, sharedSpecialInterests, whyReasons } = scoreCandidate(viewer, cand);
    // Only the shared generic interest counts (+2); the differing special interest adds nothing.
    expect(sharedInterests).toEqual(['hiking']);
    expect(sharedSpecialInterests).toEqual([]);
    expect(score).toBe(2);
    expect(whyReasons.some((r) => r.startsWith('You could both talk for hours about'))).toBe(false);
  });

  it('an unset special_interests column (empty or undefined) is treated as no overlap, no throw', () => {
    const viewer = { interests: [], special_interests: '' };
    const cand = candidate({ interests: [], special_interests: undefined });
    const { score, sharedSpecialInterests } = scoreCandidate(viewer, cand);
    expect(sharedSpecialInterests).toEqual([]);
    expect(score).toBe(0);
  });
});

describe('scoreCandidate — whyReasons', () => {
  it('includes a why-reason for each aligned moat field with the right copy', () => {
    const viewer = {
      interests: ['hiking', 'reading'],
      relationship_goal: 'long-term',
      dist_city: 'Phoenix, AZ',
      sensory_environment: 'quiet',
      comm_cadence: 'daily',
      comm_directness: 'direct',
      comm_literal: 'literal',
      sensory_lighting: 'dim',
      social_duration: 'short',
    };
    const { whyReasons } = scoreCandidate(viewer, candidate());
    expect(whyReasons).toContain('You both enjoy hiking and reading');
    expect(whyReasons).toContain("You're both in Phoenix, AZ");
    expect(whyReasons).toContain('You both prefer quiet settings');
    expect(whyReasons).toContain('You both like to check in about once a day');
    expect(whyReasons).toContain('You both prefer direct communication');
    expect(whyReasons).toContain('You both take language literally');
    expect(whyReasons).toContain('You both like dim lighting');
    expect(whyReasons).toContain('You both prefer shorter get-togethers');
  });

  it('omits moat why-reasons when prefs mismatch', () => {
    const viewer = {
      interests: ['hiking'],
      relationship_goal: 'friendship',
      dist_city: 'Seattle, WA',
      sensory_environment: 'lively',
      comm_cadence: 'instant',
    };
    const { whyReasons } = scoreCandidate(viewer, candidate());
    expect(whyReasons).not.toContain('You both prefer quiet settings');
    expect(whyReasons.some((r) => r.startsWith("You're both in"))).toBe(false);
  });
});
