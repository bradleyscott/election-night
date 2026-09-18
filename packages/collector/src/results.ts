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
import { fetchWithRetry } from './retry.js';
import { publishMetrics } from './ws-client.js';
import { emitWebhookPublish } from './metrics.js';
import { collectorConfig } from './config.js';
import { log } from './logger.js';

export type Results = ComparableResult;

export { computeDiff, determineWebhookEvents };

/**
 * On-disk shape of the diff baseline.
 *
 * The cache is the previous scrape of the *current* cycle, so it has to record
 * which cycle it belongs to. Without the year, a cache left over from the 2023
 * run (or committed in a dev `.data/` directory) would be diffed against the
 * first 2026 scrape — producing a flood of bogus `count_completed` and
 * `leader_change` events on election night.
 */
type CachedResults = {
  electionYear: string;
  results: Results[];
};

let electorateResults: Results[];

function parseCache(raw: string): CachedResults | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // Legacy format: a bare array with no cycle attribution. Treated as belonging
  // to no cycle, so it is never used as a baseline.
  if (Array.isArray(parsed)) return null;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const cached = parsed as Partial<CachedResults>;
  if (
    typeof cached.electionYear !== 'string' ||
    !Array.isArray(cached.results)
  ) {
    return null;
  }
  return { electionYear: cached.electionYear, results: cached.results };
}

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  const payload: CachedResults = {
    electionYear: collectorConfig.electionYear,
    results: toCache,
  };
  mkdirSync(dirname(collectorConfig.resultsCachePath), { recursive: true });
  writeFileSync(
    collectorConfig.resultsCachePath,
    JSON.stringify(payload, null, 2)
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

  const cached = parseCache(raw);
  if (!cached) {
    log.warn(
      `Diff cache at ${collectorConfig.resultsCachePath} has no election year; ignoring it so the first scrape of ${collectorConfig.electionYear} starts from a clean baseline`
    );
    return [];
  }
  if (cached.electionYear !== collectorConfig.electionYear) {
    log.warn(
      `Diff cache belongs to the ${cached.electionYear} election, not ${collectorConfig.electionYear}; ignoring it so the first scrape starts from a clean baseline`
    );
    return [];
  }
  return cached.results;
}

export async function sendWebhook(
  event: WebhookEventType,
  result: Results,
  diff: ElectorateDiff
): Promise<void> {
  const url = collectorConfig.webhookUrl;
  if (!url) return;

  const payload: WebhookPayload = {
    event,
    timestamp: Date.now(),
    electorateName: result.electorateName,
    result,
    diff,
  };

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
    publishMetrics(emitWebhookPublish('success'));
  } catch (e) {
    publishMetrics(emitWebhookPublish('error'));
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
export async function processResults(currentResults: Results[]): Promise<void> {
  const cachedResults = readResults();
  const cacheMap = new Map(cachedResults.map((r) => [r.electorateName, r]));

  const promises: Promise<void>[] = [];

  for (const result of currentResults) {
    const previous = cacheMap.get(result.electorateName) ?? null;
    const diff = computeDiff(previous, result);
    const events = determineWebhookEvents(diff);

    for (const event of events) {
      promises.push(sendWebhook(event, result, diff));
    }
  }

  await Promise.all(promises);
}
