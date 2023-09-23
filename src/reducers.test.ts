import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'fs';
import { calculatePartyVoteWithSeats } from './reducers';
import { electorateVotes, partyVotes } from './fixtures';

vi.mock('./candidates.js', () => {
  const candidatesCsv = () => readFileSync('csv/candidates_test.csv');
  return { candidatesCsv };
});

describe('reducers', () => {
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
