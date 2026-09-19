export type ResultPageConfig = {
  electorateName: string;
  url: string;
};

export type Config = {
  predictionConfidence: number;
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
  candidateVotes: (VotingResults & WithParty)[];
  partyVotes: VotingResults[];
  votesCounted: number;
  votePercentageCounted: number;
};

export interface ElectionSource {
  /** Human-readable source name, used for logging. */
  getName(): string;
  /** Load reference data and return the list of electorates to poll. */
  loadElectorates(): Promise<ElectorateConfig[]>;
  /** Load party list rankings needed for list-MP calculations. */
  loadPartyList(): Promise<PartyList[]>;
  /**
   * Fetch and parse results for a single electorate. Implementations must set
   * `party` on each candidate vote so downstream seat calculations work.
   */
  fetchResults(config: ElectorateConfig): Promise<RawElectorateResults>;
}

// ---- Webhook Event Types ----

export type WebhookEventType =
  'result_updated' | 'prediction_changed' | 'leader_change' | 'count_completed';

export type WebhookPayload = {
  event: WebhookEventType;
  timestamp: number;
  electorateName: string;
  result: ElectorateResults & WithLeaders & WithMarginOfError;
  diff: ElectorateDiff;
};

// ---- Feed / Commentary ----

export type FeedEventType =
  'result_updated' | 'prediction_called' | 'leader_change' | 'count_completed';

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

// ---- Metrics ----

/** Bounded failure classes for `election_electorate_fetch_errors_total`. */
export type ElectorateFetchErrorReason =
  'timeout' | 'http' | 'parse' | 'network';

/**
 * Application-tier metric events.
 *
 * The collector records every one of these in its own registry (scraped from
 * the collector's `/metrics`) and additionally publishes them to the dashboard
 * server over Socket.io. The push is a best-effort mirror and a liveness
 * heartbeat — the server timestamps receipt as
 * `election_collector_metrics_last_received_timestamp_seconds` but does **not**
 * re-register the series, so a metric is only ever exposed by one process.
 */
export type MetricEvent =
  | {
      metric: 'scrapeDurationSeconds';
      seconds: number;
      status: 'success' | 'partial' | 'error';
    }
  | {
      metric: 'scrapeElectoratesTotal';
      outcome: 'success' | 'error' | 'cached';
    }
  | { metric: 'collectorSocketConnected'; connected: boolean }
  | { metric: 'webhookPublishesTotal'; status: 'success' | 'error' }
  | {
      metric: 'electorateFetchDurationSeconds';
      seconds: number;
      outcome: 'success' | 'error';
    }
  | {
      metric: 'electorateFetchErrorsTotal';
      reason: ElectorateFetchErrorReason;
    }
  | { metric: 'scrapeRetriedElectorates'; count: number }
  | {
      metric: 'votesCounted';
      total: number;
      reporting: number;
      electorates: number;
    }
  | {
      metric: 'webhookPublishDurationSeconds';
      seconds: number;
      status: 'success' | 'error';
    }
  | { metric: 'snapshotWritesTotal'; status: 'success' | 'error' }
  | {
      metric: 'dbWriteDurationSeconds';
      seconds: number;
      status: 'success' | 'error';
    };
