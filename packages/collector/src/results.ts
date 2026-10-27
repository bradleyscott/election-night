import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import {
  WebhookEventType,
  WebhookPayload,
  type ElectorateDiff,
} from '@election-night/core/types';
import {
  computeDiff,
  determineWebhookEvents,
  type ComparableResult,
} from '@election-night/core/diff';
import {
  CALL_THRESHOLD,
  type SeatChance,
} from '@election-night/core/seat-probability';
import {
  readTaggedCache,
  serializeTaggedCache,
} from '@election-night/core/tagged-cache';
import { fetchWithRetry } from './retry.js';
import { publishMetrics } from './ws-client.js';
import { emitWebhookPublish, emitWebhookPublishDuration } from './metrics.js';
import { collectorConfig } from './config.js';
import { log } from './logger.js';

export type Results = ComparableResult;

export { computeDiff, determineWebhookEvents };

/**
 * On-disk shape of the diff baseline.
 *
 * The cache is the previous scrape of the *current* cycle, so it has to record
 * which cycle it belongs to: without the year, a cache left over from the 2023
 * run (or committed in a dev `.data/` directory) would be diffed against the
 * first 2026 scrape, producing a flood of bogus `count_completed` and
 * `leader_change` events on election night. The envelope and the rules for
 * reading it are in `@election-night/core/tagged-cache`, shared with the
 * dashboard server, which preloads the same file.
 */
const CACHE_KEY = 'results';

let electorateResults: Results[];

/**
 * Cycle tag of the cache the collector is currently relying on — written by
 * `cacheResults` or read from disk — so `/health` can say which election the
 * diff baseline belongs to. The 2026 rebuild left production serving 2023 data
 * with no way to see why; this is the field that would have answered it.
 */
let cachedYear: string | null = null;

export function cacheCycle(): string | null {
  return cachedYear;
}

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  cachedYear = collectorConfig.electionYear;
  mkdirSync(dirname(collectorConfig.resultsCachePath), { recursive: true });
  writeFileSync(
    collectorConfig.resultsCachePath,
    serializeTaggedCache(toCache, CACHE_KEY, collectorConfig.electionYear)
  );
}

export function readResults(): Results[] {
  if (electorateResults) {
    return electorateResults;
  }
  let raw: string;
  try {
    raw = readFileSync(collectorConfig.resultsCachePath, 'utf8');
  } catch {
    return [];
  }

  // `ELECTION_YEAR` is always set for the collector, so an untagged cache is
  // never used as a baseline.
  const cached = readTaggedCache<Results>({
    raw,
    key: CACHE_KEY,
    payloadNoun: 'results',
    expectedYear: collectorConfig.electionYear,
  });
  if (!cached.ok) {
    log.warn(
      `Ignoring diff cache at ${collectorConfig.resultsCachePath}: ${cached.reason}. Starting from a clean baseline.`
    );
    return [];
  }
  cachedYear = cached.electionYear;
  return cached.items;
}

export async function sendWebhook(
  event: WebhookEventType,
  result: Results,
  diff: ElectorateDiff,
  chanceFor?: (result: Results) => SeatChance | null
): Promise<void> {
  const url = collectorConfig.webhookUrl;
  if (!url) return;

  const chance = chanceFor?.(result) ?? null;
  const payload: WebhookPayload = {
    event,
    timestamp: Date.now(),
    electorateName: result.electorateName,
    result,
    diff,
    probability: chance?.state === 'counting' ? chance.probability : null,
  };

  const startedAt = performance.now();
  try {
    await fetchWithRetry(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
        },
      },
      { maxAttempts: 3, baseDelayMs: 500 }
    );
    const seconds = (performance.now() - startedAt) / 1000;
    publishMetrics([
      emitWebhookPublish('success'),
      emitWebhookPublishDuration(seconds, 'success'),
    ]);
  } catch (e) {
    const seconds = (performance.now() - startedAt) / 1000;
    publishMetrics([
      emitWebhookPublish('error'),
      emitWebhookPublishDuration(seconds, 'error'),
    ]);
    log.error(
      `Webhook POST failed for ${event} on ${result.electorateName} after retries`,
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
  currentResults: Results[],
  chanceFor?: (result: Results) => SeatChance | null
): Promise<void> {
  const cachedResults = readResults();
  const cacheMap = new Map(cachedResults.map((r) => [r.electorateName, r]));

  // A seat is "called" on the same rule the feed uses, so a subscriber that
  // reads both is told about the same event twice, not two different ones.
  const called = (result: Results | null): boolean => {
    if (!result || !chanceFor) return false;
    const chance = chanceFor(result);
    return chance?.state === 'counting' && chance.probability >= CALL_THRESHOLD;
  };

  const promises: Promise<void>[] = [];

  for (const result of currentResults) {
    const previous = cacheMap.get(result.electorateName) ?? null;
    const diff = computeDiff(previous, result);
    const events = determineWebhookEvents(
      diff,
      chanceFor
        ? { called: called(result), wasCalled: called(previous) }
        : undefined
    );

    for (const event of events) {
      promises.push(sendWebhook(event, result, diff, chanceFor));
    }
  }

  await Promise.all(promises);
}
