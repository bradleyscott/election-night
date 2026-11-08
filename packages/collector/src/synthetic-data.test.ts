import { describe, expect, test } from 'vitest';
import {
  generatePartialResults,
  type SyntheticElectorate,
} from './synthetic-data';

const scenario: SyntheticElectorate = {
  name: 'Test Electorate',
  totalValidVotes: 30_000,
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

    expect(r.votesCounted).toBe(7500);
    expect(r.votePercentageCounted).toBe(0.25);
  });

  test.each([0.1, 0.37, 0.5, 0.8, 1.0])(
    'candidate votes sum to votesCounted at %s',
    (percent) => {
      const r = generatePartialResults(scenario, percent);
      const total = r.candidateVotes.reduce((sum, c) => sum + c.votes, 0);
      expect(total).toBe(r.votesCounted);
    }
  );

  test.each([0.1, 0.37, 0.5, 0.8, 1.0])(
    'party votes sum to votesCounted at %s',
    (percent) => {
      const r = generatePartialResults(scenario, percent);
      const total = r.partyVotes.reduce((sum, p) => sum + p.votes, 0);
      expect(total).toBe(r.votesCounted);
    }
  );

  test('keeps the candidate party affiliation', () => {
    const r = generatePartialResults(scenario, 0.5);
    expect(r.candidateVotes[0]!.party).toBe('National Party');
    expect(r.candidateVotes[2]!.party).toBeUndefined();
  });
});
