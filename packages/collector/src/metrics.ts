import type { MetricEvent } from '@election-night/core/types';

export function emitScrapeDuration(
  seconds: number,
  status: 'success' | 'partial' | 'error'
): MetricEvent {
  return { metric: 'scrapeDurationSeconds', seconds, status };
}

export function emitScrapeElectorate(
  status: 'success' | 'error' | 'cached'
): MetricEvent {
  return { metric: 'scrapeElectoratesTotal', status };
}

export function emitCollectorSocketConnected(connected: boolean): MetricEvent {
  return { metric: 'collectorSocketConnected', connected };
}

export function emitWebhookPublish(status: 'success' | 'error'): MetricEvent {
  return { metric: 'webhookPublishesTotal', status };
}
