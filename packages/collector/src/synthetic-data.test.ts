import { describe, expect, test } from 'vitest';
import {
  generatePartialResults,
  type SyntheticElectorate,
} from './synthetic-data';

/**
 * A seat shaped like the real feed: candidate and party vote totals are both
 * below `total_votes_cast` because informal papers are included there.
 */
const scenario: SyntheticElectorate = {
  name: 'Test Electorate',
  totalVotesCast: 30_400,
  enrolment: 40_000,
  candidates: [
    { name: 'Smith, John', party: 'National Party', finalVotes: 16_500 },
    { name: 'Jones, Mary', party: 'Labour Party', finalVotes: 5_500 },
    { name: 'Black, Tom', finalVotes: 8_000 },
  ],
  parties: ['National Party', 'Labour Party', 'Green Party'],
  // Deliberately not a clean multiple of any test percentage.
  partyVoteFinal: [15_511, 8_777, 5_712],
};

describe('generatePartialResults', () => {
  test('scales votes and progress to the requested percentage', () => {
    const r = generatePartialResults(scenario, 0.25);

    expect(r.votesCounted).toBe(7600);
    expect(r.votePercentageCounted).toBe(0.25);
    expect(r.percentVotesCast).toBeCloseTo(0.19, 5);
  });

  test.each([0.1, 0.37, 0.5, 0.8, 1.0])(
    'scales candidate and party votes at %s',
    (percent) => {
      const r = generatePartialResults(scenario, percent);
      const candidates = r.candidateVotes.reduce((sum, c) => sum + c.votes, 0);
      const parties = r.partyVotes.reduce((sum, p) => sum + p.votes, 0);

      // Rounding each line separately can move the sum by a vote or two.
      expect(Math.abs(candidates - Math.round(30_000 * percent))).toBeLessThan(
        5
      );
      expect(Math.abs(parties - Math.round(30_000 * percent))).toBeLessThan(5);
      // The difference is the informal papers in `total_votes_cast`.
      expect(candidates).toBeLessThanOrEqual(r.votesCounted);
      expect(parties).toBeLessThanOrEqual(r.votesCounted);
    }
  );

  test('the full stage is the published result unchanged', () => {
    const r = generatePartialResults(scenario, 1);

    expect(r.votesCounted).toBe(30_400);
    expect(r.candidateVotes.map((c) => c.votes)).toEqual([
      16_500, 5_500, 8_000,
    ]);
    expect(r.partyVotes.map((p) => p.votes)).toEqual([15_511, 8_777, 5_712]);
  });

  test('keeps the candidate party affiliation', () => {
    const r = generatePartialResults(scenario, 0.5);
    expect(r.candidateVotes[0]!.party).toBe('National Party');
    expect(r.candidateVotes[2]!.party).toBeUndefined();
  });

  test('reports no turnout when the roll is unknown', () => {
    const r = generatePartialResults({ ...scenario, enrolment: null }, 0.5);
    expect(r.percentVotesCast).toBeUndefined();
  });
});
