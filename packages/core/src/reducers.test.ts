import { describe, expect, test } from 'vitest';
import {
  calculateLead,
  predictWinner,
  calculatePartyVoteWithPercentages,
} from './reducers.js';
import type { ElectorateResults } from './types.js';

function makeElectorate(
  overrides: Partial<ElectorateResults> = {}
): ElectorateResults {
  return {
    electorateName: 'Test',
    partyVotes: [
      { candidate: 'Red Party', votes: 4000 },
      { candidate: 'Blue Party', votes: 3000 },
    ],
    candidateVotes: [
      { candidate: 'Alice', votes: 4000, party: 'Red Party' },
      { candidate: 'Bob', votes: 3000, party: 'Blue Party' },
      { candidate: 'Carol', votes: 2000, party: 'Green Party' },
    ],
    votesCounted: 9000,
    votePercentageCounted: 0.9,
    ...overrides,
  };
}

const partyMap: Record<string, string | undefined> = {
  Alice: 'Red Party',
  Bob: 'Blue Party',
  Carol: 'Green Party',
};

describe('predictWinner', () => {
  test('returns too-close and zero MoE when no votes have been counted', () => {
    const r = calculateLead(makeElectorate({ votesCounted: 0 }), partyMap);
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBe(0);
    expect(predicted.leaders.predictionStatus).toBe('too-close');
  });

  test('returns too-close and zero MoE when percentage counted is zero', () => {
    const r = calculateLead(
      makeElectorate({ votesCounted: 1000, votePercentageCounted: 0 }),
      partyMap
    );
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBe(0);
    expect(predicted.leaders.predictionStatus).toBe('too-close');
  });

  test('computes normally for valid partial counts', () => {
    const r = calculateLead(makeElectorate(), partyMap);
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBeGreaterThan(0);
    expect(predicted.leaders.predictionStatus).not.toBe('too-close');
  });
});

describe('calculatePartyVoteWithPercentages', () => {
  test('returns zero percentages and zero MoE when no votes counted', () => {
    const r = makeElectorate({ votesCounted: 0, votePercentageCounted: 0 });
    const withLead = calculateLead(r, partyMap);
    const predicted = predictWinner(withLead, 0.95);
    const partyVote = calculatePartyVoteWithPercentages([predicted], 0.95);

    for (const p of partyVote) {
      expect(p.percentage).toBe(0);
      expect(p.marginOfError).toBe(0);
    }
  });

  test('ignores electorates with zero percentage counted when aggregating totals', () => {
    const valid = makeElectorate({
      electorateName: 'Valid',
      votesCounted: 7000,
      votePercentageCounted: 0.7,
      partyVotes: [
        { candidate: 'Red Party', votes: 4000 },
        { candidate: 'Blue Party', votes: 3000 },
      ],
    });
    const invalid = makeElectorate({
      electorateName: 'Invalid',
      votesCounted: 0,
      votePercentageCounted: 0,
      partyVotes: [],
      candidateVotes: [],
    });

    const withLead = [
      predictWinner(calculateLead(valid, partyMap), 0.95),
      predictWinner(calculateLead(invalid, partyMap), 0.95),
    ];

    const partyVote = calculatePartyVoteWithPercentages(withLead, 0.95);
    const red = partyVote.find((p) => p.candidate === 'Red Party');

    expect(red).toBeDefined();
    expect(red!.marginOfError).toBeGreaterThan(0);
    expect(red!.percentage).toBeCloseTo(4000 / 7000, 6);
  });
});
