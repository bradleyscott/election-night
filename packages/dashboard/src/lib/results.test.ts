import { describe, expect, test } from 'vitest';
import { hasCounted } from './results.js';
import { mockResults, mockZeroedResults } from '../test/fixtures.js';

// The feed's pre-election payload is the whole ballot with every count zeroed,
// so "results arrived" and "a vote was counted" are two different questions and
// every count-only page has to ask the second one. These cases pin the split.
describe('hasCounted', () => {
  test('is false before any payload arrives', () => {
    expect(hasCounted(null)).toBe(false);
    expect(hasCounted(undefined)).toBe(false);
  });

  test('is false for the zeroed ballot', () => {
    expect(hasCounted(mockZeroedResults)).toBe(false);
  });

  test('is true once a seat has counted', () => {
    expect(hasCounted(mockResults)).toBe(true);
  });

  test('is true when only the party vote has counted', () => {
    const partyOnly = {
      ...mockZeroedResults,
      partyVote: mockZeroedResults.partyVote.map((p) => ({ ...p, votes: 5 })),
    };

    expect(hasCounted(partyOnly)).toBe(true);
  });

  test('is true when only one seat out of many has counted', () => {
    const oneSeatIn = {
      ...mockZeroedResults,
      electorateResults: [
        ...mockZeroedResults.electorateResults,
        { ...mockResults.electorateResults[0], electorateName: 'Ilam' },
      ],
    };

    expect(hasCounted(oneSeatIn)).toBe(true);
  });
});
