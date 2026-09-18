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

describe('predictWinner', () => {
  test('returns too-close and zero MoE when no votes have been counted', () => {
    const r = calculateLead(makeElectorate({ votesCounted: 0 }));
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBe(0);
    expect(predicted.leaders.predictionStatus).toBe('too-close');
  });

  test('returns too-close and zero MoE when percentage counted is zero', () => {
    const r = calculateLead(
      makeElectorate({ votesCounted: 1000, votePercentageCounted: 0 })
    );
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBe(0);
    expect(predicted.leaders.predictionStatus).toBe('too-close');
  });

  test('computes normally for valid partial counts', () => {
    const r = calculateLead(makeElectorate());
    const predicted = predictWinner(r, 0.95);

    expect(predicted.marginOfError).toBeGreaterThan(0);
    expect(predicted.leaders.predictionStatus).not.toBe('too-close');
  });
});

describe('calculateLead party resolution', () => {
  test('resolves the leading and second party from the candidate votes', () => {
    const r = calculateLead(makeElectorate());

    expect(r.leaders.leadingCandidate).toBe('Alice');
    expect(r.leaders.leadingCandidateParty).toBe('Red Party');
    expect(r.leaders.secondCandidate).toBe('Bob');
    expect(r.leaders.secondCandidateParty).toBe('Blue Party');
  });

  test('leaves party undefined when the candidate has no party', () => {
    const r = calculateLead(
      makeElectorate({
        candidateVotes: [
          { candidate: 'Alice', votes: 4000, party: undefined },
          { candidate: 'Bob', votes: 3000, party: undefined },
        ],
      })
    );

    expect(r.leaders.leadingCandidateParty).toBeUndefined();
    expect(r.leaders.secondCandidateParty).toBeUndefined();
  });
});

describe('calculatePartyVoteWithPercentages', () => {
  test('returns zero percentages and zero MoE when no votes counted', () => {
    const r = makeElectorate({ votesCounted: 0, votePercentageCounted: 0 });
    const withLead = calculateLead(r);
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
      predictWinner(calculateLead(valid), 0.95),
      predictWinner(calculateLead(invalid), 0.95),
    ];

    const partyVote = calculatePartyVoteWithPercentages(withLead, 0.95);
    const red = partyVote.find((p) => p.candidate === 'Red Party');

    expect(red).toBeDefined();
    expect(red!.marginOfError).toBeGreaterThan(0);
    expect(red!.percentage).toBeCloseTo(4000 / 7000, 6);
  });
});
