import { JWT } from 'google-auth-library';

export type ResultPageConfig = {
  electorateName: string;
  url: string;
};

export type Config = {
  predictionConfidence: number;
  resultUrls: {
    electorates: ResultPageConfig[];
  };
  parser: {
    resultsTableSelector: string;
    votePercentCountedSelector: string;
    votesCountedSelector: string;
  };
  cachePaths: {
    electoralResults: string;
  };
  webhooks: {
    newPredictionWebhookUrl: string;
    updatedResultWebhookUrl: string;
    leaderChangeWebhookUrl: string;
  };
  googleSheets: {
    sheetId: string;
    credentials: JWT;
    electorateResultsSummarySheetName: string;
    electorateResultsSheetName: string;
    partyVoteResultsSheetName: string;
    partyVoteSummarySheetName: string;
    partyListsSheetName: string;
  };
};

export type ElectorateResults = {
  electorateName: string;
  partyVotes: VotingResults[];
  candidateVotes: (VotingResults & WithParty)[];
  votesCounted: number;
  votePercentageCounted: number;
};

export type VotingResults = {
  candidate: string;
  votes: number;
};

export type WithParty = {
  party: string;
};

export type WithPercentages = {
  percentage: number;
  marginOfError: number;
};

export type WithSeats = {
  seats: number;
  electorateSeats: number;
  listSeats: number;
};

export type WithLeaders = {
  leaders: {
    leadingCandidate: string;
    leadingCandidateParty: string;
    secondCandidate: string;
    secondCandidateParty: string;
    margin: number;
    marginPercent: number;
    isPredictedWinner: boolean;
  };
};

export type PartyList = {
  party: string;
  candidate: string;
  listRank: number;
}

export type WithAdjustedRank = {
  adjustedRank: number;
  distanceFromCut: number;
}
