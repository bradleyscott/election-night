import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { WebhookPayload } from '@election-night/core/types';
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
import { collectorConfig } from './config.js';
import { log } from './logger.js';

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

let electorateResults: ComparableResult[];

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

export function cacheResults(toCache: ComparableResult[]) {
  electorateResults = toCache;
  cachedYear = collectorConfig.electionYear;
  mkdirSync(dirname(collectorConfig.resultsCachePath), { recursive: true });
  writeFileSync(
    collectorConfig.resultsCachePath,
    serializeTaggedCache(toCache, CACHE_KEY, collectorConfig.electionYear)
  );
}

export function readResults(): ComparableResult[] {
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
  const cached = readTaggedCache<ComparableResult>({
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

/**
 * Build the webhook announcements for this result, without sending them.
 *
 * The caller persists these in the same transaction as the snapshot. The
 * `eventId` is stable for a given publication, event and electorate, so a
 * retry of the same pending result cannot enqueue a second copy; a correction
 * gets a new publication key and therefore a distinct event.
 */
export function buildWebhookPayloads(
  currentResults: ComparableResult[],
  chanceFor?: (result: ComparableResult) => SeatChance | null,
  meta: { electionYear: string; publicationKey: string } = {
    electionYear: collectorConfig.electionYear,
    publicationKey: '',
  }
): WebhookPayload[] {
  const cachedResults = readResults();
  const cacheMap = new Map(cachedResults.map((r) => [r.electorateName, r]));
  const called = (result: ComparableResult | null): boolean => {
    if (!result || !chanceFor) return false;
    const chance = chanceFor(result);
    return chance?.state === 'counting' && chance.probability >= CALL_THRESHOLD;
  };

  const payloads: WebhookPayload[] = [];
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
      const chance = chanceFor?.(result) ?? null;
      payloads.push({
        event,
        eventId: `${meta.publicationKey}:${event}:${result.electorateName}`,
        electionYear: meta.electionYear,
        revision: null,
        timestamp: Date.now(),
        electorateName: result.electorateName,
        result,
        diff,
        probability: chance?.state === 'counting' ? chance.probability : null,
        progress: chance?.state === 'counting' ? chance.progress : null,
      });
    }
  }
  return payloads;
}
