export type ResultPageConfig = {
  electorateName: string;
  url: string;
};

export type Config = {
  predictionConfidence: number;
  cachePaths: {
    electoralResults: string;
  };
  webhooks: {
    newPredictionWebhookUrl: string | undefined;
    updatedResultWebhookUrl: string | undefined;
    leaderChangeWebhookUrl: string | undefined;
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
  party: string | undefined;
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
    leadingCandidateParty: string | undefined;
    secondCandidate: string;
    secondCandidateParty: string | undefined;
    margin: number;
    marginPercent: number;
    isPredictedWinner: boolean;
  };
};

export type WithMarginOfError = {
  marginOfError: number;
};

export type PartyList = {
  party: string;
  candidate: string;
  listRank: number;
};

export type WithAdjustedRank = {
  adjustedRank: number;
  distanceFromCut: number;
};

export type ResultsPayload = {
  electorateResults: (ElectorateResults & WithLeaders & WithMarginOfError)[];
  partyVote: (VotingResults & WithSeats)[];
  partyLists: (PartyList & WithAdjustedRank)[];
};

// ---- Swappable Source Adapter ----

export interface ElectorateConfig {
  electorateName: string;
  url: string;
}

export type RawElectorateResults = {
  electorateName: string;
  candidateVotes: VotingResults[];
  partyVotes: VotingResults[];
  votesCounted: number;
  votePercentageCounted: number;
};

export interface ElectionSource {
  getElectorateConfigs(): ElectorateConfig[];
  parseRawResults(html: string, config: ElectorateConfig): RawElectorateResults;
}
