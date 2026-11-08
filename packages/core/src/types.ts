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
  /**
   * When the Commission last republished *this seat's* file, as an ISO instant
   * taken from the HTTP `Last-Modified` (which equals the file's own `updated`
   * attribute). Absent when the source cannot say — a custom adapter, or an
   * archived cycle fetched through `fetchResults`, where the stamp would be the
   * archive's rebuild time rather than anything about the count.
   *
   * The electorate panel prints this rather than when the browser last received
   * a payload: a quiet feed publishes nothing, so the payload can be an hour old
   * while this seat's count is current.
   */
  updatedAt?: string | null;
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

/**
 * Who is ahead in a seat, if anyone.
 *
 * The names are null when the count cannot support a leader: before any vote
 * has been cast, and when the top two are tied. A stable sort on an all-zero
 * count returns the feed's own order, which is alphabetical by surname, so a
 * non-null leader there would be an artefact of the candidate list rather than
 * of the count. Consumers must treat null as "no leader yet", not as an
 * independent candidate.
 */
export type WithLeaders = {
  leaders: {
    leadingCandidate: string | null;
    leadingCandidateParty: string | null;
    secondCandidate: string | null;
    secondCandidateParty: string | null;
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

/**
 * A seat's result as the pipeline publishes it: the counts, plus the leaders
 * the reducers derived. The dashboard's components take this rather than
 * repeating `ElectorateResults & WithLeaders` at each of their boundaries.
 */
export type ElectorateResult = ElectorateResults & WithLeaders;

/** A party's national vote and the seat allocation the feed published. */
export type PartyVoteResult = VotingResults & WithSeats;

/** A candidate on a party list, with the rank the cut maths produces. */
export type PartyListResult = PartyList & WithAdjustedRank;

export type ResultsPayload = {
  electorateResults: ElectorateResult[];
  partyVote: PartyVoteResult[];
  partyLists: PartyListResult[];
};

/**
 * What the collector publishes over Socket.io: the payload with the cycle and
 * committed revision it belongs to. A dashboard accepts a newer revision in
 * the same cycle, acknowledges an exact duplicate without deriving new events,
 * and rejects an older one. `null` fields keep legacy/payload-only senders
 * working during the transition.
 */
export type ResultsEnvelope = {
  payload: ResultsPayload;
  electionYear: string | null;
  revision: number | null;
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

/**
 * What a source adapter returns for one seat.
 *
 * The same shape the pipeline publishes (`ElectorateResults`) under the name
 * the source contract uses: an adapter is written against what it must return,
 * not against the payload the dashboard consumes, and the two happen to be one
 * shape today. They were two identical declarations, which meant a change to
 * one silently left the other behind.
 */
export type RawElectorateResults = ElectorateResults;

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
  /**
   * Optional: fetch one seat, keeping the response's `Last-Modified`.
   *
   * With `ifModifiedSince`, the Commission's feed answers `304 Not Modified`
   * and an empty body when nothing has been republished, which lets a cycle
   * confirm a seat is unchanged without downloading it. Without it the seat is
   * always downloaded — an unconditional sweep — but the stamp still comes back
   * so the next cycle can ask cheaply. Sources that do not implement this are
   * fetched unconditionally through `fetchResults`, which remains the contract
   * every adapter meets.
   */
  fetchResultsConditional?(
    config: ElectorateConfig,
    ifModifiedSince?: string
  ): Promise<ConditionalFetchOutcome>;
}

/** The answer to a conditional fetch: either a body, or "not since then". */
export type ConditionalFetchOutcome =
  | {
      status: 'modified';
      results: RawElectorateResults;
      /** The response's `Last-Modified`, or null if the server sent none. */
      lastModified: string | null;
    }
  | {
      status: 'not-modified';
      lastModified: string | null;
    };

// ---- Webhook Event Types ----

export type WebhookEventType =
  'result_updated' | 'prediction_changed' | 'leader_change' | 'count_completed';

export type WebhookPayload = {
  event: WebhookEventType;
  /** Stable idempotency key for this announcement. */
  eventId?: string;
  electionYear?: string;
  /** Committed cycle revision the event belongs to, when known. */
  revision?: number | null;
  timestamp: number;
  electorateName: string;
  result: ElectorateResults & WithLeaders;
  diff: ElectorateDiff;
  /**
   * The seat's chance of being won, when the count is live and a prior exists.
   * `null` on a finished count, and absent when the collector had no baseline.
   */
  probability?: number | null;
  /**
   * How far through tonight's count the seat is: votes counted ÷ the votes
   * tonight is expected to produce (`SeatChance.progress`), as a fraction.
   * The same number the dashboard's count band prints, and not
   * `votePercentageCounted`, which is the share of *voting places* reported and
   * runs hot early. `null` on a finished count, absent without a baseline.
   */
  progress?: number | null;
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
   * The seat's chance of being won. While the count is live this is the full
   * model number (ordinary count plus specials); once the ordinary count is
   * complete it is the same number with only the special vote outstanding,
   * which is what the seat panel and the feed's specials sentence both use.
   * `null` when the model is still waiting for votes, and absent on events
   * written before the p(win) model.
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
      /**
       * What the cycle spent its time on, independent of whether it succeeded:
       * `reading` if any seat returned a body, `quiet` if every seat answered
       * 304, `degraded` for anything else (a seat failed, or was served from
       * cache). A quiet cycle and a reading cycle are not the same measurement,
       * and averaging them hides a slow scrape behind an afternoon of 304s.
       */
      mode: 'reading' | 'quiet' | 'degraded';
    }
  | {
      metric: 'scrapeElectoratesTotal';
      outcome: 'success' | 'unchanged' | 'error' | 'cached';
    }
  | { metric: 'collectorSocketConnected'; connected: boolean }
  | { metric: 'webhookPublishesTotal'; status: 'success' | 'error' }
  | {
      metric: 'electorateFetchDurationSeconds';
      seconds: number;
      /**
       * `unchanged` is a 304: a confirmed seat that transferred no body. It is
       * kept apart from `success` because the two latencies are an order of
       * magnitude apart, and mixing them makes the per-fetch p95 meaningless.
       */
      outcome: 'success' | 'unchanged' | 'error';
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
