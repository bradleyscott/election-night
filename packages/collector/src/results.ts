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

export type Results = ComparableResult;

export { computeDiff, determineWebhookEvents };

let electorateResults: Results[];

export function cacheResults(toCache: Results[]) {
  electorateResults = toCache;
  mkdirSync(dirname(collectorConfig.resultsCachePath), { recursive: true });
  writeFileSync(
    collectorConfig.resultsCachePath,
    JSON.stringify(toCache, null, 2)
  );
}

export function readResults(): Results[] {
  if (electorateResults) {
    return electorateResults;
  }
  try {
    const resultsString = readFileSync(
      collectorConfig.resultsCachePath,
      'utf8'
    );
    return JSON.parse(resultsString);
  } catch {
    return [];
  }
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
    console.error(
      `Webhook POST failed for ${event} on ${result.electorateName} after retries:`,
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
