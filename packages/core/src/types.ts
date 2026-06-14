export type ResultPageConfig = {
  electorateName: string;
  url: string;
};

export type Config = {
  predictionConfidence: number;
  cachePaths: {
    electoralResults: string;
  };
  webhookUrl: string | undefined;
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

export type PredictionStatus = 'too-close' | 'leaning' | 'likely' | 'projected';

export type WithLeaders = {
  leaders: {
    leadingCandidate: string;
    leadingCandidateParty: string | undefined;
    secondCandidate: string;
    secondCandidateParty: string | undefined;
    margin: number;
    marginPercent: number;
    predictionStatus: PredictionStatus;
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

// ---- Webhook Event Types ----

export type WebhookEventType =
  | 'result_updated'
  | 'prediction_changed'
  | 'leader_change'
  | 'count_completed';

export type WebhookPayload = {
  event: WebhookEventType;
  timestamp: number;
  electorateName: string;
  result: ElectorateResults & WithLeaders & WithMarginOfError;
  diff: ElectorateDiff;
};

// ---- Feed / Commentary ----

export type FeedEventType = 'result_updated' | 'prediction_called' | 'leader_change' | 'count_completed';

export type ElectorateDiff = {
  electorateName: string;
  previousVotesCounted: number | null;
  currentVotesCounted: number;
  previousPercentageCounted: number | null;
  currentPercentageCounted: number;
  previousMargin: number | null;
  currentMargin: number;
  previousMarginPercent: number | null;
  currentMarginPercent: number;
  leaderChanged: boolean;
  previousLeaderName: string | null;
  previousLeaderParty: string | null;
  predictionStatusChanged: boolean;
  previousPredictionStatus: PredictionStatus | null;
  currentPredictionStatus: PredictionStatus;
};

export type FeedEvent = {
  id: string;
  timestamp: number;
  type: FeedEventType;
  electorateName: string;
  predictionStatus: PredictionStatus;
  marginOfError: number;
  summary: string;
  commentary: string;
  diff: ElectorateDiff;
};
