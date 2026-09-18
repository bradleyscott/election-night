import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { MetricEvent } from '@election-night/core/types';

export const register = new Registry();

export const websocketClients = new Gauge({
  name: 'election_websocket_clients_connected',
  help: 'Number of connected dashboard clients',
  registers: [register],
});

export const feedEventsTotal = new Counter({
  name: 'election_feed_events_total',
  help: 'Total number of feed events generated',
  labelNames: ['type'],
  registers: [register],
});

export const lastScrapeTimestampSeconds = new Gauge({
  name: 'election_last_scrape_timestamp_seconds',
  help: 'Unix timestamp of the last received scrape update',
  registers: [register],
});

export const scrapeDurationSeconds = new Histogram({
  name: 'election_scrape_duration_seconds',
  help: 'Time spent scraping election results',
  labelNames: ['status'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const scrapeElectoratesTotal = new Counter({
  name: 'election_scrape_electorates_total',
  help: 'Total number of electorate pages scraped',
  labelNames: ['status'],
  registers: [register],
});

export const collectorLastCycleOk = new Gauge({
  name: 'election_collector_last_cycle_ok',
  help: 'Whether the collector last completed a cycle successfully',
  registers: [register],
});

export const webhookPublishesTotal = new Counter({
  name: 'election_webhook_publishes_total',
  help: 'Total number of webhook publish attempts',
  labelNames: ['status'],
  registers: [register],
});

let lastCollectorMetricsAt = 0;

export function applyMetricEvents(events: MetricEvent | MetricEvent[]): void {
  const arr = Array.isArray(events) ? events : [events];
  for (const event of arr) {
    switch (event.metric) {
      case 'scrapeDurationSeconds':
        scrapeDurationSeconds.observe({ status: event.status }, event.seconds);
        break;
      case 'scrapeElectoratesTotal':
        scrapeElectoratesTotal.inc({ status: event.status });
        break;
      case 'webhookPublishesTotal':
        webhookPublishesTotal.inc({ status: event.status });
        break;
    }
  }
  lastCollectorMetricsAt = Date.now();
  collectorLastCycleOk.set(1);
}

/** Timestamp of the last cycle that reported metrics, 0 when none has. */
export function lastMetricEventAt(): number {
  return lastCollectorMetricsAt;
}

export async function metricsResponse(): Promise<string> {
  return register.metrics();
}
