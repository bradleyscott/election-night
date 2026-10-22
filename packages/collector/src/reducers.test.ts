import { describe, expect, test } from 'vitest';
import { buildPartyVoteWithSeats } from '@election-night/core/reducers';
import type { NationalStatus } from '@election-night/core/types';

/**
 * Seat numbers come off `election.xml` verbatim. There is no local allocation
 * to test: the Commission publishes list, electorate and total seats per
 * party, including the 5% threshold, the one-electorate rule and overhang.
 */
const status: NationalStatus = {
  parties: [
    // 2023 shape: National 43 + 5, Labour 17 + 17, TPM 6 + 0 (an overhang —
    // six Māori seats on 3.08% of the party vote), nobody else in parliament.
    { party: 'National Party', votes: 1085851, listSeats: 5, electorateSeats: 43, totalSeats: 48 },
    { party: 'Labour Party', votes: 767540, listSeats: 17, electorateSeats: 17, totalSeats: 34 },
    { party: 'Green Party', votes: 330907, listSeats: 12, electorateSeats: 3, totalSeats: 15 },
    { party: 'ACT New Zealand', votes: 246473, listSeats: 9, electorateSeats: 2, totalSeats: 11 },
    { party: 'New Zealand First Party', votes: 173553, listSeats: 8, electorateSeats: 0, totalSeats: 8 },
    { party: 'Te Pāti Māori', votes: 87844, listSeats: 0, electorateSeats: 6, totalSeats: 6 },
    { party: 'The Opportunities Party (TOP)', votes: 63344, listSeats: 0, electorateSeats: 0, totalSeats: 0 },
  ],
  totalVotesCast: 2867478,
  percentVotesCast: 77.7,
  totalElectoratesFinal: 72,
  percentElectoratesFinal: 100,
  totalMinimalVotes: 0,
  totalSpecialVotes: 0,
  updated: '2024-11-10T00:00:00',
};

const aggregates = [
  { candidate: 'National Party', votes: 1085851, percentage: 0.38, marginOfError: 0.01 },
  { candidate: 'Labour Party', votes: 767540, percentage: 0.27, marginOfError: 0.01 },
  { candidate: 'Green Party', votes: 330907, percentage: 0.116, marginOfError: 0.01 },
  { candidate: 'ACT New Zealand', votes: 246473, percentage: 0.086, marginOfError: 0.01 },
  { candidate: 'New Zealand First Party', votes: 173553, percentage: 0.061, marginOfError: 0.01 },
  { candidate: 'Te Pāti Māori', votes: 87844, percentage: 0.031, marginOfError: 0.01 },
  { candidate: 'The Opportunities Party (TOP)', votes: 63344, percentage: 0.022, marginOfError: 0.01 },
];

describe('buildPartyVoteWithSeats', () => {
  test('reports the published seat split unchanged, overhang included', () => {
    const result = buildPartyVoteWithSeats(aggregates, status);

    const byParty = new Map(result.map((p) => [p.candidate, p]));
    expect(byParty.get('National Party')).toMatchObject({
      electorateSeats: 43,
      listSeats: 5,
      seats: 48,
    });
    expect(byParty.get('Te Pāti Māori')).toMatchObject({
      electorateSeats: 6,
      listSeats: 0,
      seats: 6,
    });
    expect(result.reduce((sum, p) => sum + p.seats, 0)).toBe(122);
  });

  test('keeps the vote share and margin of error we compute ourselves', () => {
    const result = buildPartyVoteWithSeats(aggregates, status);
    const national = result.find((p) => p.candidate === 'National Party');

    expect(national!.votes).toBe(1085851);
    expect(national!.percentage).toBeCloseTo(0.38);
    expect(national!.marginOfError).toBeCloseTo(0.01);
  });

  test('sorts the party vote by votes, descending', () => {
    const result = buildPartyVoteWithSeats(aggregates, status);
    expect(result.map((p) => p.votes)).toEqual([
      1085851, 767540, 330907, 246473, 173553, 87844, 63344,
    ]);
  });
});
