import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { dirname } from 'path';
import type {
  ElectorateResults,
  WithLeaders,
  WithMarginOfError,
  FeedEvent,
  FeedEventType,
  ElectorateDiff,
} from '@election-night/core/types';
import { dashboardServerConfig } from './config.js';
import { feedEventsTotal } from './metrics.js';
import { log } from './logger.js';

const { feedCachePath: FEED_CACHE_PATH, maxFeedEvents: MAX_FEED_EVENTS } =
  dashboardServerConfig;

type ElectorateResult = ElectorateResults &
  WithLeaders &
  WithMarginOfError;

let feedEvents: FeedEvent[] = [];

export function getFeedEvents(): FeedEvent[] {
  return feedEvents;
}

export function setFeedEvents(events: FeedEvent[]): void {
  feedEvents = events;
}

export function clearFeedEvents(): void {
  feedEvents = [];
}

export function loadFeedEventsFromDisk(): FeedEvent[] {
  if (!existsSync(FEED_CACHE_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(FEED_CACHE_PATH, 'utf-8'));
    if (Array.isArray(data)) return data as FeedEvent[];
  } catch (err) {
    log.error('Failed to load cached feed events', err);
  }
  return [];
}

function saveFeedEventsToDisk(events: FeedEvent[]): void {
  try {
    mkdirSync(dirname(FEED_CACHE_PATH), { recursive: true });
    writeFileSync(FEED_CACHE_PATH, JSON.stringify(events, null, 2));
  } catch (err) {
    log.error('Failed to save feed events', err);
  }
}

export function addFeedEvents(events: FeedEvent[]): FeedEvent[] {
  const existingIds = new Set(feedEvents.map((e) => e.id));
  const newEvents = events.filter((e) => !existingIds.has(e.id));
  if (newEvents.length === 0) return [];
  feedEvents = [...feedEvents, ...newEvents].slice(-MAX_FEED_EVENTS);
  newEvents.forEach((event) => feedEventsTotal.inc({ type: event.type }));
  saveFeedEventsToDisk(feedEvents);
  return newEvents;
}

function computeDiff(
  prev: ElectorateResult | undefined,
  current: ElectorateResult
): ElectorateDiff {
  return {
    electorateName: current.electorateName,
    previousVotesCounted: prev?.votesCounted ?? null,
    currentVotesCounted: current.votesCounted,
    previousPercentageCounted: prev?.votePercentageCounted ?? null,
    currentPercentageCounted: current.votePercentageCounted,
    previousMargin: prev?.leaders.margin ?? null,
    currentMargin: current.leaders.margin,
    previousMarginPercent: prev?.leaders.marginPercent ?? null,
    currentMarginPercent: current.leaders.marginPercent ?? 0,
    leaderChanged: prev
      ? prev.leaders.leadingCandidateParty !==
        current.leaders.leadingCandidateParty
      : false,
    previousLeaderName:
      prev && prev.leaders.leadingCandidateParty !== current.leaders.leadingCandidateParty
        ? prev.leaders.leadingCandidate
        : null,
    previousLeaderParty:
      prev && prev.leaders.leadingCandidateParty !== current.leaders.leadingCandidateParty
        ? prev.leaders.leadingCandidateParty
        : null,
    predictionStatusChanged: prev
      ? prev.leaders.predictionStatus !== current.leaders.predictionStatus
      : false,
    previousPredictionStatus: prev?.leaders.predictionStatus ?? null,
    currentPredictionStatus: current.leaders.predictionStatus,
  };
}

function determineFeedType(diff: ElectorateDiff): FeedEventType {
  if (diff.leaderChanged) return 'leader_change';
  if (
    diff.previousPercentageCounted !== null &&
    diff.previousPercentageCounted < 1 &&
    diff.currentPercentageCounted >= 1
  ) {
    return 'count_completed';
  }
  if (
    diff.predictionStatusChanged &&
    (diff.currentPredictionStatus === 'likely' ||
      diff.currentPredictionStatus === 'projected')
  ) {
    return 'prediction_called';
  }
  return 'result_updated';
}

function partyLabel(p: string | undefined): string {
  return p ?? 'Independent';
}

