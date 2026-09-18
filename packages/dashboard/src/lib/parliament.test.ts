import { describe, expect, test } from 'vitest';
import { getOpacity, type ElectorateEntry } from './parliament.js';

function electorate(
  marginPercent: number,
  marginOfError: number
): ElectorateEntry {
  return {
    electorateName: 'Test',
    partyVotes: [],
    candidateVotes: [],
    votesCounted: 1000,
    votePercentageCounted: 1,
    leaders: {
      leadingCandidate: 'Alice',
      leadingCandidateParty: 'Red Party',
      secondCandidate: 'Bob',
      secondCandidateParty: 'Blue Party',
      margin: marginPercent * 1000,
      marginPercent,
      predictionStatus: 'too-close',
    },
    marginOfError,
  };
}

describe('getOpacity', () => {
  test('is solid for a projected race', () => {
    expect(getOpacity(electorate(0.2, 0.02))).toBeCloseTo(0.8);
  });

  test('is dim for a too-close race', () => {
    expect(getOpacity(electorate(0.01, 0.02))).toBeCloseTo(0.2);
  });

  test('is finite at a complete count where marginOfError is 0', () => {
    const value = getOpacity(electorate(0.11, 0));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeCloseTo(0.8);
  });

  test('does not produce NaN for an electorate with no candidate votes', () => {
    const value = getOpacity(electorate(0, 0));
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBeCloseTo(0.2);
  });
});
