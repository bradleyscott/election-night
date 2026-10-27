export type ElectorateResults = {
  electorateName: string;
  partyVotes: VotingResults[];
  candidateVotes: (VotingResults & WithParty)[];
  votesCounted: number;
  votePercentageCounted: number;
  /**
   * Turnout in this seat so far: votes counted ÷ enrolled electors, as a
   * fraction. This is the feed's `percent_votes_cast`.
   *
   * It is **not** counting progress. `votePercentageCounted` counts voting
   * places; this counts people, and it is the only field that can turn a
   * count into a share of the vote still to come.
   */
  percentVotesCast?: number;
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
  };
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
  electorateResults: (ElectorateResults & WithLeaders)[];
  partyVote: (VotingResults & WithSeats)[];
  partyLists: (PartyList & WithAdjustedRank)[];
};

/**
 * One party's national status, exactly as the Commission publishes it in
 * `election.xml`. The seat split is theirs, not ours: `party_seats` is list
 * seats, `candidate_seats` electorate seats, `total_seats` their sum.
 */
export type PartyStatus = {
  party: string;
  votes: number;
  listSeats: number;
  electorateSeats: number;
  totalSeats: number;
};

/** The national count from `election.xml`: party status plus turnout. */
export type NationalStatus = {
  parties: PartyStatus[];
  totalVotesCast: number;
  percentVotesCast: number;
  totalElectoratesFinal: number;
  percentElectoratesFinal: number;
  totalMinimalVotes: number;
  totalSpecialVotes: number;
  updated: string | null;
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
  /** Turnout so far (feed `percent_votes_cast`), as a fraction. */
  percentVotesCast?: number;
};

export interface ElectionSource {
  /** Human-readable source name, used for logging. */
  getName(): string;
  /** Load reference data and return the list of electorates to poll. */
  loadElectorates(): Promise<ElectorateConfig[]>;
  /** Load party list rankings needed for list-MP calculations. */
  loadPartyList(): Promise<PartyList[]>;
  /**
   * The Commission's national count and seat allocation (`election.xml`).
   * Seat numbers are authoritative: the feed publishes list, electorate and
   * total seats per party, so nothing downstream re-derives them.
   */
  loadNationalStatus(): Promise<NationalStatus>;
  /**
   * Fetch and parse results for a single electorate. Implementations must set
   * `party` on each candidate vote so downstream calculations work.
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
  result: ElectorateResults & WithLeaders;
  diff: ElectorateDiff;
  /**
   * The seat's chance of being won, when the count is live and a prior exists.
   * `null` on a finished count, and absent when the collector had no baseline.
   */
  probability?: number | null;
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
};

export type FeedEvent = {
  id: string;
  timestamp: number;
  type: FeedEventType;
  electorateName: string;
  /**
   * The seat's chance of being won, when the count is live and a prior exists.
   * `null` once the ordinary count is complete (a finished count has a margin,
   * not a probability) and absent on events written before the p(win) model.
   */
  probability?: number | null;
  /**
   * Votes counted against the votes tonight is expected to produce: the same
   * number the seat panel prints as "% counted". `null` when the count is not
   * live or no cycle was modelled — never the share of voting places reported.
   */
  progress?: number | null;
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
