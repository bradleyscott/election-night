import type {
  ElectorateDiff,
  ElectorateResults,
  FeedEventType,
  PredictionStatus,
  WebhookEventType,
  WithLeaders,
  WithMarginOfError,
} from './types.js';

export type ComparableResult = ElectorateResults &
  WithLeaders &
  WithMarginOfError;

/**
 * Compute the delta between two scrape cycles for one electorate.
 *
 * `previousLeaderName`/`previousLeaderParty` are only populated when the
 * leader actually changed (they describe the *outgoing* leader, so any
 * other value would be stale noise).
 *
 * This is the single source of truth for scrape-to-scrape diffs: the
 * collector uses it for webhook events and the dashboard server for feed
 * events.
 */
export function computeDiff(
  previous: ComparableResult | null | undefined,
  current: ComparableResult
): ElectorateDiff {
  const leaderChanged =
    previous !== null &&
    previous !== undefined &&
    previous.leaders.leadingCandidateParty !==
      current.leaders.leadingCandidateParty;

  return {
    electorateName: current.electorateName,
    previousVotesCounted: previous?.votesCounted ?? null,
    currentVotesCounted: current.votesCounted,
    previousPercentageCounted: previous?.votePercentageCounted ?? null,
    currentPercentageCounted: current.votePercentageCounted,
    previousMargin: previous?.leaders.margin ?? null,
    currentMargin: current.leaders.margin,
    previousMarginPercent: previous?.leaders.marginPercent ?? null,
    currentMarginPercent: current.leaders.marginPercent,
    leaderChanged,
    previousLeaderName: leaderChanged
      ? (previous?.leaders.leadingCandidate ?? null)
      : null,
    previousLeaderParty: leaderChanged
      ? (previous?.leaders.leadingCandidateParty ?? null)
      : null,
    predictionStatusChanged:
      previous !== null &&
      previous !== undefined &&
      previous.leaders.predictionStatus !== current.leaders.predictionStatus,
    previousPredictionStatus: previous?.leaders.predictionStatus ?? null,
    currentPredictionStatus: current.leaders.predictionStatus,
  };
}

/** Primitive facts both webhook and feed classification are built from. */
export type DiffFacts = {
  /** First time this electorate has been seen (no baseline to compare to). */
  isFirstResult: boolean;
  leaderChanged: boolean;
  /** Vote count or percentage counted moved since the last cycle. */
  votesChanged: boolean;
  /** Counting finished this cycle (crossed from <100% to 100%). */
  countCompleted: boolean;
  predictionStatusChanged: boolean;
  /** Prediction hardened to 'likely' or 'projected' this cycle. */
  predictionCalled: boolean;
};

export function diffFacts(diff: ElectorateDiff): DiffFacts {
  const countCompleted =
    diff.previousPercentageCounted !== null &&
    diff.previousPercentageCounted < 1 &&
    diff.currentPercentageCounted >= 1;

  const predictionCalled =
    diff.predictionStatusChanged &&
    (diff.currentPredictionStatus === 'likely' ||
      diff.currentPredictionStatus === 'projected');

  return {
    isFirstResult: diff.previousVotesCounted === null,
    leaderChanged: diff.leaderChanged,
    votesChanged:
      diff.previousVotesCounted === null ||
      diff.currentVotesCounted !== diff.previousVotesCounted ||
      diff.currentPercentageCounted !== diff.previousPercentageCounted,
    countCompleted,
    predictionStatusChanged: diff.predictionStatusChanged,
    predictionCalled,
  };
}

/**
 * Webhook events for the collector: one payload per triggered event type.
 * The first scrape of an electorate just establishes a baseline — no
 * webhooks are sent.
 */
export function determineWebhookEvents(
  diff: ElectorateDiff
): WebhookEventType[] {
  const facts = diffFacts(diff);
  if (facts.isFirstResult) return [];

  const events: WebhookEventType[] = [];
  if (facts.votesChanged) events.push('result_updated');
  if (facts.predictionStatusChanged) events.push('prediction_changed');
  if (facts.leaderChanged) events.push('leader_change');
  if (facts.countCompleted) events.push('count_completed');
  return events;
}

/** Single feed event type for the dashboard, by descending importance. */
export function determineFeedEventType(diff: ElectorateDiff): FeedEventType {
  const facts = diffFacts(diff);
  if (facts.leaderChanged) return 'leader_change';
  if (facts.countCompleted) return 'count_completed';
  if (facts.predictionCalled) return 'prediction_called';
  return 'result_updated';
}

/** Statuses considered a confident call (shared by feed/commentary logic). */
export function isConfidentStatus(status: PredictionStatus): boolean {
  return status === 'likely' || status === 'projected';
}
