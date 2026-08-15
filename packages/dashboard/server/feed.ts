import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { ElectorateDiff, FeedEvent } from '@election-night/core/types';
import {
  computeDiff,
  diffFacts,
  determineFeedEventType,
  type ComparableResult,
} from '@election-night/core/diff';
import { dashboardServerConfig } from './config.js';
import { feedEventsTotal } from './metrics.js';
import { log } from './logger.js';

const FEED_CACHE_PATH = dashboardServerConfig.feedCachePath;
const MAX_FEED_EVENTS = dashboardServerConfig.maxFeedEvents;

let feedEvents: FeedEvent[] = [];

export function currentFeedEvents(): FeedEvent[] {
  return feedEvents;
}

/** Load persisted feed events from disk into module state. */
export function loadFeedEvents(): void {
  feedEvents = readFeedEventsFromDisk();
}

function readFeedEventsFromDisk(): FeedEvent[] {
  if (!existsSync(FEED_CACHE_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(FEED_CACHE_PATH, 'utf-8'));
    if (Array.isArray(data)) return data as FeedEvent[];
  } catch (err) {
    log.error('Failed to load cached feed events:', err);
  }
  return [];
}

export function resetFeedState(): void {
  feedEvents = [];
}

function saveFeedEvents(events: FeedEvent[]) {
  try {
    mkdirSync(dirname(FEED_CACHE_PATH), { recursive: true });
    writeFileSync(FEED_CACHE_PATH, JSON.stringify(events, null, 2));
  } catch (err) {
    log.error('Failed to save feed events:', err);
  }
}

/**
 * Render the short (summary) and long (commentary) copy for one diff.
 * Both variants are produced together so the facts can never drift
 * between them.
 */
function renderCopy(
  diff: ElectorateDiff,
  result: ComparableResult
): { summary: string; commentary: string } {
  const l = result.leaders;
  const name = result.electorateName;
  const pct = (result.votePercentageCounted * 100).toFixed(0);
  const marginPct = (l.marginPercent * 100).toFixed(2);
  const party = (p: string | null | undefined) => p ?? 'Independent';
  const moePct = (result.marginOfError * 100).toFixed(1);
  const leader = `${l.leadingCandidate} (${party(l.leadingCandidateParty)})`;

  if (diff.leaderChanged) {
    const outgoing = `${diff.previousLeaderName} (${party(diff.previousLeaderParty)})`;
    return {
      summary: `${name}: ${leader} took the lead from ${outgoing} — leads by ${marginPct}%.`,
      commentary: `${leader} has taken the lead from ${outgoing} in ${name}. The lead is ${marginPct}% with ${pct}% of votes counted.`,
    };
  }

  const facts = diffFacts(diff);
  if (facts.countCompleted) {
    return {
      summary: `${name}: ${leader} is the likely winner — ${marginPct}% lead at 100% counted.`,
      commentary: `${leader} is the likely winner in ${name} with all ordinary votes counted.`,
    };
  }

  if (diff.predictionStatusChanged && facts.predictionCalled) {
    return {
      summary: `${name}: ${leader} is the likely winner — ${marginPct}% lead exceeds ±${moePct}% MoE, making this a confident prediction at ${pct}% counted.`,
      commentary: `${leader} is the likely winner in ${name}. The ${marginPct}% lead exceeds the ±${moePct}% margin of error, making this a confident prediction at ${pct}% counted.`,
    };
  }

  if (diff.predictionStatusChanged && l.predictionStatus === 'leaning') {
    return {
      summary: `${name}: ${leader} is ahead by ${marginPct}% — but the ±${moePct}% MoE means the race is still too close to call at ${pct}% counted.`,
      commentary: `${leader} is ahead in ${name} with ${marginPct}% of the vote. But a ±${moePct}% margin of error means the race is still too close to call at ${pct}% counted.`,
    };
  }

  if (diff.previousMargin !== null && diff.previousMarginPercent !== null) {
    const marginDelta = l.margin - diff.previousMargin;
    if (marginDelta > 0) {
      const widenedPct = (
        (l.marginPercent - diff.previousMarginPercent) *
        100
      ).toFixed(2);
      return {
        summary: `${name}: ${leader} extended their lead by ${widenedPct}% to ${marginPct}% at ${pct}% counted.`,
        commentary: `${leader} extended their lead by ${widenedPct}% to ${marginPct}% in ${name} at ${pct}% counted.`,
      };
    }
    if (marginDelta < 0) {
      const narrowedPct = (
        (diff.previousMarginPercent - l.marginPercent) *
        100
      ).toFixed(2);
      return {
        summary: `${name}: ${leader} leads by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`,
        commentary: `${leader} leads in ${name} by ${marginPct}% at ${pct}% counted — the gap narrowed by ${narrowedPct}%.`,
      };
    }
  }

  const second = `${l.secondCandidate} (${party(l.secondCandidateParty)})`;
  return {
    summary: `${name}: ${leader} leads ${second} by ${marginPct}% at ${pct}% counted.`,
    commentary: `${leader} leads ${second} by ${marginPct}% in ${name} at ${pct}% counted.`,
  };
}

/**
 * Compare a new payload against the previous one and generate feed events
 * for every electorate where something interesting happened.
 */
export function buildFeedEvents(
  previous: ComparableResult[],
  current: ComparableResult[]
): FeedEvent[] {
  const events: FeedEvent[] = [];
  const prevMap = new Map(previous.map((r) => [r.electorateName, r]));

  for (const result of current) {
    const diff = computeDiff(prevMap.get(result.electorateName), result);
    const facts = diffFacts(diff);

    if (
      !facts.votesChanged &&
      !diff.predictionStatusChanged &&
      !diff.leaderChanged &&
      !facts.countCompleted
    )
      continue;

    const { summary, commentary } = renderCopy(diff, result);
    events.push({
      id: `${result.electorateName}-${diff.currentVotesCounted}-${Math.round(
        (diff.currentMargin ?? 0) * 100
      )}-${diff.currentPredictionStatus ?? 'none'}`,
      timestamp: Date.now(),
      type: determineFeedEventType(diff),
      electorateName: result.electorateName,
      predictionStatus: result.leaders.predictionStatus,
      marginOfError: result.marginOfError,
      summary,
      commentary,
      diff,
    });
  }

  return events;
}

/**
 * Append events to the in-memory list (deduplicating by id), persist, and
 * return only the genuinely new ones for broadcast.
 */
export function addFeedEvents(events: FeedEvent[]): FeedEvent[] {
  const existingIds = new Set(feedEvents.map((e) => e.id));
  const newEvents = events.filter((e) => !existingIds.has(e.id));
  if (newEvents.length === 0) return newEvents;
  feedEvents = [...feedEvents, ...newEvents].slice(-MAX_FEED_EVENTS);
  newEvents.forEach((event) => feedEventsTotal.inc({ type: event.type }));
  saveFeedEvents(feedEvents);
  return newEvents;
}
