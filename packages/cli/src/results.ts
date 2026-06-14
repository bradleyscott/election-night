import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  ElectorateDiff,
  WebhookEventType,
  WebhookPayload,
} from '@election-night/core/types';
import { config } from '@election-night/core/config';

type Results = ElectorateResults & WithLeaders & WithMarginOfError;

let electorateResults: Results[];

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  mkdirSync(dirname(config.cachePaths.electoralResults), { recursive: true });
  writeFileSync(
    config.cachePaths.electoralResults,
    JSON.stringify(toCache, null, 2)
  );
}

function readResults(): Results[] {
  if (electorateResults) {
    return electorateResults;
  }
  try {
    const resultsString = readFileSync(
      config.cachePaths.electoralResults,
      'utf8'
    );
    return JSON.parse(resultsString);
  } catch {
    return [];
  }
}

export function computeDiff(
  previous: Results | null,
  current: Results
): ElectorateDiff {
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
    leaderChanged:
      previous !== null &&
      previous.leaders.leadingCandidateParty !==
        current.leaders.leadingCandidateParty,
    previousLeaderName: previous?.leaders.leadingCandidate ?? null,
    previousLeaderParty: previous?.leaders.leadingCandidateParty ?? null,
    predictionStatusChanged:
      previous !== null &&
      previous.leaders.predictionStatus !== current.leaders.predictionStatus,
    previousPredictionStatus: previous?.leaders.predictionStatus ?? null,
    currentPredictionStatus: current.leaders.predictionStatus,
  };
}

export function determineEvents(diff: ElectorateDiff): WebhookEventType[] {
  // Only fire events when there was a previous result (first scrape just
  // establishes the baseline — no webhooks are sent).
  if (diff.previousVotesCounted === null) {
    return [];
  }

  const events: WebhookEventType[] = [];

  const votesChanged =
    diff.previousVotesCounted !== diff.currentVotesCounted ||
    diff.previousPercentageCounted !== diff.currentPercentageCounted;

  if (votesChanged) {
    events.push('result_updated');
  }

  if (diff.predictionStatusChanged) {
    events.push('prediction_changed');
  }

  if (diff.leaderChanged) {
    events.push('leader_change');
  }

  if (
    (diff.previousPercentageCounted ?? 0) < 1 &&
    diff.currentPercentageCounted >= 1
  ) {
    events.push('count_completed');
  }

  return events;
}

export async function sendWebhook(
  event: WebhookEventType,
  result: Results,
  diff: ElectorateDiff
): Promise<void> {
  const url = config.webhookUrl;
  if (!url) return;

  const payload: WebhookPayload = {
    event,
    timestamp: Date.now(),
    electorateName: result.electorateName,
    result,
    diff,
  };

  try {
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    console.error(
      `Webhook POST failed for ${event} on ${result.electorateName}:`,
      e
    );
  }
}

/**
 * Compare current results against the cached previous results and fire a
 * webhook for each event type that triggered per electorate.
 *
 * Call this *before* calling `cacheResults()` so the cached snapshot still
 * represents the previous cycle for comparison.
 */
export async function processResults(
  currentResults: Results[]
): Promise<void> {
  const cachedResults = readResults();
  const cacheMap = new Map(
    cachedResults.map((r) => [r.electorateName, r])
  );

  const promises: Promise<void>[] = [];

  for (const result of currentResults) {
    const previous = cacheMap.get(result.electorateName) ?? null;
    const diff = computeDiff(previous, result);
    const events = determineEvents(diff);

    for (const event of events) {
      promises.push(sendWebhook(event, result, diff));
    }
  }

  await Promise.all(promises);
}
