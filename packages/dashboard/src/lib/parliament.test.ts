import { describe, expect, test } from 'vitest';
import { buildSeats } from './parliament.js';
import { normalizeElectorateName } from './electorates.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  ElectorateResult,
  PartyVoteResult,
} from '@election-night/core/types';

function electorate(name = 'Test'): ElectorateResult {
  return {
    electorateName: name,
    partyVotes: [],
    candidateVotes: [],
    votesCounted: 1000,
    votePercentageCounted: 1,
    leaders: {
      leadingCandidate: 'Alice',
      leadingCandidateParty: 'Red Party',
      secondCandidate: 'Bob',
      secondCandidateParty: 'Blue Party',
      margin: 200,
      marginPercent: 0.11,
    },
  };
}

const partyVote = [
  {
    candidate: 'Red Party',
    votes: 10_000,
    seats: 1,
    electorateSeats: 1,
    listSeats: 0,
  },
] as unknown as PartyVoteResult[];

function counting(probability: number): SeatChance {
  return {
    state: 'counting',
    othersProbability: 0.01,
    leader: { name: 'Alice', party: 'Red Party', votes: 600 },
    runnerUp: { name: 'Bob', party: 'Blue Party', votes: 400 },
    probability,
    countProbability: probability,
    margin: 200,
    remainingVotes: 3000,
    remainingLow: 2400,
    remainingHigh: 3600,
    progress: 0.6,
    enrolment: 45000,
    assumedCycle: false,
    insideOutstanding: true,
    specialsOutstanding: 7300,
    specialsRequiredSwing: 0.0274,
    specialsProbability: 0.61,
    insideSpecials: true,
    provisionalPrior: false,
  };
}

function seatsWith(chance?: SeatChance) {
  const electorates = [electorate()];
  const chances = chance
    ? new Map([[normalizeElectorateName('Test'), chance]])
    : undefined;
  return buildSeats(['Red Party'], partyVote, electorates, [], 120, chances);
}

describe('hemicycle opacity', () => {
  test('paints a decided seat solid', () => {
    const [seat] = seatsWith(counting(0.98));
    expect(seat!.opacity).toBeGreaterThan(0.75);
  });

  test('paints a toss-up pale however large its margin', () => {
    const [pale] = seatsWith(counting(0.52));
    const [solid] = seatsWith(counting(0.98));
    expect(pale!.opacity).toBeLessThan(0.3);
    expect(pale!.opacity).toBeLessThan(solid!.opacity);
  });

  test('paints a seat with no chance pale', () => {
    const [seat] = seatsWith(undefined);
    expect(seat!.opacity).toBeCloseTo(0.15);
  });
});