function templateSummary(
  diff: ElectorateDiff,
  result: ElectorateResult
): string {
  const l = result.leaders;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const moePct = (result.marginOfError * 100).toFixed(1);

  if (diff.leaderChanged) {
    return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) took the lead from ${diff.previousLeaderName} (${partyLabel(diff.previousLeaderParty)}) — leads by ${marginPct}%.`;
  }
  if (
    diff.previousPercentageCounted !== null &&
    diff.previousPercentageCounted < 1 &&
    diff.currentPercentageCounted >= 1
  ) {
    return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is the likely winner — ${marginPct}% lead at 100% counted.`;
  }
  if (
    diff.predictionStatusChanged &&
    (l.predictionStatus === 'likely' || l.predictionStatus === 'projected')
  ) {
    return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is the likely winner — ${marginPct}% lead exceeds ±${moePct}% MoE, making this a confident prediction at ${pct}% counted.`;
  }
  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is ahead by ${marginPct}% — but the ±${moePct}% MoE means the race is still too close to call at ${pct}% counted.`;
  }
  if (diff.previousMargin !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = ((l.marginPercent - diff.previousMarginPercent) * 100).toFixed(2);
      return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) extended their lead by ${widenedPct}% to ${marginPct}% at ${pct}% counted.`;
    }
    if (marginDelta < 0) {
      const narrowedPct = ((diff.previousMarginPercent - l.marginPercent) * 100).toFixed(2);
      return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) leads by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`;
    }
  }
  return `${result.electorateName}: ${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) leads ${l.secondCandidate} (${partyLabel(l.secondCandidateParty)}) by ${marginPct}% at ${pct}% counted.`;
}

function templateCommentary(
  diff: ElectorateDiff,
  result: ElectorateResult
): string {
  const l = result.leaders;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const moePct = (result.marginOfError * 100).toFixed(1);

  if (diff.leaderChanged) {
    return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) has taken the lead from ${diff.previousLeaderName} (${partyLabel(diff.previousLeaderParty)}) in ${result.electorateName}. The lead is ${marginPct}% with ${pct}% of votes counted.`;
  }
  if (
    diff.previousPercentageCounted !== null &&
    diff.previousPercentageCounted < 1 &&
    diff.currentPercentageCounted >= 1
  ) {
    return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is the likely winner in ${result.electorateName} with all ordinary votes counted.`;
  }
  if (
    diff.predictionStatusChanged &&
    (l.predictionStatus === 'likely' || l.predictionStatus === 'projected')
  ) {
    return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is the likely winner in ${result.electorateName}. The ${marginPct}% lead exceeds the ±${moePct}% margin of error, making this a confident prediction at ${pct}% counted.`;
  }
  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) is ahead in ${result.electorateName} with ${marginPct}% of the vote. But a ±${moePct}% margin of error means the race is still too close to call at ${pct}% counted.`;
  }
  if (diff.previousMargin !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = ((l.marginPercent - diff.previousMarginPercent) * 100).toFixed(2);
      return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) extended their lead by ${widenedPct}% to ${marginPct}% in ${result.electorateName} at ${pct}% counted.`;
    }
    if (marginDelta < 0) {
      const narrowedPct = ((diff.previousMarginPercent - l.marginPercent) * 100).toFixed(2);
      return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) leads in ${result.electorateName} by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`;
    }
  }
  return `${l.leadingCandidate} (${partyLabel(l.leadingCandidateParty)}) leads ${l.secondCandidate} (${partyLabel(l.secondCandidateParty)}) by ${marginPct}% in ${result.electorateName} at ${pct}% counted.`;
}

export function buildFeedEvents(
  previous: ElectorateResult[],
  current: ElectorateResult[]
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const prevMap = new Map(previous.map((r) => [r.electorateName, r]));

  for (const result of current) {
    const prev = prevMap.get(result.electorateName);
    const diff = computeDiff(prev, result);
    const type = determineFeedType(diff);

    const changed =
      diff.previousVotesCounted === null ||
      diff.currentVotesCounted !== diff.previousVotesCounted;

    const countCompleted =
      diff.previousPercentageCounted !== null &&
      diff.previousPercentageCounted < 1 &&
      diff.currentPercentageCounted >= 1;

    if (
      !changed &&
      !diff.predictionStatusChanged &&
      !diff.leaderChanged &&
      !countCompleted
    ) {
      continue;
    }

    events.push({
      id: `${result.electorateName}-${diff.currentVotesCounted}-${Math.round(
        (diff.currentMargin ?? 0) * 100
      )}-${diff.currentPredictionStatus ?? 'none'}`,
      timestamp: Date.now(),
      type,
      electorateName: result.electorateName,
      predictionStatus: result.leaders.predictionStatus,
      marginOfError: result.marginOfError,
      summary: templateSummary(diff, result),
      commentary: templateCommentary(diff, result),
      diff,
    });
  }

  return events;
}
