import { describe, expect, test } from 'vitest';
import { calculatePartyVoteWithSeats } from '@election-night/core/reducers';
import type { ElectorateResults, VotingResults, WithLeaders, WithPercentages } from '@election-night/core/types';
import { electorateVotes, partyVotes } from './fixtures';

describe('reducers', () => {
  test('calculatePartyVoteWithSeats handles overhang seats', () => {
    const pv: (VotingResults & WithPercentages)[] = [
      { candidate: 'National Party', votes: 900_000, percentage: 0.45, marginOfError: 0 },
      { candidate: 'Labour Party', votes: 700_000, percentage: 0.35, marginOfError: 0 },
      { candidate: 'Te Pāti Māori', votes: 30_000, percentage: 0.015, marginOfError: 0 },
    ];

    const ev: (ElectorateResults & WithLeaders)[] = [
      // Te Pāti Māori wins 6 electorates despite only ~1.5% party vote (entitlement ~2)
      ...Array.from({ length: 6 }, (_, i) => ({
        electorateName: `Māori ${i + 1}`,
        partyVotes: [] as VotingResults[],
        candidateVotes: [
          { candidate: `TMP Candidate ${i + 1}`, votes: 10_000, party: 'Te Pāti Māori' },
          { candidate: 'Labour', votes: 5_000, party: 'Labour Party' },
        ],
        votesCounted: 15_000,
        votePercentageCounted: 1,
        leaders: {
          leadingCandidate: `TMP Candidate ${i + 1}`,
          leadingCandidateParty: 'Te Pāti Māori' as string | undefined,
          secondCandidate: 'Labour',
          secondCandidateParty: 'Labour Party' as string | undefined,
          margin: 5_000,
          marginPercent: 0.33,
          predictionStatus: 'projected' as const,
        },
      })),
      // National wins 40 general electorates
      ...Array.from({ length: 40 }, (_, i) => ({
        electorateName: `General ${i + 1}`,
        partyVotes: [] as VotingResults[],
        candidateVotes: [
          { candidate: `Nat Candidate ${i + 1}`, votes: 15_000, party: 'National Party' },
          { candidate: 'Labour', votes: 10_000, party: 'Labour Party' },
        ],
        votesCounted: 25_000,
        votePercentageCounted: 1,
        leaders: {
          leadingCandidate: `Nat Candidate ${i + 1}`,
          leadingCandidateParty: 'National Party' as string | undefined,
          secondCandidate: 'Labour',
          secondCandidateParty: 'Labour Party' as string | undefined,
          margin: 5_000,
          marginPercent: 0.2,
          predictionStatus: 'projected' as const,
        },
      })),
      // Labour wins 14 electorates
      ...Array.from({ length: 14 }, (_, i) => ({
        electorateName: `Labour Gen ${i + 1}`,
        partyVotes: [] as VotingResults[],
        candidateVotes: [
          { candidate: `Lab Candidate ${i + 1}`, votes: 12_000, party: 'Labour Party' },
          { candidate: 'National', votes: 8_000, party: 'National Party' },
        ],
        votesCounted: 20_000,
        votePercentageCounted: 1,
        leaders: {
          leadingCandidate: `Lab Candidate ${i + 1}`,
          leadingCandidateParty: 'Labour Party' as string | undefined,
          secondCandidate: 'National',
          secondCandidateParty: 'National Party' as string | undefined,
          margin: 4_000,
          marginPercent: 0.2,
          predictionStatus: 'projected' as const,
        },
      })),
    ];

    const actual = calculatePartyVoteWithSeats(pv, ev);

    const tmp = actual.find((x) => x.candidate === 'Te Pāti Māori');
    const national = actual.find((x) => x.candidate === 'National Party');
    const labour = actual.find((x) => x.candidate === 'Labour Party');

    // Te Pāti Māori has overhang: 6 electorates but entitlement < 6
    expect(tmp!.electorateSeats).toBe(6);
    expect(tmp!.seats).toBe(6);
    expect(tmp!.listSeats).toBe(0);

    // Total seats should exceed 120 because of overhang
    const totalSeats = actual.reduce((s, p) => s + p.seats, 0);
    expect(totalSeats).toBeGreaterThan(120);

    // National and Labour should still receive list seats
    expect(national!.seats).toBeGreaterThan(national!.electorateSeats);
    expect(labour!.seats).toBeGreaterThan(labour!.electorateSeats);
  });

  test('calculatePartyVoteWithSeats', () => {
    const actual = calculatePartyVoteWithSeats(partyVotes, electorateVotes);
    const expected = [
      {
        candidate: 'The Opportunities Party (TOP)',
        electorateSeats: 0,
        listSeats: 0,
        votes: 43449,
        percentage: 0.01494226547153304,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'TEA Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 2414,
        percentage: 0.0008301831767884361,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'New Zealand First Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 75020,
        percentage: 0.025799644541287685,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'National Party',
        electorateSeats: 23,
        listSeats: 10,
        votes: 738275,
        percentage: 0.25389539554411045,
        marginOfError: 0,
        seats: 33,
      },
      {
        candidate: 'ACT New Zealand',
        electorateSeats: 1,
        listSeats: 9,
        votes: 219031,
        percentage: 0.07532553910320958,
        marginOfError: 0,
        seats: 10,
      },
      {
        candidate: 'New Conservative',
        electorateSeats: 0,
        listSeats: 0,
        votes: 42613,
        percentage: 0.01465476210127822,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Green Party',
        electorateSeats: 1,
        listSeats: 9,
        votes: 226757,
        percentage: 0.0779825379531961,
        marginOfError: 0,
        seats: 10,
      },
      {
        candidate: 'Sustainable New Zealand Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 1880,
        percentage: 0.0006465386795204059,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Labour Party',
        electorateSeats: 46,
        listSeats: 19,
        votes: 1443545,
        percentage: 0.4964402543235555,
        marginOfError: 0,
        seats: 65,
      },
      {
        candidate: 'Advance NZ',
        electorateSeats: 0,
        listSeats: 0,
        votes: 28429,
        percentage: 0.00977683410642852,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Aotearoa Legalise Cannabis Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 13329,
        percentage: 0.00458389045708909,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'HeartlandNZ',
        electorateSeats: 0,
        listSeats: 0,
        votes: 914,
        percentage: 0.0003143278473838569,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Māori Party',
        electorateSeats: 1,
        listSeats: 1,
        votes: 33630,
        percentage: 0.011565476485250664,
        marginOfError: 0,
        seats: 2,
      },
      {
        candidate: 'NZ Outdoors Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 3256,
        percentage: 0.0011197499683608732,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'ONE Party',
        electorateSeats: 0,
        listSeats: 0,
        votes: 8121,
        percentage: 0.0027928407533963913,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Social Credit',
        electorateSeats: 0,
        listSeats: 0,
        votes: 1520,
        percentage: 0.0005227334004633069,
        marginOfError: 0,
        seats: 0,
      },
      {
        candidate: 'Vision New Zealand',
        electorateSeats: 0,
        listSeats: 0,
        votes: 4237,
        percentage: 0.001457119353791468,
        marginOfError: 0,
        seats: 0,
      },
    ];

    expect(actual).toEqual(expected);
  });
});
