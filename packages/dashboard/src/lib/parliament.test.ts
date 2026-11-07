import { describe, expect, test } from 'vitest';
import { buildSeats, defaultOrder, winningCoalition } from './parliament.js';
import { normalizeElectorateName } from './electorates.js';
import type { SeatChance } from '@election-night/core/seat-probability';
import type {
  ElectorateResult,
  PartyListResult,
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

describe('list pool before a seat is counted', () => {
  test('does not take a candidate out of the list for an uncounted seat', () => {
    const uncounted: ElectorateResult = {
      ...electorate('Uncounted'),
      votesCounted: 0,
      votePercentageCounted: 0,
      leaders: {
        leadingCandidate: null,
        leadingCandidateParty: null,
        secondCandidate: null,
        secondCandidateParty: null,
        margin: 0,
        marginPercent: 0,
      },
    };
    const vote = [
      {
        candidate: 'Red Party',
        votes: 10_000,
        seats: 1,
        electorateSeats: 0,
        listSeats: 1,
      },
    ] as unknown as PartyVoteResult[];
    const list = [
      {
        party: 'Red Party',
        candidate: 'Alice',
        listRank: 1,
        adjustedRank: 1,
        distanceFromCut: 0,
      },
    ] as unknown as PartyListResult[];

    const seats = buildSeats(['Red Party'], vote, [uncounted], list, 1);

    // Alice is still on the list, so the one list seat is hers. If the
    // uncounted seat had been read as an electorate win she would have been
    // filtered out and the seat left unnamed.
    expect(seats).toHaveLength(1);
    expect(seats[0]!.type).toBe('list');
    expect(seats[0]!.candidate).toBe('Alice');
  });
});

function party(candidate: string, seats: number): PartyVoteResult {
  return {
    candidate,
    votes: seats * 1000,
    seats,
    electorateSeats: seats,
    listSeats: 0,
  } as PartyVoteResult;
}

const chamber2023 = [
  party('National Party', 48),
  party('Labour Party', 34),
  party('Green Party', 15),
  party('ACT New Zealand', 11),
  party('New Zealand First Party', 8),
  party('Te Pāti Māori', 6),
];

describe('default seating order', () => {
  test('uses the conventional left-to-right chamber order, not the seat count', () => {
    expect(defaultOrder(chamber2023)).toEqual([
      'Labour Party',
      'Green Party',
      'Te Pāti Māori',
      'New Zealand First Party',
      'ACT New Zealand',
      'National Party',
    ]);
  });

  test('puts a party it does not rank in the centre, between the blocs', () => {
    const vote = [
      party('National Party', 40),
      party('Opportunity Party', 4),
      party('Labour Party', 30),
      party('Green Party', 10),
    ];

    expect(defaultOrder(vote)).toEqual([
      'Labour Party',
      'Green Party',
      'Opportunity Party',
      'National Party',
    ]);
  });

  test('leaves a party with no seats out of the chamber', () => {
    const vote = [
      party('Labour Party', 40),
      party('National Party', 30),
      party('Opportunity Party', 0),
    ];

    expect(defaultOrder(vote)).toEqual(['Labour Party', 'National Party']);
  });
});

describe('coalition footer', () => {
  const order = defaultOrder(chamber2023);

  test('picks the fewest neighbouring parties that reach the majority', () => {
    const coalition = winningCoalition(order, chamber2023, 62);

    // National + ACT alone is 59, so NZ First is needed. Two parties would
    // clear the threshold arithmetically only if National were paired with
    // Labour, and those two do not neighbour each other in the chamber.
    // The row prints the members largest first, not in chamber order.
    expect(coalition.parties.map((p) => p.candidate)).toEqual([
      'National Party',
      'ACT New Zealand',
      'New Zealand First Party',
    ]);
    expect(coalition.cumulative).toBe(67);
  });

  test('names a single party that has a majority on its own', () => {
    const vote = [party('Labour Party', 65), party('National Party', 55)];

    const coalition = winningCoalition(defaultOrder(vote), vote, 61);

    expect(coalition.parties.map((p) => p.candidate)).toEqual(['Labour Party']);
    expect(coalition.cumulative).toBe(65);
  });

  test('breaks an equal-sized tie on the larger seat total', () => {
    // 2017 arithmetic: Labour + Greens + NZ First is 63, NZ First + ACT +
    // National is 66, and both need three parties.
    const vote = [
      party('National Party', 56),
      party('Labour Party', 46),
      party('New Zealand First Party', 9),
      party('Green Party', 8),
      party('ACT New Zealand', 1),
    ];

    const coalition = winningCoalition(defaultOrder(vote), vote, 61);

    expect(coalition.parties.map((p) => p.candidate)).toEqual([
      'National Party',
      'New Zealand First Party',
      'ACT New Zealand',
    ]);
    expect(coalition.cumulative).toBe(66);
  });

  test('ignores parties outside the chamber when testing a neighbour run', () => {
    const vote = [
      ...chamber2023,
      party('Opportunity Party', 0),
      party('A New Party', 0),
    ];

    const coalition = winningCoalition(defaultOrder(vote), vote, 62);

    expect(coalition.parties.map((p) => p.candidate)).toEqual([
      'National Party',
      'ACT New Zealand',
      'New Zealand First Party',
    ]);
  });
});
