import type { MetricEvent } from '@election-night/core/types';

export function emitScrapeDuration(
  seconds: number,
  status: 'success' | 'partial' | 'error'
): MetricEvent {
  return { metric: 'scrapeDurationSeconds', seconds, status };
}

export function emitScrapeElectorate(
  status: 'success' | 'error' | 'fallback'
): MetricEvent {
  return { metric: 'scrapeElectoratesTotal', status };
}

export function emitWebhookPublish(status: 'success' | 'error'): MetricEvent {
  return { metric: 'webhookPublishesTotal', status };
}
