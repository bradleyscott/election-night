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
import { emitWebhookPublish } from './metrics.js';
import { collectorConfig } from './config.js';
import { log } from './logger.js';

export type Results = ComparableResult;

export { computeDiff, determineWebhookEvents };

export async function sendWebhook(
  event: WebhookEventType,
  result: Results,
  diff: ElectorateDiff,
  onMetrics?: (event: ReturnType<typeof emitWebhookPublish>) => void
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
    onMetrics?.(emitWebhookPublish('success'));
  } catch (e) {
    onMetrics?.(emitWebhookPublish('error'));
    log.error(
      `Webhook POST failed for ${event} on ${result.electorateName} after retries`,
      e
    );
  }
}

/**
 * Compare the current cycle against the previous snapshot and fire a webhook
 * for each event type that triggered per electorate.
 *
 * `previous` is the previous snapshot's results, read from SQLite by the
 * caller. The first scrape of an electorate just establishes a baseline and
 * fires nothing.
 */
export async function processResults(
  currentResults: Results[],
  previousResults: Results[],
  onMetrics?: (event: ReturnType<typeof emitWebhookPublish>) => void
): Promise<void> {
  const previousByName = new Map(
    previousResults.map((r) => [r.electorateName, r])
  );

  const promises: Promise<void>[] = [];

  for (const result of currentResults) {
    const previous = previousByName.get(result.electorateName) ?? null;
    const diff = computeDiff(previous, result);
    const events = determineWebhookEvents(diff);

    for (const event of events) {
      promises.push(sendWebhook(event, result, diff, onMetrics));
    }
  }

  await Promise.all(promises);
}
