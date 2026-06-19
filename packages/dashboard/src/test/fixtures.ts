import type {
  ElectorateResults,
  FeedEvent,
  PartyList,
  ResultsPayload,
  VotingResults,
  WithAdjustedRank,
  WithLeaders,
  WithMarginOfError,
  WithSeats,
} from '@election-night/core/types';

type ElectorateResult = ElectorateResults &
  WithLeaders &
  WithMarginOfError;

export const mockElectorateResult: ElectorateResult = {
  electorateName: 'Auckland Central',
  candidateVotes: [
    { candidate: 'SMITH, John', party: 'National Party', votes: 12000 },
    { candidate: 'JONES, Mary', party: 'Labour Party', votes: 11000 },
  ],
  partyVotes: [
    { candidate: 'National Party', votes: 14000 },
    { candidate: 'Labour Party', votes: 13000 },
    { candidate: 'Green Party', votes: 5000 },
  ],
  votesCounted: 25000,
  votePercentageCounted: 0.95,
  leaders: {
    leadingCandidate: 'SMITH, John',
    leadingCandidateParty: 'National Party',
    secondCandidate: 'JONES, Mary',
    secondCandidateParty: 'Labour Party',
    margin: 1000,
    marginPercent: 0.04,
    predictionStatus: 'leaning',
  },
  marginOfError: 0.02,
};

export const mockPartyVote: (VotingResults & WithSeats)[] = [
  { candidate: 'National Party', votes: 1000000, seats: 50, electorateSeats: 35, listSeats: 15 },
  { candidate: 'Labour Party', votes: 900000, seats: 45, electorateSeats: 30, listSeats: 15 },
  { candidate: 'Green Party', votes: 200000, seats: 10, electorateSeats: 1, listSeats: 9 },
];

export const mockPartyList = [
  { party: 'National Party', candidate: 'BROWN, Sam', listRank: 1, adjustedRank: 1, distanceFromCut: 5 },
  { party: 'Labour Party', candidate: 'WHITE, Sue', listRank: 1, adjustedRank: 1, distanceFromCut: 3 },
] as (PartyList & WithAdjustedRank)[];

export const mockResults: ResultsPayload = {
  electorateResults: [mockElectorateResult],
  partyVote: mockPartyVote,
  partyLists: mockPartyList,
};

export const mockFeedEvent: FeedEvent = {
  id: 'event-1',
  timestamp: Date.now(),
  type: 'result_updated',
  electorateName: 'Auckland Central',
  predictionStatus: 'leaning',
  marginOfError: 0.02,
  summary: 'Auckland Central updated.',
  commentary: 'SMITH, John leads by 4.00% at 95% counted.',
  diff: {
    electorateName: 'Auckland Central',
    previousVotesCounted: null,
    currentVotesCounted: 25000,
    previousPercentageCounted: null,
    currentPercentageCounted: 0.95,
    previousMargin: null,
    currentMargin: 1000,
    previousMarginPercent: null,
    currentMarginPercent: 0.04,
    leaderChanged: false,
    previousLeaderName: null,
    previousLeaderParty: null,
    predictionStatusChanged: false,
    previousPredictionStatus: null,
    currentPredictionStatus: 'leaning',
  },
};

export const mockFeedEvents: FeedEvent[] = [mockFeedEvent];
