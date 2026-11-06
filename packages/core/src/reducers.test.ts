import { describe, expect, test } from 'vitest';
import {
  calculateLead,
  calculatePartyVoteWithPercentages,
  buildResultsPayload,
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

describe('calculateLead', () => {
  test('computes the margin for valid partial counts', () => {
    const r = calculateLead(makeElectorate());
    expect(r.leaders.margin).toBe(1000);
    expect(r.leaders.marginPercent).toBeCloseTo(1000 / 9000, 6);
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

  test('leaves party null when the candidate has no party', () => {
    const r = calculateLead(
      makeElectorate({
        candidateVotes: [
          { candidate: 'Alice', votes: 4000, party: undefined },
          { candidate: 'Bob', votes: 3000, party: undefined },
        ],
      })
    );

    expect(r.leaders.leadingCandidateParty).toBeNull();
    expect(r.leaders.secondCandidateParty).toBeNull();
  });
});

describe('calculateLead before any vote is counted', () => {
  // The feed publishes every seat with zero votes, and its candidate order is
  // alphabetical by surname. A stable sort therefore leaves the first row as
  // "leader" unless the reducer refuses to name one.
  test('has no leader on a zero count', () => {
    const r = calculateLead(
      makeElectorate({
        votesCounted: 0,
        votePercentageCounted: 0,
        partyVotes: [],
        candidateVotes: [
          { candidate: 'AARDVARK, Ann', votes: 0, party: 'Red Party' },
          { candidate: 'ZEBRA, Zed', votes: 0, party: 'Blue Party' },
        ],
      })
    );

    expect(r.leaders.leadingCandidate).toBeNull();
    expect(r.leaders.leadingCandidateParty).toBeNull();
    expect(r.leaders.secondCandidate).toBeNull();
    expect(r.leaders.secondCandidateParty).toBeNull();
    expect(r.leaders.margin).toBe(0);
  });

  test('has no leader when the top two are tied', () => {
    const r = calculateLead(
      makeElectorate({
        votesCounted: 9000,
        candidateVotes: [
          { candidate: 'Alice', votes: 4000, party: 'Red Party' },
          { candidate: 'Bob', votes: 4000, party: 'Blue Party' },
          { candidate: 'Carol', votes: 1000, party: 'Green Party' },
        ],
      })
    );

    expect(r.leaders.leadingCandidate).toBeNull();
    expect(r.leaders.leadingCandidateParty).toBeNull();
    expect(r.leaders.margin).toBe(0);
  });
});

describe('buildResultsPayload with an uncounted seat alongside a counted one', () => {
  const status = {
    parties: [
      {
        party: 'Red Party',
        votes: 4000,
        listSeats: 0,
        electorateSeats: 1,
        totalSeats: 1,
      },
    ],
    totalVotesCast: 4000,
    percentVotesCast: 0.5,
    totalElectoratesFinal: 1,
    percentElectoratesFinal: 0.5,
    totalMinimalVotes: 0,
    totalSpecialVotes: 0,
    updated: null,
  };

  const list = [
    { party: 'Red Party', candidate: 'AARDVARK, Ann', listRank: 1 },
    { party: 'Red Party', candidate: 'ZULU, Zoe', listRank: 2 },
  ];

  function payloadFor(
    uncountedCandidateVotes: ElectorateResults['candidateVotes']
  ) {
    const counted = makeElectorate({
      electorateName: 'Counted',
      candidateVotes: [
        { candidate: 'Alice', votes: 4000, party: 'Red Party' },
        { candidate: 'Bob', votes: 1000, party: 'Blue Party' },
      ],
      votesCounted: 5000,
    });
    const uncounted = makeElectorate({
      electorateName: 'Uncounted',
      votesCounted: 0,
      votePercentageCounted: 0,
      partyVotes: [],
      candidateVotes: uncountedCandidateVotes,
    });
    return buildResultsPayload([counted, uncounted], list, status);
  }

  test('does not count the uncounted seat as an electorate win', () => {
    const payload = payloadFor([
      { candidate: 'AARDVARK, Ann', votes: 0, party: 'Red Party' },
      { candidate: 'ZEBRA, Zed', votes: 0, party: 'Blue Party' },
    ]);
    const aardvark = payload.partyLists.find(
      (x) => x.candidate === 'AARDVARK, Ann'
    );
    const zulu = payload.partyLists.find((x) => x.candidate === 'ZULU, Zoe');

    // No electorate winner, so neither list rank is adjusted by that seat.
    expect(aardvark?.adjustedRank).toBe(1);
    expect(zulu?.adjustedRank).toBe(2);
  });

  test('does adjust the list when the seat has actually been counted', () => {
    const payload = payloadFor([
      { candidate: 'AARDVARK, Ann', votes: 4000, party: 'Red Party' },
      { candidate: 'ZEBRA, Zed', votes: 1000, party: 'Blue Party' },
    ]);
    const aardvark = payload.partyLists.find(
      (x) => x.candidate === 'AARDVARK, Ann'
    );
    const zulu = payload.partyLists.find((x) => x.candidate === 'ZULU, Zoe');

    expect(aardvark?.adjustedRank).toBe(1);
    // AARDVARK is leading the counted seat, so ZULU moves up one place.
    expect(zulu?.adjustedRank).toBe(1);
  });
});

describe('calculatePartyVoteWithPercentages', () => {
  test('returns zero percentages when no votes are counted', () => {
    const r = makeElectorate({ votesCounted: 0, votePercentageCounted: 0 });
    const withLead = calculateLead(r);
    const partyVote = calculatePartyVoteWithPercentages([withLead]);

    for (const p of partyVote) {
      expect(p.percentage).toBe(0);
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

    const withLead = [calculateLead(valid), calculateLead(invalid)];

    const partyVote = calculatePartyVoteWithPercentages(withLead);
    const red = partyVote.find((p) => p.candidate === 'Red Party');

    expect(red).toBeDefined();
    expect(red!.percentage).toBeCloseTo(4000 / 7000, 6);
  });
});

describe('buildResultsPayload before any vote is counted', () => {
  // The live feed publishes every electorate file with zero votes ahead of
  // election night. Sainte-Laguë has no quotients to allocate from when every
  // party has zero votes, and used to throw — killing the collector's cycle
  // against a feed that was not actually broken.
  test('allocates no seats and does not throw on an all-zero count', () => {
    const zeroed = [
      makeElectorate({
        electorateName: 'Auckland Central',
        votesCounted: 0,
        votePercentageCounted: 0,
        partyVotes: [
          { candidate: 'Red Party', votes: 0 },
          { candidate: 'Blue Party', votes: 0 },
        ],
        candidateVotes: [
          { candidate: 'Alice', votes: 0, party: 'Red Party' },
          { candidate: 'Bob', votes: 0, party: 'Blue Party' },
        ],
      }),
    ];

    const payload = buildResultsPayload(zeroed, [], {
      parties: [
        {
          party: 'Red Party',
          votes: 0,
          listSeats: 0,
          electorateSeats: 0,
          totalSeats: 0,
        },
        {
          party: 'Blue Party',
          votes: 0,
          listSeats: 0,
          electorateSeats: 0,
          totalSeats: 0,
        },
      ],
      totalVotesCast: 0,
      percentVotesCast: 0,
      totalElectoratesFinal: 0,
      percentElectoratesFinal: 0,
      totalMinimalVotes: 0,
      totalSpecialVotes: 0,
      updated: null,
    });

    expect(payload.partyVote).toHaveLength(2);
    for (const party of payload.partyVote) {
      expect(party.seats).toBe(0);
      expect(party.electorateSeats).toBe(0);
      expect(party.listSeats).toBe(0);
      expect(party.percentage).toBe(0);
    }
  });
});
